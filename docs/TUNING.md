# Tuning OpenVox Infrastructure

This document explains how to monitor and safely tune your OpenVox Server and OpenVoxDB using the `ovox infra` command-line tools.

## Why Tuning Matters

A default OpenVox installation works for small environments, but as your fleet grows you will eventually hit limits in:

- Number of concurrent Puppet catalog compilations (JRuby instances)
- Memory available to the JVM
- Database connection pools in PuppetDB
- Code cache for compiled Ruby

Poor tuning typically manifests as:
- High CPU / long catalog compilation times
- OutOfMemory errors or excessive garbage collection
- PuppetDB connection pool exhaustion
- Slow `puppet agent -t` runs

The `ovox infra` tools give you the same kind of guidance that Puppet Enterprise's `puppet infrastructure tune` command provides, but designed for the open-source OpenVox stack.

## The `ovox infra` Tool Suite

`ovox infra` is the primary interface for infrastructure health and tuning. It follows a subcommand style for clarity and safety.

### `ovox infra health`

Quick health overview of the core components:

```bash
ovox infra health
ovox infra health --component server
ovox infra health --component db
```

Shows the status of Puppet Server, PuppetDB, and other services.

### `ovox infra settings`

The main way to **inspect** what is currently configured.

#### Show current settings

```bash
ovox infra settings show
ovox infra settings show --server
ovox infra settings show --db
```

This displays:

**Puppet Server**
- Current `jruby-puppet.max-active-instances`
- JVM heap (`-Xms` / `-Xmx`)
- Reserved Code Cache Size

**PuppetDB**
- Read and write connection pool sizes
- JVM heap settings

This command is read-only and is the recommended first step before making any changes.

#### Directly set a value (`settings set`)

```bash
ovox infra settings set <key> <value> [--server | --db] [--dry-run] [-y]
```

Examples:

```bash
# Increase JRuby workers
ovox infra settings set server.jruby.max_active_instances 8

# Give Puppet Server 6 GB of heap
ovox infra settings set server.jvm.heap 6g

# Increase reserved code cache
ovox infra settings set server.jvm.reserved_code_cache 1g

# Tune PuppetDB pools
ovox infra settings set db.read_pool.max_connections 80
ovox infra settings set db.write_pool.max_connections 40
```

**Safety guarantees**:
- Creates a timestamped backup of the relevant config file(s) before changing anything.
- Automatically restarts the affected service (`puppetserver` or `puppetdb`) after applying the change.
- `--dry-run` shows a clear before/after diff with no changes made.
- Confirmation prompt (bypass with `-y` / `--yes`).

### `ovox infra recommend`

Opinionated recommendations based on your current fleet size.

```bash
ovox infra recommend
ovox infra recommend --server
ovox infra recommend --db
```

This is the "what should I do?" command. It reads your actual current settings and suggests better values.

### `ovox infra tune`

The guided way to apply changes.

```bash
ovox infra tune [--server | --db] [--dry-run] [-y]
```

- Shows the same recommendations as `recommend`.
- If you proceed, it applies the suggested values using the same safe backup + restart mechanism as `settings set`.

Use this when you want the tool's opinion. Use `settings set` when you want precise control.

## Recommended Workflow

1. **Inspect** — `ovox infra settings show`
2. **Analyze** — `ovox infra recommend`
3. **Preview** — `ovox infra tune --dry-run` (or `settings set ... --dry-run`)
4. **Apply** — `ovox infra tune` or the specific `settings set` command
5. **Verify** — `ovox infra health` and monitor catalog compilation times

## Common Tuning Scenarios

### Small Lab / Homelab (< 100 nodes)

Usually the defaults are fine. You might increase JRuby count to 2–3 and give 2–3 GB of heap.

### Medium Fleet (100–500 nodes)

Typical targets:
- 4–8 JRuby workers
- 4–8 GB JVM heap for Puppet Server
- 512 MB – 1 GB Reserved Code Cache
- PuppetDB read/write pools of 40–80

### Large Production (> 500 nodes)

You will usually need:
- 8–12+ JRuby workers (watch memory)
- 8–16 GB+ heap (G1GC recommended)
- Larger code cache (1–2 GB)
- Significantly larger PuppetDB connection pools

Monitor GC logs and compilation times after changes.

### JVM-Specific Tuning

The most common JVM change is heap size:

```bash
ovox infra settings set server.jvm.heap 8g
```

You can also tune the reserved code cache, which is very important when you have many unique classes/modules:

```bash
ovox infra settings set server.jvm.reserved_code_cache 1g
```

## Safety & Backups

Every mutation performed by `ovox infra` does the following:

1. Creates a timestamped backup directory under `/etc/puppetlabs/<component>/backups/ovox-infra-YYYYMMDD-HHMMSS/`
2. Applies the change
3. Restarts the service

You can always restore from the backup directory if something goes wrong.

## Relationship to the Web UI

The same tuning data and capabilities are available in the web interface under the **Metrics** and **Configuration** sections. The CLI is simply the terminal-friendly surface for the same backend logic.

## Limitations & Future Work

Current version focuses on the highest-impact settings:

- JRuby worker count
- JVM heap (Puppet Server)
- Reserved Code Cache
- PuppetDB connection pools

Future versions may add:
- More JVM flags
- PostgreSQL tuning (when using external DB)
- Automatic detection of memory pressure
- Integration with the web UI for one-click apply

---

**Related reading** (original Puppet recommendations):

- [Using the puppet infrastructure tune command](https://help.puppet.com/pe/current/topics/using_the_puppet_infrastructure_tune_command.htm)
- [Configuring Puppet Server RAM per JRuby](https://help.puppet.com/pe/current/topics/config_puppetserver_ram_per_jruby.htm)
- [Tuning Infrastructure](https://help.puppet.com/pe/current/topics/tuning_infrastructure.htm)

These documents remain excellent references even when using the open-source `ovox infra` tooling.