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

api_url    = params['api_url'] || 'https://localhost:4567'
group_filter = params['group']
transport  = params['transport'] || 'ssh'
ssl_verify = params.fetch('ssl_verify', false)

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
