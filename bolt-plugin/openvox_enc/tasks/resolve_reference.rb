#!/opt/puppetlabs/puppet/bin/ruby
# frozen_string_literal: true

###############################################################################
# OpenVox ENC Bolt Inventory Plugin — resolve_reference task
#
# Queries the OpenVox GUI API to dynamically resolve Bolt inventory
# targets from the ENC (External Node Classifier) database.
#
# When Bolt encounters '_plugin: openvox_enc' in inventory.yaml, it
# calls this task. The task hits the /api/enc/inventory/bolt endpoint,
# which returns all classified nodes organized by ENC group. The task
# transforms that into the array of target hashes that Bolt expects.
#
# This eliminates manual inventory.yaml maintenance — nodes and groups
# are managed in the GUI's Node Classifier, and Bolt reads them live.
###############################################################################

require 'json'
require 'net/http'
require 'uri'
require 'openssl'

params = JSON.parse($stdin.read)

api_url         = params['api_url'] || 'https://localhost:4567'
group_filter    = params['group']
transport       = params['transport'] || 'ssh'
ssl_verify      = params.fetch('ssl_verify', false)
api_token       = params['api_token']
token_file      = params['token_file'] || '/etc/puppetlabs/bolt/.bolt_token'

# Run-as settings (defaults to running as root via sudo — the recommended
# pattern so that commands from the GUI Orchestration page are executed
# with proper privilege while still connecting as the limited bolt user).
run_as          = params.fetch('run_as', 'root')
run_as_command  = params.fetch('run_as_command', ['sudo'])

# Support reading token from a file (preferred for the local bolt user)
if (api_token.nil? || api_token.empty?) && File.exist?(token_file)
  begin
    api_token = File.read(token_file).strip
  rescue => e
    # If we can't read the token file, continue without it (will likely 401)
  end
end

# ─── Query the OpenVox GUI API ────────────────────────────────

uri = URI.parse("#{api_url}/api/enc/inventory/bolt")

http = Net::HTTP.new(uri.host, uri.port)
if uri.scheme == 'https'
  http.use_ssl = true
  http.verify_mode = ssl_verify ? OpenSSL::SSL::VERIFY_PEER : OpenSSL::SSL::VERIFY_NONE
end

begin
  request = Net::HTTP::Get.new(uri.request_uri)
  request['Accept'] = 'application/json'
  if api_token && !api_token.empty?
    request['Authorization'] = "Bearer #{api_token}"
  end
  response = http.request(request)

  unless response.code.to_i == 200
    raise "API returned HTTP #{response.code}: #{response.body}"
  end

  inventory = JSON.parse(response.body)
rescue StandardError => e
  # Return error in Bolt's expected format
  result = { '_error' => {
    'msg'     => "Failed to query OpenVox GUI ENC API: #{e.message}",
    'kind'    => 'openvox_enc/api_error',
    'details' => { 'api_url' => api_url },
  } }
  puts result.to_json
  exit 1
end

# ─── Build Bolt target list from ENC groups ───────────────────

targets = []
seen = {}

groups = inventory['groups'] || []

groups.each do |grp|
  grp_name = grp['name']

  # Skip PuppetDB plugin groups (Bolt handles those natively)
  next if grp['targets'].is_a?(Array) && grp['targets'].any? { |t| t.is_a?(Hash) && t.key?('_plugin') }

  # If a group filter is specified, only include matching groups
  next if group_filter && grp_name != group_filter

  grp_targets = grp['targets'] || []
  grp_targets.each do |certname|
    next if certname.is_a?(Hash) # Skip plugin references
    next if seen[certname]       # Deduplicate across groups

    seen[certname] = true
    target = {
      'uri'  => certname,
      'name' => certname,
      'config' => {
        'transport' => transport,
        transport   => { 'host-key-check' => false },
      },
      'vars' => {
        'enc_groups' => [],
      },
    }

    # Inject run-as settings so commands from the GUI are run with sudo as root
    # by default. This can be overridden via plugin parameters if needed.
    if run_as && !run_as.empty?
      target['config'][transport] ||= {}
      target['config'][transport]['run-as'] = run_as
    end

    if run_as_command && run_as_command.is_a?(Array) && !run_as_command.empty?
      target['config'][transport] ||= {}
      target['config'][transport]['run-as-command'] = run_as_command
    end

    # Collect all groups this node belongs to
    groups.each do |g|
      ts = g['targets'] || []
      if ts.include?(certname)
        target['vars']['enc_groups'] << g['name']
      end
    end

    targets << target
  end
end

# ─── Return targets to Bolt ──────────────────────────────────

puts({ 'value' => targets }.to_json)
