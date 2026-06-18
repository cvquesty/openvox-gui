# Puppet Agent Disabled Fact

To support detecting disabled Puppet agents via facts (for the Metrics | Node Health page and other uses), deploy this custom fact.

## Recommended: External Fact (bash)

Place this script in a module that gets distributed to all agents (e.g. `site/profile/facts.d/agent_disabled.sh` or your preferred profile module).

```bash
#!/bin/bash
# External fact script.
# Each line "fact_name=value" registers a fact where the left side (before =) is the fact *name*.
# Your understanding is correct: the fact name in PuppetDB / $facts must exactly match the key you output here.
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
# Main fact: returns true if the lock file exists
Facter.add(:puppet_agent_disabled) do
  setcode do
    lockfile = '/opt/puppetlabs/puppet/cache/state/agent_disabled.lock'
    File.exist?(lockfile)
  end
end

# Separate fact for the optional disable message (nil if not disabled or no message)
Facter.add(:puppet_agent_disable_message) do
  setcode do
    lockfile = '/opt/puppetlabs/puppet/cache/state/agent_disabled.lock'
    if File.exist?(lockfile) && File.size(lockfile) > 0
      File.readlines(lockfile).first.to_s.strip rescue nil
    else
      nil
    end
  end
end
```

**Important for fact names**: In Facter (Ruby), the symbol passed to `Facter.add(:fact_name)` **is** the fact name. It will appear in PuppetDB as `facts.name = 'fact_name'` and be queryable as `$facts['fact_name']` (or the legacy `$fact_name`).

The value returned by `setcode` (or the block) is the fact *value*, not the name.

For external facts (the bash script above), the left side of each `key=value` line **is** the fact name. This must match what you intend to query in PuppetDB / the GUI.

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
