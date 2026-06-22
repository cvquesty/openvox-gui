# Metrics Setup

This document explains how to configure your OpenVox Server and OpenVoxDB so that the **Metrics** section in OpenVox GUI has full, rich data.

Without these changes, pages like **Run Performance**, **PuppetDB Health**, and **OpenVox Server Health** will show limited, partial, or empty charts.

## How Metrics Data Works

OpenVox GUI (running as the `puppet` user) connects to:

- **PuppetDB** (port 8081) over mTLS using the local Puppet agent's certificate
- **Puppet Server** (port 8140) over mTLS using the same certificate

It queries:
- PuppetDB Jolokia metrics (`/metrics/v2/read/...`, `/status`)
- Puppet Server status and metrics (`/status/v1/services?level=debug`, `/metrics/v2`)

Puppet Server and PuppetDB **restrict access** to these internal endpoints by default in many installations. You must explicitly allow them.

## 1. Puppet Server Configuration

### 1.1 Enable HTTP client metrics (required for route timing)

Edit `/etc/puppetlabs/puppetserver/conf.d/puppetserver.conf`:

```hocon
http-client: {
  metrics-enabled: true
}
```

This makes the experimental HTTP route metrics (catalog compile time, etc.) available via the `/status` debug response.

### 1.2 Enable JMX / metrics reporting

Create or edit `/etc/puppetlabs/puppetserver/metrics.conf`:

```hocon
metrics: {
  enabled: true
  registries: {
    puppetserver: {
      reporters: {
        jmx: {
          enabled: true
        }
      }
    }
  }
}
```

**Important for Puppet Server 8+**: Do **not** use a bare top-level `enabled = true` under `metrics` in some contexts — the nested `registries.puppetserver.reporters.jmx.enabled` structure (shown above) is the reliable one. You may also see `metrics-allowed` settings in older docs.

### 1.3 Authorization rules (the most common missing piece)

Puppet Server uses authorization rules to decide who can call `/metrics` and `/status`.

#### Recommended: HOCON rules (Puppet Server 6 / 7 / 8)

Edit (or create) `/etc/puppetlabs/puppetserver/conf.d/auth.conf` and add these rules:

```hocon
authorization: {
  version: 1
  rules: [
    {
      match-request: {
        path: "/metrics"
        type: path
        method: [get, post]
      }
      allow: "*"
      sort-order: 500
      name: "openvox-gui allow metrics"
    },
    {
      match-request: {
        path: "/status"
        type: path
        method: get
      }
      allow: "*"
      sort-order: 500
      name: "openvox-gui allow status"
    }
  ]
}
```

Using `allow: "*"` is acceptable here because:
- The GUI is on the same host.
- It is using the master's own CA-signed certificate.
- These are read-only internal endpoints.

#### Alternative: Legacy Ruby-style auth.conf

Some installations still use `/etc/puppetlabs/puppetserver/auth.conf` (the old format). Add:

```
path /metrics
auth any
allow *

path /status
auth any
allow *
```

Place these near the top so they are not overridden by more restrictive rules.

## 2. PuppetDB Configuration

PuppetDB metrics are usually more open, but can still be restricted.

Common locations to check / adjust:

- `/etc/puppetlabs/puppetdb/conf.d/puppetdb.ini`
- Jetty or webserver configuration (certificate allowlists)
- `/etc/puppetlabs/puppetdb/conf.d/auth.conf` (if present)

If you see 403 responses from PuppetDB's `/metrics/v2`, ensure the master's certificate (or `localhost`) is allowed for the metrics paths.

In most default OpenVox/PuppetDB installs on the same machine as Puppet Server, the mTLS connection from the local agent cert works without extra changes.

## 3. Restart Services

After making changes:

```bash
sudo systemctl restart puppetserver
sudo systemctl restart puppetdb
```

Then restart the GUI so it picks up fresh data:

```bash
sudo systemctl restart openvox-gui
```

## 4. Verify the Endpoints Work

Run these commands **on the OpenVox Server** as root (or sudo):

```bash
CERT=$(puppet config print hostcert)
KEY=$(puppet config print hostprivkey)
CA=$(puppet config print localcacert)

echo "=== Puppet Server status (debug) ==="
curl -sS --cert "$CERT" --key "$KEY" --cacert "$CA" \
  "https://localhost:8140/status/v1/services/master?level=debug" | head -c 2000

echo
echo "=== Puppet Server metrics list ==="
curl -sS --cert "$CERT" --key "$KEY" --cacert "$CA" \
  "https://localhost:8140/metrics/v2/list" | head -c 1000

echo
echo "=== PuppetDB metrics list ==="
curl -sS --cert "$CERT" --key "$KEY" --cacert "$CA" \
  "https://localhost:8081/metrics/v2/list" | head -c 1000
```

If these return JSON (even if some fields are empty), the GUI should be able to read them.

## 5. Using the OpenVox GUI Config Editor

You can edit these files directly from the web interface:

1. Log in as admin/operator
2. Go to **Settings → Application Configuration → Puppet Configuration**
3. Find and edit:
   - `puppetserver.conf`
   - `metrics.conf`
   - `auth.conf` (under puppetserver)

The editor will create `metrics.conf` if it does not exist.

Always restart `puppetserver` after changes.

## 6. What to Expect in the GUI

- **Run Performance** — heavy use of PuppetDB Jolokia metrics + some Puppet Server data
- **PuppetDB Health** — JVM, queues, storage timing, connection pools
- **OpenVox Server Health** — JVM heap, GC, http route timing (from experimental status), JRuby
- Many pages have a **"Additional Server Metrics (raw)"** or raw data section — use this to see exactly what the backend is receiving

If charts are empty or show only zeros after configuration + restart, click the raw blocks and look for 403s, empty objects, or key name differences.

## 7. Troubleshooting

| Symptom                        | Likely Cause                                      | Fix |
|--------------------------------|---------------------------------------------------|-----|
| Empty Server Health charts     | Missing auth rules or http-client metrics         | Add auth rules + `metrics-enabled: true` |
| 403 on /metrics or /status     | Authorization rules blocking the master's cert    | Add the rules above with `allow: "*"` or the exact certname |
| JMX data missing               | `metrics.conf` not present or wrong structure     | Use the registries example above |
| Only partial data              | Using old top-level `enabled` in metrics.conf     | Switch to the nested structure |
| Works in curl but not GUI      | GUI using wrong cert path or wrong hostname       | Check `.env` / settings for `puppet_ssl_*` paths |
| Data appears after delay       | Caching (30s in backend) + browser localStorage   | Hard refresh + wait 30–60s |

You can also use the **ovox CLI**:

```bash
ovox infra health
```

## 8. Security Notes

- The `allow: "*"` rules above only affect the two read-only paths (`/metrics` and `/status`).
- These endpoints do not allow code execution or configuration changes.
- If you run in a high-security environment, restrict `allow` to the exact master certificate name instead of `*`.

Example tighter rule:

```hocon
allow: [ "puppet.example.com", "localhost" ]
```

Replace with your actual `puppet config print certname`.

---

After completing this setup, the full power of the Metrics section (performance trends, JVM health, database pools, route timing, etc.) will be available.

See also:
- [TUNING.md](TUNING.md) for using the metrics data to tune your infrastructure
- The raw data viewers inside each Metrics page for live diagnostics
