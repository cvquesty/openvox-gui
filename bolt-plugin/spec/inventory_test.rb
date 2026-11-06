# frozen_string_literal: true

require 'json'
require 'tempfile'
require 'pathname'
require 'securerandom'

ROOT = Pathname.new(__dir__).parent
$LOAD_PATH.unshift((ROOT / 'openvox_enc' / 'lib').to_s)
$LOAD_PATH.unshift((ROOT / 'spec' / 'support').to_s)

require 'openvox_enc/inventory'
require 'fake_http'

# Tiny assertion harness (no gem deps — works with system and AIO Ruby).
module Assert
  module_function

  def assert(cond, msg = 'assertion failed')
    raise msg unless cond
  end

  def assert_equal(expected, actual, msg = nil)
    return if expected == actual

    raise(msg || "expected #{expected.inspect}, got #{actual.inspect}")
  end

  def assert_includes(collection, item, msg = nil)
    return if collection.include?(item)

    raise(msg || "expected #{collection.inspect} to include #{item.inspect}")
  end

  def assert_nil(val, msg = nil)
    return if val.nil?

    raise(msg || "expected nil, got #{val.inspect}")
  end

  def refute(cond, msg = 'expected false')
    raise msg if cond
  end
end

FIXTURE = JSON.parse(File.read(ROOT / 'spec' / 'fixtures' / 'inventory_sample.json'))

class InventoryTests
  extend Assert

  def self.run_all
    tests = public_methods(false).grep(/\Atest_/).sort
    failures = []
    tests.each do |name|
      begin
        send(name)
        puts "  OK  #{name}"
      rescue StandardError => e
        failures << [name, e]
        puts "  FAIL #{name}: #{e.message}"
      end
    end
    [tests.size, failures]
  end

  # ── token resolution ──────────────────────────────────────────

  def self.test_resolve_token_prefers_explicit_api_token
    explicit = SecureRandom.hex(16)
    token = OpenvoxEnc::Inventory.resolve_token(
      api_token: explicit,
      token_file: '/nonexistent/token'
    )
    assert_equal explicit, token
  end

  def self.test_resolve_token_reads_token_file_when_api_token_blank
    Tempfile.create('bolt_token') do |f|
      from_file = SecureRandom.hex(16)
      f.write("  #{from_file}  \n")
      f.flush
      token = OpenvoxEnc::Inventory.resolve_token(api_token: '', token_file: f.path)
      assert_equal from_file, token
    end
  end

  def self.test_resolve_token_returns_nil_when_missing
    token = OpenvoxEnc::Inventory.resolve_token(
      api_token: nil,
      token_file: '/tmp/openvox-gui-no-such-bolt-token-file'
    )
    assert_nil token
  end

  def self.test_resolve_token_strips_whitespace_from_explicit
    token = OpenvoxEnc::Inventory.resolve_token(api_token: "  spaced  \n", token_file: '/x')
    assert_equal 'spaced', token
  end

  # ── build_targets ─────────────────────────────────────────────

  def self.test_build_targets_dedupes_across_groups
    targets = OpenvoxEnc::Inventory.build_targets(FIXTURE)
    uris = targets.map { |t| t['uri'] }
    assert_equal uris.uniq, uris
    assert_includes uris, 'web1.example.com'
    assert_includes uris, 'web2.example.com'
    assert_includes uris, 'db1.example.com'
    assert_equal 3, uris.size
  end

  def self.test_build_targets_collects_enc_groups_on_vars
    targets = OpenvoxEnc::Inventory.build_targets(FIXTURE)
    web1 = targets.find { |t| t['uri'] == 'web1.example.com' }
    assert web1, 'web1 target missing'
    groups = web1['vars']['enc_groups']
    assert_includes groups, 'webservers'
    assert_includes groups, 'dbservers'
  end

  def self.test_build_targets_skips_nested_plugin_groups
    targets = OpenvoxEnc::Inventory.build_targets(FIXTURE)
    uris = targets.map { |t| t['uri'] }
    refute uris.any? { |u| u.is_a?(Hash) }
    # puppetdb_dynamic group contributes no plain certnames
    names_from_plugin_only = targets.select { |t| t['vars']['enc_groups'] == ['puppetdb_dynamic'] }
    assert_equal [], names_from_plugin_only
  end

  def self.test_build_targets_group_filter
    targets = OpenvoxEnc::Inventory.build_targets(FIXTURE, group_filter: 'dbservers')
    uris = targets.map { |t| t['uri'] }.sort
    # web1 is in dbservers too; web2 is not
    assert_equal %w[db1.example.com web1.example.com], uris
  end

  def self.test_build_targets_group_filter_unknown_returns_empty
    targets = OpenvoxEnc::Inventory.build_targets(FIXTURE, group_filter: 'no-such-group')
    assert_equal [], targets
  end

  def self.test_build_targets_default_transport_ssh_no_run_as
    targets = OpenvoxEnc::Inventory.build_targets(FIXTURE)
    t = targets.first
    assert_equal 'ssh', t['config']['transport']
    assert_equal false, t['config']['ssh']['host-key-check']
    refute t['config']['ssh'].key?('run-as')
    refute t['config']['ssh'].key?('run-as-command')
  end

  def self.test_build_targets_custom_transport
    targets = OpenvoxEnc::Inventory.build_targets(FIXTURE, transport: 'winrm')
    t = targets.first
    assert_equal 'winrm', t['config']['transport']
    assert t['config'].key?('winrm')
    assert_equal false, t['config']['winrm']['host-key-check']
  end

  def self.test_build_targets_injects_run_as_when_provided
    targets = OpenvoxEnc::Inventory.build_targets(
      FIXTURE,
      run_as: 'root',
      run_as_command: %w[sudo -E]
    )
    ssh = targets.first['config']['ssh']
    assert_equal 'root', ssh['run-as']
    assert_equal %w[sudo -E], ssh['run-as-command']
  end

  def self.test_build_targets_ignores_empty_run_as
    targets = OpenvoxEnc::Inventory.build_targets(FIXTURE, run_as: '')
    refute targets.first['config']['ssh'].key?('run-as')
  end

  def self.test_build_targets_empty_inventory
    assert_equal [], OpenvoxEnc::Inventory.build_targets({})
    assert_equal [], OpenvoxEnc::Inventory.build_targets({ 'groups' => [] })
    assert_equal [], OpenvoxEnc::Inventory.build_targets(nil)
  end

  def self.test_build_targets_skips_hash_target_entries_in_normal_group
    inv = {
      'groups' => [
        {
          'name' => 'mixed',
          'targets' => [
            'good.example.com',
            { '_plugin' => 'something' },
          ],
        },
      ],
    }
    # Group has a nested _plugin entry → whole group skipped by design
    targets = OpenvoxEnc::Inventory.build_targets(inv)
    assert_equal [], targets
  end

  # ── error payload ─────────────────────────────────────────────

  def self.test_error_payload_shape
    err = OpenvoxEnc::Inventory.error_payload('boom', api_url: 'https://gui:4567')
    assert err.key?('_error')
    assert_equal 'openvox_enc/api_error', err['_error']['kind']
    assert_includes err['_error']['msg'], 'boom'
    assert_equal 'https://gui:4567', err['_error']['details']['api_url']
  end

  # ── resolve (integration of token + http + build) ─────────────

  def self.test_resolve_success_value_envelope
    api_token = SecureRandom.hex(16)
    http = FakeHttp.new(code: 200, body: FIXTURE.to_json)
    outcome = OpenvoxEnc::Inventory.resolve(
      {
        'api_url' => 'https://gui.example.com:4567',
        'api_token' => api_token,
        'transport' => 'ssh',
      },
      http_client: http
    )
    assert_equal 0, outcome[:exit_code]
    assert outcome[:payload].key?('value')
    assert outcome[:payload]['value'].size >= 3
    assert_equal 1, http.calls
    assert_equal '/api/enc/inventory/bolt', http.last_uri.request_uri
    assert_equal "Bearer #{api_token}", http.last_headers['Authorization']
    assert_equal 'application/json', http.last_headers['Accept']
  end

  def self.test_resolve_strips_trailing_slash_on_api_url
    http = FakeHttp.new(code: 200, body: { 'groups' => [] }.to_json)
    OpenvoxEnc::Inventory.resolve(
      { 'api_url' => 'https://gui.example.com:4567/', 'api_token' => SecureRandom.hex(8) },
      http_client: http
    )
    assert_equal 'https', http.last_uri.scheme
    assert_equal 'gui.example.com', http.last_uri.host
    assert_equal 4567, http.last_uri.port
    assert_equal '/api/enc/inventory/bolt', http.last_uri.path
  end

  def self.test_resolve_http_401_returns_error_payload
    http = FakeHttp.new(code: 401, body: '{"detail":"Not authenticated"}')
    outcome = OpenvoxEnc::Inventory.resolve(
      { 'api_url' => 'https://gui:4567', 'api_token' => SecureRandom.hex(8) },
      http_client: http
    )
    assert_equal 1, outcome[:exit_code]
    assert outcome[:payload].key?('_error')
    assert_includes outcome[:payload]['_error']['msg'], '401'
    assert_equal 'openvox_enc/api_error', outcome[:payload]['_error']['kind']
  end

  def self.test_resolve_http_500_returns_error_payload
    http = FakeHttp.new(code: 500, body: 'internal')
    outcome = OpenvoxEnc::Inventory.resolve(
      { 'api_url' => 'https://gui:4567' },
      http_client: http
    )
    assert_equal 1, outcome[:exit_code]
    assert_includes outcome[:payload]['_error']['msg'], '500'
  end

  def self.test_resolve_group_filter_passed_through
    http = FakeHttp.new(code: 200, body: FIXTURE.to_json)
    outcome = OpenvoxEnc::Inventory.resolve(
      { 'api_url' => 'https://gui:4567', 'group' => 'webservers', 'api_token' => SecureRandom.hex(8) },
      http_client: http
    )
    uris = outcome[:payload]['value'].map { |t| t['uri'] }.sort
    assert_equal %w[web1.example.com web2.example.com], uris
  end

  def self.test_resolve_uses_token_file_when_api_token_omitted
    Tempfile.create('bolt_token') do |f|
      from_file = SecureRandom.hex(16)
      f.write(from_file)
      f.flush
      http = FakeHttp.new(code: 200, body: { 'groups' => [] }.to_json)
      OpenvoxEnc::Inventory.resolve(
        { 'api_url' => 'https://gui:4567', 'token_file' => f.path },
        http_client: http
      )
      assert_equal "Bearer #{from_file}", http.last_headers['Authorization']
    end
  end

  def self.test_resolve_omits_authorization_when_no_token
    http = FakeHttp.new(code: 200, body: { 'groups' => [] }.to_json)
    OpenvoxEnc::Inventory.resolve(
      {
        'api_url' => 'https://gui:4567',
        'token_file' => '/tmp/openvox-gui-missing-bolt-token',
      },
      http_client: http
    )
    refute http.last_headers.key?('Authorization')
  end
end

puts 'openvox_enc inventory unit tests'
total, failures = InventoryTests.run_all
puts
if failures.empty?
  puts "All #{total} tests passed."
  exit 0
else
  puts "#{failures.size}/#{total} failed:"
  failures.each { |name, err| puts "  - #{name}: #{err.message}" }
  exit 1
end
