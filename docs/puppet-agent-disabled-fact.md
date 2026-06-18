# Puppet Agent Disabled Fact

To support detecting disabled Puppet agents via facts (for the Metrics | Node Health page and other uses), deploy this custom fact.

## Recommended: External Fact (bash)

Place this script in a module that gets distributed to all agents (e.g. `site/profile/facts.d/agent_disabled.sh` or your preferred profile module).

```bash
#!/bin/bash
# fact: puppet_agent_disabled
# Detects if this Puppet agent has been disabled via `puppet agent --disable`.
# Returns:
#   puppet_agent_disabled=true|false
#   puppet_agent_disable_message="..." (the message passed to --disable, if any)

LOCKFILE="/opt/puppetlabs/puppet/cache/state/agent_disabled.lock"

if [ -f "$LOCKFILE" ]; then
  echo "puppet_agent_disabled=true"
  if [ -s "$LOCKFILE" ]; then
    # Read first line (the disable message), escape for fact output
    msg=$(head -n 1 "$LOCKFILE" | tr -d '\r\n' | sed 's/"/\\"/g')
    echo "puppet_agent_disable_message=\"$msg\""
  fi
else
  echo "puppet_agent_disabled=false"
fi
```

Make it executable (`chmod +x`).

Ensure the module's `facts.d` directory is in your `files` or use a `file` resource in your profile to place it in the agent's facts.d dir if not using module autoloading for external facts.

External facts in modules are pluginsynced automatically when the module is in the environment.

## Alternative: Ruby Facter Fact (structured)

In `site/profile/lib/facter/puppet_agent_disabled.rb`:

```ruby
Facter.add(:puppet_agent_disabled) do
  setcode do
    lockfile = '/opt/puppetlabs/puppet/cache/state/agent_disabled.lock'
    if File.exist?(lockfile)
      message = File.read(lockfile).lines.first.to_s.strip rescue ''
      Facter.add(:puppet_agent_disable_message) { setcode { message } }
      true
    else
      false
    end
  end
end
```

## Important Limitation

If an agent is disabled (`puppet agent --disable`), it will **not** perform Puppet runs. Therefore:

- Facts (including this one) will **not** be re-collected or sent to PuppetDB.
- The fact value in PuppetDB will reflect the state at the time of the *last successful run*.
- A node that was enabled at its last check-in will continue to report `false` until it runs again after being re-enabled.

This is why the Node Health page also supports **live checks via Bolt** (see the page for the "Check Current Status" feature), which works over SSH and does not require the Puppet agent to be enabled.

## Usage in Manifests (optional)

You can use the fact to guard resources:

```puppet
if $facts['puppet_agent_disabled'] {
  notify { 'Agent is disabled on this node': }
}
```

Deploy the fact, let nodes run at least once (to populate), then the Metrics | Node Health page will pick it up.
