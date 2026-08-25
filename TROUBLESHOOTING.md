# Troubleshooting Guide

**OpenVox GUI Version 3.12.1-dev.2**

This guide helps you solve common problems with OpenVox GUI. Think of it as your "fix-it" manual - we'll start with the most common issues and work our way to more complex ones.

**Related docs:** [FEATURES.md](docs/FEATURES.md) · [VIP_SESSIONS.md](docs/VIP_SESSIONS.md) · [ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Table of Contents

1. [Quick Fixes (Try These First!)](#quick-fixes-try-these-first)
2. [Login and Access Problems](#login-and-access-problems)
3. [VIP / dual-console session thrash (3.12+)](#vip--dual-console-session-thrash-312)
4. [Service Won't Start](#service-wont-start)
5. [Connection Problems](#connection-problems)
6. [Performance Issues](#performance-issues)
7. [Display and UI Problems](#display-and-ui-problems)
8. [Data and Report Issues](#data-and-report-issues)
8a. [GUI node count ≠ PuppetDB](#gui-node-count--puppetdb)
9. [Certificate Problems](#certificate-problems)
10. [CA log noise (already signed / no CSR)](#ca-log-noise-already-signed--no-csr)
11. [Update and Deployment Issues](#update-and-deployment-issues)
12. [Getting More Help](#getting-more-help)

---

## Quick Fixes (Try These First!)

Before diving into specific problems, try these common fixes that solve 80% of issues:

### 1. Restart the Service

```bash
sudo systemctl restart openvox-gui
```

### 2. Check the Service Status

```bash
sudo systemctl status openvox-gui
```

Look for:

- ✅ Green "active (running)" status
- ❌ Red "failed" or "inactive" status

### 3. Clear Your Browser Cache

- **Windows/Linux**: Press `Ctrl + F5`
- **Mac**: Press `Cmd + Shift + R`

### 4. Check the Logs

```bash
# View recent errors
sudo journalctl -u openvox-gui -p err -n 50

# View all recent logs
sudo journalctl -u openvox-gui -n 100
```

### 5. Verify Network Connectivity

```bash
# Can you reach OpenVoxDB?
ping -c 2 openvox.yourcompany.com

# Is the port accessible?
telnet openvox.yourcompany.com 8081
```

If these don't fix your problem, continue to the specific sections below.

---

## Login and Access Problems

### Problem: Can't Access the Web Interface

**Symptoms:**

- Browser shows "This site can't be reached"
- Connection timeout errors

**Solutions:**

1. **Check if the service is running:**

   ```bash
   sudo systemctl status openvox-gui
   # Should show "active (running)"
   ```

2. **Check if the port is open (and whether IPv4, IPv6, or dual):**

   ```bash
   # See what address family the GUI is actually listening on
   sudo ss -tlnp | grep -E '4567|uvicorn'
   #   0.0.0.0:4567   → IPv4 only
   #   :::4567 or [::]:4567 → IPv6 (often dual-stack)
   ```

   Test reachability from the box:
   ```bash
   curl -v http://localhost:4567/health          # works for most bindings
   curl -v -g http://[::1]:4567/health           # explicit IPv6 loopback
   curl -v http://127.0.0.1:4567/health          # explicit IPv4 loopback
   ```

3. **Check firewall settings:**

   ```bash
   # For Red Hat/CentOS:
   sudo firewall-cmd --list-all

   # For Ubuntu:
   sudo ufw status
   ```

4. **Open the firewall port if needed:**

   ```bash
   # For Red Hat/CentOS:
   sudo firewall-cmd --permanent --add-port=4567/tcp
   sudo firewall-cmd --reload

   # For Ubuntu:
   sudo ufw allow 4567/tcp
   ```

5. **Try accessing locally first:**
   ```bash
   curl -k https://localhost:4567/health
   # Should return: {"status":"ok","version":"3.12.1-dev.2"}
   ```

### Problem: Forgot Admin Password

**Solution:**

Reset the admin password:

```bash
sudo /opt/openvox-gui/venv/bin/python /opt/openvox-gui/scripts/manage_users.py passwd admin
# Enter new password when prompted
```

Or create a new admin user:

```bash
sudo /opt/openvox-gui/venv/bin/python /opt/openvox-gui/scripts/manage_users.py add newadmin --role admin
```

### Problem: "Invalid Credentials" Error

**Solutions:**

1. **Check if caps lock is on** (seriously, it happens!)

2. **Verify the username exists:**

   ```bash
   sudo /opt/openvox-gui/venv/bin/python /opt/openvox-gui/scripts/manage_users.py list
   ```

3. **Reset the password:**

   ```bash
   sudo /opt/openvox-gui/venv/bin/python /opt/openvox-gui/scripts/manage_users.py passwd username
   ```

4. **Check if authentication is enabled:**
   ```bash
   grep AUTH_BACKEND /opt/openvox-gui/config/.env
   # local users: AUTH_BACKEND=local
   # LDAP users: AUTH_BACKEND=ldap (or local+LDAP enabled) and manage_users list shows auth_source=ldap
   ```

5. **Clustered consoles — LDAP works on ATLC but not PDXC (or the reverse):**
   Compare `OPENVOX_GUI_SECRET_KEY` and `OPENVOX_GUI_DATABASE_URL` on **both** hosts. They must match. See [docs/LDAP.md](docs/LDAP.md) (Bind Failed) and [docs/CLUSTERED_SHARED_DB.txt](docs/CLUSTERED_SHARED_DB.txt).
   ```bash
   sudo /opt/openvox-gui/venv/bin/python /opt/openvox-gui/scripts/manage_users.py list
   sudo journalctl -u openvox-gui -n 80 --no-pager | grep -i ldap
   ```

### Problem: Certificate Warning in Browser

**This is normal!** OpenVox GUI uses a self-signed certificate by default.

**Solution:**

1. Click "Advanced" or "Show Details"
2. Click "Proceed to site" or "Accept Risk and Continue"
3. The warning will appear each time unless you add an exception

To use a real certificate, see the Configuration documentation (SSL wizard under Settings → Application Configuration).

---

## VIP / dual-console session thrash (3.12+)

### Problem: Direct console FQDN works; VIP URL keeps refreshing or logs you out

**Symptoms:**

- `https://openvox.site-a.example.com:4567` and `https://openvox.site-b.example.com:4567` are fine
- Via the load-balancer VIP, Insights/Dashboard auto-refresh “storms” and session ends early

**Cause (3.12 fixed the client amplifier):** multi-backend RR + intermittent 401 used to call `window.location.reload()` on every poll. Remaining infra issues: mismatched `OPENVOX_GUI_SECRET_KEY`, non-shared app DB, different GUI versions per console, or missing VIP hostname config.

**Fix:**

1. Upgrade **both** consoles to **3.12.0** (same version).
2. Identical `OPENVOX_GUI_SECRET_KEY` and shared Postgres `openvox_gui` DSN.
3. Set console VIP hostnames: Settings → Cluster → **Console VIP / public LB hostnames**, or `OPENVOX_GUI_VIP_HOSTS=…` on both hosts.
4. Prefer LB sticky sessions **and** keep app RR-safe.
5. Verify: `curl -sk https://VIP:4567/api/auth/status` → `"access_mode":"vip"`.

Full write-up: [docs/VIP_SESSIONS.md](docs/VIP_SESSIONS.md).

### Problem: `project.version` / pep440 error on deploy (ovox install)

Use PEP 440 pre-release labels only (`rc`, `a`, `b`, `dev`). The string `gamma` is **not** valid for pip/setuptools — the product train may be called “gamma” in notes but the version file must be e.g. `3.12.0-rc.1`.

---

## Service Won't Start

### Problem: Service Fails to Start

**Symptoms:**

```
● openvox-gui.service - OpenVox GUI
   Loaded: loaded
   Active: failed
```

**Solutions:**

1. **Check for detailed errors:**

   ```bash
   sudo journalctl -u openvox-gui -n 100 --no-pager
   ```

2. **Common causes and fixes:**

   **Port already in use:**

   ```bash
   # Find what's using the port
   sudo ss -tlnp | grep 4567

   # Either stop the other service or change OpenVox GUI port
   sudo nano /opt/openvox-gui/config/.env
   # Change APP_PORT=4567 to another port
   ```

   **Permission problems:**

   ```bash
   # Fix ownership
   sudo chown -R puppet:puppet /opt/openvox-gui

   # Fix permissions
   sudo chmod 755 /opt/openvox-gui
   sudo chmod 600 /opt/openvox-gui/config/.env
   ```

   **`extra_forbidden` / `openvox_gui_puppet_ca_host`:**

   The `.env` has keys this build does not define (you set
   `OPENVOX_GUI_PUPPET_CA_HOST` before deploying a build that has that
   setting). Comment those lines out, restart, then upgrade, then
   uncomment. Builds from 3.11.0-alpha.8 ignore unknown keys (and
   define PUPPET_CA_HOST). On 3.11.0-alpha.4 those two lines must stay
   commented or the unit will not start.

   **Certificates page: "Could not read CA certificate":**

   Dedicated consoles have no cadir. The GUI must fetch the issuing CA
   from `https://$OPENVOX_GUI_PUPPET_CA_HOST:8140/puppet-ca/v1/certificate/ca`
   (the VIP, e.g. `ovca.example.com`). Confirm that host is set, the
   console agent `ca.pem` is the **new** estate CA, and corp proxy is
   bypassed (`no_proxy` includes the CA VIP). Failover between ovca1/ovca2
   does not change the issuing cert — only which node presents Jetty.

   **Python dependency issues:**

   ```bash
   cd /opt/openvox-gui
   source venv/bin/activate
   pip install --upgrade -r backend/requirements.txt
   deactivate
   ```

3. **Test configuration manually:**
   ```bash
   cd /opt/openvox-gui
   source venv/bin/activate
   python -c "from backend.app.config import settings; print('Config OK')"
   deactivate
   ```

### Problem: Service Starts Then Immediately Stops

**Solutions:**

1. **Check for configuration errors:**

   ```bash
   sudo nano /opt/openvox-gui/config/.env
   # Verify all settings are correct
   ```

2. **Check SSL certificates exist:**

   ```bash
   ls -la /etc/puppetlabs/puppet/ssl/certs/
   # Should show certificate files
   ```

3. **Verify database is accessible:**
   ```bash
   ls -la /opt/openvox-gui/data/
   # Should show openvox_gui.db
   ```

---

## Connection Problems

### Problem: "Cannot Connect to OpenVoxDB" Errors

**Solutions:**

1. **Verify OpenVoxDB is running:**

   ```bash
   # On the OpenVoxDB server:
   sudo systemctl status puppetdb
   ```

2. **Test connectivity:**

   ```bash
   # From OpenVox GUI server:
   ping openvoxdb.yourcompany.com
   telnet openvoxdb.yourcompany.com 8081
   ```

3. **Check SSL certificates:**

   ```bash
   # Verify certificates exist
   ls -la /etc/puppetlabs/puppet/ssl/certs/*.pem
   ls -la /etc/puppetlabs/puppet/ssl/private_keys/*.pem
   ```

4. **Test OpenVoxDB connection manually:**

   ```bash
   curl --cert /etc/puppetlabs/puppet/ssl/certs/$(hostname -f).pem \
        --key /etc/puppetlabs/puppet/ssl/private_keys/$(hostname -f).pem \
        --cacert /etc/puppetlabs/puppet/ssl/certs/ca.pem \
        https://openvoxdb.yourcompany.com:8081/pdb/query/v4/nodes
   ```

5. **Check configuration:**
   ```bash
   grep PUPPETDB /opt/openvox-gui/config/.env
   # Verify hostname and port are correct
   ```

### Problem: "Cannot Connect to OpenVox Server" Errors

**Solutions:**

1. **Verify OpenVox Server is running:**

   ```bash
   # On the OpenVox Server:
   sudo systemctl status puppetserver
   ```

2. **Check configuration:**

   ```bash
   grep PUPPET_SERVER /opt/openvox-gui/config/.env
   ```

3. **Test connection:**
   ```bash
   curl -k https://openvox.yourcompany.com:8140/puppet/v3/environments
   ```

---

## Performance Issues

### Problem: Dashboard Loads Slowly

**Solutions:**

1. **Increase worker processes:**

   ```bash
   sudo nano /opt/openvox-gui/config/.env
   # Change UVICORN_WORKERS=2 to 4 or 8
   sudo systemctl restart openvox-gui
   ```

2. **Check system resources:**

   ```bash
   # CPU and memory usage
   top

   # Disk space
   df -h
   ```

3. **Check database size:**

   ```bash
   ls -lh /opt/openvox-gui/data/openvox_gui.db
   # If very large (>100MB), consider cleanup
   ```

4. **Optimize OpenVoxDB queries:**
   - Reduce the time range for report queries
   - Limit the number of nodes displayed

### Problem: High Memory Usage

**Solutions:**

1. **Reduce worker count:**

   ```bash
   sudo nano /opt/openvox-gui/config/.env
   # Change UVICORN_WORKERS to 1 or 2
   ```

2. **Restart service to clear memory:**

   ```bash
   sudo systemctl restart openvox-gui
   ```

3. **Check for memory leaks:**
   ```bash
   # Monitor memory over time
   watch -n 5 'ps aux | grep openvox-gui'
   ```

---

## Display and UI Problems

### Problem: Page Shows Old Version After Update

**Solutions:**

1. **Hard refresh your browser:**
   - Windows/Linux: `Ctrl + F5`
   - Mac: `Cmd + Shift + R`

2. **Clear all browser data:**
   - Chrome: Settings → Privacy → Clear browsing data
   - Firefox: Settings → Privacy → Clear Data

3. **Try incognito/private mode** to confirm it's a cache issue

### Problem: Charts or Graphs Not Displaying

**Solutions:**

1. **Check browser console for errors:**
   - Press `F12` to open developer tools
   - Go to Console tab
   - Look for red error messages

2. **Verify data is being returned:**

   ```bash
   curl -k https://localhost:4567/api/dashboard/stats
   ```

3. **Check for JavaScript errors:**
   - Disable browser extensions
   - Try a different browser

### Problem: Theme Not Switching

**Solutions:**

1. **Clear local storage:**
   - Open browser developer tools (F12)
   - Go to Application/Storage tab
   - Clear Local Storage for the site

2. **Manually set theme:**
   ```javascript
   // In browser console:
   localStorage.setItem("theme", "formal"); // or 'casual'
   location.reload();
   ```

---

## Data and Report Issues

### Problem: No Nodes Appearing in Dashboard

**Solutions:**

1. **Verify OpenVoxDB has data:**

   ```bash
   # Check OpenVoxDB directly
   curl -k https://localhost:8081/pdb/query/v4/nodes
   ```

2. **Check time synchronization:**

   ```bash
   # Ensure time is correct
   date

   # Sync time if needed
   sudo ntpdate -s time.nist.gov
   ```

3. **Verify OpenVox agents are reporting:**
   ```bash
   # On an OpenVox agent:
   sudo puppet agent -t
   ```

4. **Dedicated console (GUI not on the CA):** do **not** install
   `openvox-server`. Set `OPENVOX_GUI_PUPPET_CA_HOST` to the CA VIP
   (e.g. `ovca.example.com`) after deploying **3.11.0-alpha.8+**, and
   allow the console certname in CA `auth.conf`. Point
   `OPENVOX_GUI_PUPPET_SSL_*` at this host’s agent cert/key/`ca.pem`
   (not `localhost.pem`). `load_cert_chain` `FileNotFoundError` means
   those paths are wrong or unreadable by the `puppet` user.

5. **Empty Overview but Compliance shows unreported nodes:** the GUI
   was intersecting PuppetDB with a local `puppetserver ca list` that
   returned zero certs. 3.11.0-alpha.8 uses the remote CA HTTP API
   instead. Compilers still need `reports = store,puppetdb` and an
   agent run before graphs fill in.

### Problem: Node stays Failed after a successful agent run

**Cause:** The badge is the **newest report document** for that exact
certname (by `receive_time`). OpenVoxDB's `latest_report?` flag and the
node-index field can stick on an older `failed` row — especially on a
clustered / Spock mesh — after a later unchanged/changed report exists.

**What the GUI does (3.11.1-beta.5+):**
1. Merge `latest_report?` with a recent reports window; newest
   `receive_time` wins (sites stay isolated — `ovca1.site-a` ≠ `ovca1.site-b`).
2. If Orchestration recorded a newer successful `puppet agent` run and
   the compiler never stored that report, the badge follows the live run.

**Check the real newest report** (no `order by` in PQL — OpenVoxDB
rejects it):

```
reports[hash, status, receive_time, producer] { certname = "ovca1.site-a.example.com" }
```

Sort the result by `receive_time` yourself. Compilers need
`reports = store,puppetdb` in `[server]` (not the agent's `[main]`).

`puppet config print ssldir` via Bolt as the `bolt` user prints
`/home/bolt/.puppetlabs/etc/puppet/ssl`. That is not the CA mount.
Use `sudo puppet config print ssldir`.

### Problem: Reports Missing or Incomplete

**Solutions:**

1. **Check report processor on OpenVox Server:**

   ```bash
   grep reports /etc/puppetlabs/puppet/puppet.conf
   # Should include "puppetdb"
   ```

2. **Verify reports are being stored:**

   ```bash
   # Query OpenVoxDB for recent reports
   curl -k https://localhost:8081/pdb/query/v4/reports?limit=10
   ```

3. **Check report retention settings in OpenVoxDB**

### Problem: Facts Not Showing in Fact Explorer

**Solutions:**

1. **Refresh fact cache:**

   ```bash
   # On OpenVox agents:
   sudo puppet facts upload
   ```

2. **Check fact terminus:**
   ```bash
   grep facts_terminus /etc/puppetlabs/puppet/puppet.conf
   # Should be "puppetdb"
   ```

---

## GUI node count ≠ PuppetDB

New estate or two-console cutover: read [docs/CLUSTERED_SHARED_DB.txt](docs/CLUSTERED_SHARED_DB.txt) first. There are **two** databases (`puppetdb` vs `openvox_gui`) and **two** Spock meshes. `/nodes` is catalogs, not `INSERT` into `certnames`.

**Symptoms:** `ovox nodes list` shows 7 (or 8) names; `SELECT count(*) FROM certnames` on an ovdb is 16.

**This is not a cache.** Three different numbers:

| Source | What it counts |
|--------|----------------|
| `certnames` SQL | Every row, including stubs you INSERTed |
| `GET /pdb/query/v4/nodes` | Nodes with a **catalog** (what the GUI uses) |
| CA `ca/signed` | Signed PEMs, including hosts that never reported |

**Fix (automated check):**

```bash
sudo /opt/openvox-gui/scripts/cluster-preflight.sh
```

Typical causes this script catches:

1. `/etc/hosts` pins `ovdb.example.com` to **one** site VIP. `hosts: files dns` then never sees the other A record. Delete that line. Members (`ovdb1`/`ovdb2`) may stay in hosts.
2. VIP A records (`.78`) are **not** the member IPs (`.76`/`.77`). Probe `/nodes` on **every** A record — they must match.
3. Dashboard **Failed** after a good `puppet agent -t`: the new report is on the other site’s PDB. Compile once against the other site’s compiler, or put `reports` in the Spock `default` set.

Never `INSERT` into `certnames`/`factsets`/`catalogs` and expect `/nodes` to change. Never `sub_resync_table` on `certnames`. Grant origin functions with `scripts/ensure-puppetdb-spock.sh` on every ovdb.

### Unreported on Overview vs Unchanged on Node Detail

Overview, Nodes, and Node Detail use the **same** newest-report
status (after rc.47). A node is **Unreported** only when this GUI’s
OpenVoxDB has no `latest_report_status` / no report document for that
certname. A day-old Unchanged or Failed report keeps that status on
every page. Needs attention still lists reports older than 24 hours.

**Needs attention differs by console** (ATLC has six, PDXC has none):
each console’s `ovdb.example.com` A record is one site VIP, and
reports often do not replicate. After rc.48 the GUI merges the newest
report from peer OpenVoxDBs (`puppetdb_nodes`, `dns_rr_vips`,
`ovdb.<site>` derived from consoles, and
`OPENVOX_GUI_PUPPETDB_PEERS`). Both consoles then show the same
attention list. Until that build is on **both** GUIs, the list follows
whichever `.78` stored the last report.

It is **not** “puppet agent -tv printed Applied.” The report must exist
on **this** PDB (often `ovdb.example.com` → one site). An ATLC compile stores
the report on ATLC; PDXC can still say Unreported.

**See why one name is Unreported** (console, as root):

```bash
CERT=/etc/puppetlabs/puppet/ssl/certs/$(puppet config print certname).pem
KEY=/etc/puppetlabs/puppet/ssl/private_keys/$(puppet config print certname).pem
CA=/etc/puppetlabs/puppet/ssl/certs/ca.pem
CN=THE.CERT.NAME

for ip in 192.0.2.76 198.51.100.76; do
  echo "=== $ip ==="
  curl -sk --cert "$CERT" --key "$KEY" --cacert "$CA" \
    --resolve "ovdb.example.com:8081:${ip}" \
    -G 'https://ovdb.example.com:8081/pdb/query/v4/nodes' \
    --data-urlencode "query=[\"=\",\"certname\",\"${CN}\"]" \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); n=(d[0] if d else {});
print("status", n.get("latest_report_status"), "report", n.get("report_timestamp"))'
done
```

**Clear it:** a new report on the PDB that showed `None` / old timestamp:

```bash
/opt/puppetlabs/bin/puppet agent -tv --server ovcompiler1.site-a.example.com
```

(Use an ATLC compiler if the empty side is `.160.76`.) Then hard-refresh
Overview and Monitoring. Both must list the same Unreported certnames.

Live-fleet rules and HAProxy vs DNS RR: [docs/FEATURES.md](docs/FEATURES.md#live-fleet-membership-cross-cutting-rule).

## Certificate Problems

### Problem: Can't Sign Certificates

**Solutions:**

1. **Verify sudo permissions:**

   ```bash
   sudo cat /etc/sudoers.d/openvox-gui-users
   # Should allow puppetserver ca commands
   ```

2. **Check OpenVox CA service:**

   ```bash
   sudo puppetserver ca list --all
   ```

3. **Manually sign certificates:**
   ```bash
   sudo puppetserver ca sign --certname node.example.com
   ```

4. **Dedicated console:** list/info use the CA HTTP API
   (`OPENVOX_GUI_PUPPET_CA_HOST` = CA VIP). **Sign / revoke / clean**
   try that PUT first; if it 404s (standby VIP / CSR on the other
   ovca), the GUI Bolts `puppetserver ca …` as root on each
   **Settings → Cluster → CA members** (`ovca1`/`ovca2`, not the DNS
   VIP) until one succeeds. Confirm `bolt@` SSH + sudo to those hosts.

### Problem: Certificate Expiration Warnings

**Solutions:**

1. **Check certificate dates:**

   ```bash
   sudo puppetserver ca list --all
   openssl x509 -in /path/to/cert.pem -noout -dates
   ```

2. **Regenerate expiring certificates:**

   ```bash
   # On the agent:
   sudo puppet ssl clean
   sudo puppet agent -t

   # On the server:
   sudo puppetserver ca sign --certname node.example.com
   ```

---

## CA log noise (already signed / no CSR)

These messages appear on the **CA** (`puppetserver` journal), not as GUI bugs.

### `already has a signed certificate; ignoring certificate request`

A client (agent/compiler) is **uploading a CSR** for a name the CA already signed. The CA correctly ignores it. Fix the **client** local SSL (missing `hostcert`, stale CSR, wrong `ssldir` / second tree). Download the signed cert or re-bootstrap once; do not “sign again” forever from the GUI.

### `No certificate request for … at …/ca/requests/….pem`

Something called **sign/reject** (GUI, CLI, or script) but there is **no pending CSR** on disk (already signed, never submitted, or ignore-path above never wrote `requests/`). Harmless if the name is already under `signed/`. Only sign names from `puppetserver ca list` (pending), not from a static host list.

### Dedicated console CA page empty or errors

Console has no local `puppetserver` CA. Requires working mTLS to `OPENVOX_GUI_PUPPET_CA_HOST` and matching auth.conf allow lists for the console certname(s).

---

## Update and Deployment Issues

### Problem: Code Deployment Fails

**Solutions:**

1. **`sudo: sorry, you must have a tty to run sudo`**

   The GUI service runs under systemd with no real TTY. Enterprise
   `Defaults requiretty` rejects bare `sudo` from that context.

   OpenVox GUI defends against this in two layers:

   - **Sudoers**: `Defaults:puppet !requiretty` in
     `/etc/sudoers.d/openvox-gui-users` (written by
     `scripts/ensure-sudoers.sh` on install/update/deploy).
   - **Code path**: Code Deployment and the deploy webhook run r10k
     through `run_sudo` (util-linux `script` + PTY fallback), same as
     CA/Bolt/config reads — **not** bare `subprocess` sudo.

   Quick checks:

   ```bash
   # Service user must be exempt from requiretty
   sudo grep -E 'requiretty|r10k-deploy' /etc/sudoers.d/openvox-gui-users

   # Re-apply canonical sudoers if the Defaults line is missing
   sudo /opt/openvox-gui/scripts/ensure-sudoers.sh

   # Confirm as the service user (no TTY simulation)
   sudo -u puppet sudo -n /opt/openvox-gui/scripts/r10k-deploy.sh -pv
   ```

   If the GUI was updated before 3.10.7-dev.10 and only other pages
   were fixed, redeploy so `backend/app/routers/deploy.py` uses
   `run_sudo` for r10k.

2. **Check r10k configuration:**

   ```bash
   sudo r10k deploy display
   ```

3. **Verify Git access:**

   ```bash
   # Test Git repository access
   git ls-remote https://your-git-repo.com/control-repo.git
   ```

4. **Check sudo permissions:**

   ```bash
   grep r10k /etc/sudoers.d/openvox-gui-users
   ```

5. **Run r10k manually to see errors:**
   ```bash
   sudo /opt/openvox-gui/scripts/r10k-deploy.sh -pv
   # or:
   sudo r10k deploy environment -pv
   ```

### Problem: Clustered Stage / Activate shows `API Error 500: Internal Server Error`

The Stage banner is drawn **before** the POST. A generic 500 means uvicorn
hid an uncaught exception (production FastAPI does not send the traceback
to the browser).

**Solutions:**

1. **Read the real error on the console** (this host runs uvicorn only):

   ```bash
   journalctl -u openvox-gui -n 120 --no-pager
   ```

2. **After 3.11.0-alpha.30** the endpoint returns `200` with `success: false`
   and the OpenBolt output in the log pane instead of a bare 500. Update the
   console (`git pull` + `sudo ./scripts/update_local.sh`) and Stage again.

3. **Compilers need `bolt@` SSH** from the console. Stage uses OpenBolt
   (`sudo -u bolt bolt script run … --run-as root`). If compilers do not
   have `profiles::base::bolt_user` + this console's `id_bolt.pub`, you
   will see `AUTH_ERROR` / publickey — that is the real failure, not a 500.

   ```bash
   sudo -u bolt bolt command run 'true' \
     --targets ovcompiler1.site-a.example.com \
     --project /etc/puppetlabs/bolt
   ```

4. **r10k lives on the compilers**, not on the GUI host. `bolt script run`
   uploads `r10k-stage-activate.sh`. Each compiler still needs r10k +
   `/etc/puppetlabs/r10k/r10k.yaml`.

5. **Stage says exit code 1 on every compiler, but `r10k` and Bolt
   `command run` work.** That is not a second Bolt identity. The SSH probe
   (`bolt command run true`) already succeeded as `bolt@`. Stage then uses
   `bolt script run`, which **uploads the helper to the target tmpdir and
   executes it**. CIS (`cisecurity::partitions`) mounts `/tmp` `noexec`, so
   the kernel refuses the uploaded script. Confirm on a compiler:

   ```bash
   findmnt -no OPTIONS /tmp
   # expect: defaults,rw,nosuid,nodev,noexec,...
   ```

   After 3.11.0-alpha.46 the GUI inventory sets
   `ssh.tmpdir: /home/bolt/.bolt/tmp` (home is executable) and Stage uses
   `--format json` so the log pane shows the script's real stderr instead of
   only `The command failed with exit code 1`.

   **`TMPDIR_ERROR` / `Could not make tmpdir:`** means that path did not
   exist. OpenBolt runs `mkdir -m 700 $tmpdir/<uuid>` with **no** `-p`.
   `install.sh`, `update_local.sh`, and `enable-console-orchestration.sh`
   create it on the console. On every compiler (or classify
   `profiles::base::bolt_user`):

   ```bash
   install -d -o bolt -g bolt -m 700 /home/bolt /home/bolt/.bolt /home/bolt/.bolt/tmp
   ```

   After 3.11.0-alpha.47 Stage also runs that `install -d` as root via Bolt
   before `script run`. The inventory warning about `host-key-check` /
   `run-as` / `connect-timeout` is Bolt noise — those CLI flags overlap
   inventory keys; it does **not** mean a different SSH user.

6. **Stage spinner, no log, only one compiler has r10k.** The GUI waits
   for **every** target. A host with r10k can run for minutes; hosts
   without it die immediately. After 3.11.0-alpha.49 Stage probes r10k +
   `r10k.yaml` first and returns `MISSING_R10K` instead of hanging.
   Bootstrap the other compilers:

   ```bash
   # On each compiler as root, or from the console via Bolt:
   sudo /opt/openvox-gui/scripts/bootstrap-compiler.sh
   # then copy yaml from the working compiler
   scp ovcompiler1.site-a.example.com:/etc/puppetlabs/r10k/r10k.yaml \
     /etc/puppetlabs/r10k/r10k.yaml
   ```

7. **`R10K_TOKEN` in `/etc/profile.d/r10k.sh` works in my shell but Stage
   clones `https://@github.com/…`.** `/etc/profile.d` is only read by
   **login** shells (`ssh`, `sudo -i`, `bash -l`). Stage is:

   `bolt@` SSH → `sudo` to root → uploaded script.

   That is non-login. `bolt` never needs the token. Root running the
   helper does. After 3.11.0-alpha.52 the helper explicitly sources, in
   order:

   1. `/etc/puppetlabs/r10k/environment` (preferred, `0600`)
   2. `/etc/sysconfig/r10k`
   3. `/etc/profile.d/r10k.sh` (your file — now read on purpose)
   4. token scraped from the control-repo URL in `r10k.yaml`

   Long-term (Puppet): manage `/etc/puppetlabs/r10k/environment` from
   Hiera/eyaml. Keep profile.d as a one-liner `. /etc/puppetlabs/r10k/environment`
   so interactive root matches Bolt.

8. **Stage is painfully slow.** Four compilers each sync ~80 Forge
   modules through one ATLC proxy, and Bolt waits for the slowest.
   ovcompiler1.site-a with `proxy=none` added ~135s of `github.com:443`
   hang. After 3.11.0-alpha.53: shared r10k cache, `forge.proxy`,
   `--incremental`, 20s git stall timeout, 15-minute Bolt cap.
   First Stage after an empty cache is still minutes. Warm cache +
   proxy on **every** compiler should be tens of seconds. Do not
   Stage **All Environments** unless you mean it.

9. **Stage reaches r10k then dies on github.com:443 or forgeapi.puppet.com:443.**
   Same corp proxy gap, two clients:
   - **git** (control repo) reads root `git config http.proxy`
   - **Forge** (Puppetfile modules) reads only `HTTPS_PROXY` / `https_proxy`

   Interactive `r10k` in a login shell can work while Stage fails. After
   3.11.0-alpha.50 the helper copies git's proxy into `HTTPS_PROXY`. Still
   set both on every compiler (and later in Puppet):

   ```bash
   sudo git config --global http.proxy  http://httpproxy.example.com:3128
   sudo git config --global https.proxy http://httpproxy.example.com:3128
   echo 'export HTTPS_PROXY=http://httpproxy.example.com:3128' \
     | sudo tee /etc/profile.d/https_proxy.sh
   ```

### Problem: Data | Hiera Data Files shows a stock / empty hiera.yaml

Dedicated consoles do not have the control repo. The unused file is
`/etc/puppetlabs/puppet/hiera.yaml`. After 3.11.0-alpha.55 the page
reads `/etc/puppetlabs/code/environments` on the first
`code_deploy_targets` compiler via Bolt. Stage that environment first.
Do not `git clone` the control repo onto the GUI host.

### Problem: Overview | Nodes play button shows `API Error 500`

The play button is `POST /api/bolt/run/command` (`puppet agent -t` via
OpenBolt). Production uvicorn hides the traceback as a generic 500.

**Solutions:**

1. **After 3.11.0-alpha.31** the endpoint returns the real Bolt/`error`
   string in the toast. Update the console and click play again.

2. **Check the console journal** (before or after the update):

   ```bash
   journalctl -u openvox-gui -n 120 --no-pager
   ```

   Look for `execution_history start failed` or `POST /bolt/run/command failed`.

3. **AUTH_ERROR / publickey** means `bolt@` is missing on that target (see
   `profiles::base::bolt_user`). That is not a GUI 500 once alpha.31 is on
   the console.

### Problem: Orchestration (OpenBolt) Not Working

**Solutions:**

1. **Verify OpenBolt is installed:**

   ```bash
   which bolt
   bolt --version
   ```

2. **Install OpenBolt if missing:**

   ```bash
   # Red Hat/CentOS:
   sudo yum install openbolt

   # Ubuntu/Debian:
   sudo apt install openbolt
   ```

3. **Check OpenBolt project configuration:**
   ```bash
   cat /opt/openvox-gui/bolt-project.yaml
   ```

4. **Inventory / targets:** Prefer ENC groups or PuppetDB-backed targets from the GUI Target selector. Sync inventory if you still maintain a static file: Orchestration inventory sync or `openvox_enc` plugin (see [bolt-plugin/README.md](bolt-plugin/README.md)).

### Problem: One click on Run Command runs the shell command three times on targets

**Symptom:** Browser Network tab shows three `POST /api/bolt/run/command` (or task/plan) calls; append-to-file tests write three lines; CLI `bolt command run` on the server is only once.

**Cause (fixed in 3.10.1.b2 / 3.10.2):** Older GUIs requested **human**, **json**, and **rainbow** Bolt formats in **parallel**, so each click executed Bolt **three times**. Not a React double-mount alone.

**Fix:** Upgrade to **3.10.2** (or at least **3.10.1.b2**). After upgrade you should see **one** Network POST per confirm/click; result tabs share that single run. See [GitHub #38](https://github.com/cvquesty/openvox-gui/issues/38).

### Problem: Orchestration `puppet agent -t` fails on some nodes but works over SSH

**Symptom:** Infrastructure → Orchestration → Run Command with `puppet agent -t` (privileged) shows Bolt **failure** for one or more targets. SSH as yourself and `sudo puppet agent -t` works. JSON result may include:

```text
Notice: Run of Puppet configuration client already in progress; skipping
(/opt/puppetlabs/puppet/cache/state/agent_catalog_run.lock exists)
```

with `"exit_code": 1` and `puppetlabs.tasks/command-error`. Other targets in the same run may show `"status":"success"` and a full catalog apply.

**What is going on (usually not “Bolt is broken”):**

1. **Lock contention** — the OpenVox **agent service** (or another GUI/cron run) is already applying a catalog on that node. Puppet refuses a second run and exits **1**. Your interactive SSH session often runs when no lock is held, so it succeeds.
2. **Partial fleet** — Bolt runs in **parallel** across targets. One locked node fails; others succeed. The overall Bolt return code is non-zero if **any** target fails, so the GUI can look “all red” even when two of three nodes applied fine. Read the **items** array (JSON tab), not only the top-level failure styling.
3. **Exit code 2** — a full apply **with changes** exits **2**. That is success for Puppet; older GUI/history paths treated only `0` as success. **3.10.2+bugfix** (release **3.10.2-bugfix**) treats Puppet agent **0** and **2** as success and adds `--waitforlock` on GUI agent runs.

**What to do now (lab / any version):**

```bash
# On the failing agent — is a run in progress or a stale lock?
sudo ls -la /opt/puppetlabs/puppet/cache/state/agent_catalog_run.lock
sudo systemctl status puppet   # or puppet.service / openvox-agent — name varies

# Wait for the daemon, or if you are sure no agent is running (stale lock only):
# sudo rm -f /opt/puppetlabs/puppet/cache/state/agent_catalog_run.lock   # only if process is dead
```

Retry Orchestration after the lock clears. Prefer **Nodes → Run OpenVox** per node if you need serial runs.

**Fixed/improved in 3.10.2+bugfix** (GitHub **v3.10.2-bugfix**): GUI-normalized `puppet agent` commands include **`--waitforlock 300`**, longer Bolt timeout for agent runs, clearer lock hints in stderr, and success semantics for exit **0/2**. (Briefly labeled **3.10.3** on one commit; prefer this bugfix line.)

---

### Problem: Executive Summary Report “sends” but email never arrives (mailq empty)

**Symptom:** You configured Postfix on the OpenVox GUI host. From the GUI you add a recipient and click **Send**. The UI reports success / queued. `mailq` is **empty**. The message **never** shows up in Gmail (or other external inbox). Local tests with `mail` “work” in the sense that the command exits 0.

**First check (common on upgrades before 3.10.3b7):** the generator script may never have been **deployed** to the install tree. Install/update used to copy only a whitelist of scripts (`enc.py`, `manage_users.py`, …) and **omitted** `generate_fleet_health_report.py`. The GUI still returns `"queued"`, then logs `Could not find generate_fleet_health_report.py` and exits — **nothing reaches Postfix**.

```bash
# Expected path on a normal install
ls -la /opt/openvox-gui/scripts/generate_fleet_health_report.py
# If missing: redeploy a build that includes it in deploy.sh / update_local.sh / install.sh,
# or copy from the release tree, then:
sudo chown puppet:puppet /opt/openvox-gui/scripts/generate_fleet_health_report.py
sudo chmod 755 /opt/openvox-gui/scripts/generate_fleet_health_report.py
sudo journalctl -u openvox-gui --since '10 min ago' | grep -i generate_fleet
```

**How the GUI sends mail (important):**

1. Backend runs `scripts/generate_fleet_health_report.py --live --email …` (optional `--from-email`) under `INSTALL_DIR` (default `/opt/openvox-gui`).
2. That script builds a PDF, then invokes **`mail` / `mailx`** with `-a` attachment — **not** Python SMTP, **not** Postfix’s HTTP API.
3. `mail` only hands the message to the **local MTA (Postfix)**. Exit code **0** means “Postfix accepted it,” **not** “Gmail delivered it.”
4. The GUI updates `last_sent_at` when the job is **queued**, even before delivery is proven.

So an empty `mailq` is **consistent with both**:

- Fast **failure** (bounce / deferral expired / removed), or  
- Fast **local** delivery (wrong domain treated as local), or  
- Message already **left** the queue toward a remote MX that then timed out and was later discarded.

**Typical causes when “Postfix is configured” but remote mail never arrives:**

| Check | What it tells you |
|--------|-------------------|
| `postfix` active, no or wrong `relayhost` | Direct-to-MX uses **TCP/25** to the recipient’s MX |
| Host firewall allows egress | Problem may still be **upstream** of the GUI host |
| `tcpdump` / `nc` to a public MX on port **25** | **SYN with no SYN-ACK** ⇒ path blocked before SMTP speaks (network policy, not the GUI) |
| `maillog`: `Connection timed out` on **:25** | Direct delivery never completes |
| Recipient domain is also in `mydestination` | Postfix may deliver **locally** instead of to an external MX |
| GUI / `mail` exit 0 | Only proves **local MTA accepted** the message |

**If you intend direct MX delivery**, confirm the **path** (not only Postfix application config):

```bash
# SYNs leave the host? (run with sufficient privileges)
sudo tcpdump -ni any 'tcp port 25' -c 5 &
nc -4 -vz mx.example.com 25
# If you see SYN but no handshake, the GUI is not the fault.

# Optional: prefer IPv4 for MX lookups
sudo postconf -e 'inet_protocols = ipv4'
sudo postconf -e 'smtp_address_preference = ipv4'
sudo systemctl reload postfix
```

**If egress TCP/25 is blocked or unreliable** (common on many networks): use a **smarthost on 587/465** (authenticated submission) or another MTA you control that *can* deliver. That is an **MTA/network** concern; OpenVox GUI only hands mail to the local MTA.

**Secondary causes:**

1. **From: address** — set **From email** in Executive Summary to an address allowed by SPF/DKIM for your sending path.
2. **Local domain collision** — recipient domain listed in `mydestination` may force local delivery.
3. **Service user** — generator runs as the GUI service user; that account must be able to run `mail`/`mailx`.

**Fix patterns (operator MTA — examples only):**

**A. Authenticated smarthost (submission)**

```bash
# Replace host/user with your provider; protect secrets (mode 0600)
sudo postconf -e 'relayhost = [smtp.example.com]:587'
sudo postconf -e 'smtp_sasl_auth_enable = yes'
sudo postconf -e 'smtp_sasl_password_maps = hash:/etc/postfix/sasl_passwd'
sudo postconf -e 'smtp_sasl_security_options = noanonymous'
sudo postconf -e 'smtp_tls_security_level = encrypt'
# /etc/postfix/sasl_passwd:
# [smtp.example.com]:587    user@example.com:secret
sudo postmap /etc/postfix/sasl_passwd
sudo chmod 600 /etc/postfix/sasl_passwd /etc/postfix/sasl_passwd.db
sudo systemctl reload postfix
```

**B. Internal mail relay you operate**

```bash
sudo postconf -e 'relayhost = [mail.example.com]:587'   # or :25 if your network allows
# Trust GUI host via mynetworks and/or SMTP AUTH on the relay
sudo systemctl reload postfix
```

**C. Direct MX**

Only where **outbound TCP/25** to the public Internet works end-to-end and sending IP reputation/SPF/DKIM are correct.

**Verify:**

```bash
echo "test body" | mail -s "openvox-gui MTA test" -r 'reports@example.com' you@example.com
mailq
sudo tail -50 /var/log/maillog          # RHEL-family
# or: sudo journalctl -u postfix -n 50

sudo -u puppet /opt/openvox-gui/venv/bin/python \
  /opt/openvox-gui/scripts/generate_fleet_health_report.py --live \
  --email you@example.com --from-email reports@example.com
sudo journalctl -u openvox-gui -n 40 --no-pager | grep -i executive
```

Prefer `status=sent` via your intended **relay or MX**, not repeated `connect …:25: Connection timed out`.

**GUI checklist:** real external recipients; **From** aligned with the sending path; after **Send**, check `journalctl -u openvox-gui` and MTA logs—not only an empty `mailq`.

**Code note:** OpenVox GUI does not ship site-specific MTA credentials; operators configure Postfix (or another MTA) on the host. The GUI cannot fix a blocked outbound SMTP path by itself.

---

## Agent Installer Problems *(3.6.0+)*

For issues specific to the local OpenVox package mirror and the
`curl ... | sudo bash` agent install workflow, see
[docs/INSTALLER.md](docs/INSTALLER.md) -- it has the full feature
guide plus a dedicated troubleshooting section. Quick reference for
the most common gotchas:

### Problem: `curl https://server:8140/packages/install.bash` returns ~378 bytes of HTML

Puppetserver wasn't restarted after the openvox-gui upgrade dropped
its static-content mount config. The HTML is puppetserver's default
"unknown path" page.

```bash
sudo systemctl restart puppetserver
sudo systemctl is-active puppetserver
```

After the restart, the URL should return the install.bash script
(~17 KB).

### Problem: `bash: --server: invalid option`

You appended args to the one-liner without `bash -s --` between
`bash` and them. Bash interpreted `--server` as one of its own
options. The fix is to insert `-s --` so bash treats trailing
tokens as positional args for the script:

```bash
curl -k --noproxy <server> https://<server>:8140/packages/install.bash | sudo bash -s -- --server <fqdn>
```

The GUI's published one-liner doesn't pass extra args (the script
auto-discovers the FQDN), so this only trips you if you're
overriding behavior.

### Problem: `curl: (56) CONNECT tunnel failed, response 407`

Your agent host is behind a corporate proxy and the bootstrap
curl tried to tunnel through it. Use the GUI's published
one-liner -- it includes `--noproxy <fqdn>` to bypass the proxy
for the puppetserver host:

```bash
curl -k --noproxy <fqdn> https://<fqdn>:8140/packages/install.bash | sudo bash
```

For the bare `curl ... | bash` form to work without `--noproxy`,
set `no_proxy` in `/etc/environment` on the host once.

### Problem: `Certificate verification failed: The certificate is NOT trusted`

You're seeing this on a follow-up `apt-get update` or `dnf upgrade`
after the agent install completed. install.bash installs
the puppet CA into the system trust store automatically, so this
should only happen if the CA install step failed (CA endpoint
unreachable from the agent, `update-ca-certificates` missing,
unsupported OS family). Re-run install.bash to retry, or install
the CA manually:

```bash
# Debian/Ubuntu
sudo curl -ksLf https://<fqdn>:8140/puppet-ca/v1/certificate/ca \
    -o /usr/local/share/ca-certificates/openvox-puppet-ca.crt
sudo update-ca-certificates

# RHEL family
sudo curl -ksLf https://<fqdn>:8140/puppet-ca/v1/certificate/ca \
    -o /etc/pki/ca-trust/source/anchors/openvox-puppet-ca.crt
sudo update-ca-trust extract
```

### Problem: Agent Install page shows "Mirror size: 0 B" / "Last sync: never"

The local mirror at `/opt/openvox-pkgs/` is empty. Either:

- Click **Sync now** on Infrastructure -> Agent Install in the GUI
  (admin/operator role required)
- Or trigger the systemd service from CLI:
  `sudo systemctl start openvox-repo-sync.service`
- Or just wait for the 02:30 nightly timer

The first sync downloads ~1-2 GB and takes 15-45 minutes.

### Problem: Install script dies with `Could not determine the puppetserver FQDN`

In normal operation `install.bash` discovers the FQDN automatically
from the kernel's TCP state (the curl connection lingers in
`/proc/net/tcp` after the bootstrap download completes) plus reverse
DNS. When all four resolution paths fail (`--server` arg / env var,
`/proc/net/tcp` discovery, server-side rendered placeholder, existing
`puppet.conf`), this error fires. Most likely cause: reverse DNS for
the puppetserver IP returns nothing or returns a name that's not the
puppetserver's actual FQDN. Workaround:

```bash
curl -k --noproxy <fqdn> https://<fqdn>:8140/packages/install.bash \
    | sudo bash -s -- --server <fqdn>
```

### Problem: Agent install gets through repo setup but `dnf install openvox-agent` fails with 404s

The mirror exists but doesn't have packages for your agent's specific
OS / architecture. Either:

- The first sync hasn't covered that platform yet (check Installer
  page -> Per-platform breakdown)
- Or the platform isn't in the mirror's allowlist (check the systemd
  unit's environment overrides at `/etc/sysconfig/openvox-repo-sync` or
  `/etc/default/openvox-repo-sync`)

Re-run the sync limited to your platform:

```bash
sudo /opt/openvox-gui/scripts/sync-openvox-repo.sh \
    --platforms yum --el-releases 9 --arches x86_64
```

### Problem: Sync errors with "A sync is already running"

A previous sync was killed without cleaning up its lock file:

```bash
sudo rm -f /opt/openvox-pkgs/.sync.lock
```

---

## ovox CLI Problems

### `ovox` command not found

The symlink at `/usr/local/bin/ovox` may not exist or not be in PATH.

```bash
# Check if the real binary exists
ls -l /opt/openvox-gui/venv/bin/ovox

# Recreate the symlink (run as root)
ln -sf /opt/openvox-gui/venv/bin/ovox /usr/local/bin/ovox
```

### Version mismatch between `ovox --version` and expected version

`ovox` has independent versioning. The CLI reads `ovox/VERSION` (or the installed copy) with specific precedence.

See the [Versioning section](ovox/README.md#versioning) in the ovox docs.

### Authentication or "Failed to fetch" errors with `ovox`

- Run `ovox login` (or provide `--token` / `OPENVOX_TOKEN`)
- For service/automation use, prefer long-lived tokens created with `ovox token generate`
- When using the `bolt` user with the `openvox_enc` plugin, ensure the token file at `/etc/puppetlabs/bolt/.bolt_token` has correct permissions (0600) and is owned by the `bolt` user

### `ovox infra` commands fail with permission errors

These commands run privileged operations (reading configs, restarting services). The `puppet` user running the GUI needs the corresponding sudoers rules (see [docs/SUDOERS.md](docs/SUDOERS.md)).

---

## Maintenance Mode

### Problem: Maintenance Page Not Appearing During Updates/Install
**Symptoms**: Users still see errors, 502s, or the old GUI during `install.sh` / `update_*.sh` / `deploy.sh`.

**Solutions**:
- Verify the flag: `ls -l /opt/openvox-gui/data/maintenance.flag`
- Check Apache config includes the `RewriteCond` on that flag + `Alias /maintenance.html /opt/openvox-gui/maintenance/maintenance.html` (see `maintenance/apache-maintenance.conf`).
- Ensure the HTML exists: `ls /opt/openvox-gui/maintenance/maintenance.html` (scripts copy it automatically from `maintenance-formal.html` or `maintenance-casual.html`).
- Reload Apache: `sudo systemctl reload httpd` (or `apache2`).
- Check permissions: `chmod 644 /opt/openvox-gui/data/maintenance.flag` and `chmod 755 /opt/openvox-gui/data` (and `a+rX` on the `maintenance/` dir) so the web server user can read them.
- The scripts raise the flag early and use a `trap` for cleanup — if the script was killed hard, manually remove the flag: `sudo rm -f /opt/openvox-gui/data/maintenance.flag /opt/openvox-gui/data/maintenance.json`.
- `ovox maintenance status` (or the backend `/api/maintenance/status`) will show the current state.

### Problem: Maintenance Flag Stuck / Cannot Disable
- Run `ovox maintenance disable` (or manually delete the flag files above).
- If the web server still serves the page, reload Apache.
- Check that no other process is touching the flag.

### Problem: "Maintenance" in Logs or Unexpected 503s
- The backend middleware returns structured 503 JSON when the flag is present (except for allow-listed recovery paths like `/api/auth/login` and `/api/maintenance/*`).
- Use `ovox maintenance disable` or delete the flag to restore normal operation.
- The flag is automatically managed by the install/update scripts.

## Log Viewer

### Problem: Highlighting Not Visible or Wrong Colors
- Ensure you are on a recent build (FQDNs bright blue `#4dabf7` bold; commands and API calls `"GET ... HTTP/1.1" 200 OK` in bold red `#e03131`).
- The container is a dark monospace block for contrast — if the theme or CSS is overridden, highlights may be hard to see.
- "System Log" tab shows the *full* `journalctl` (no unit filter) — this can be very noisy; use the Filter box or time range.
- Reproduce on the server: `sudo journalctl -u openvox-gui -n 50 --output short-iso` (or the specific unit/file for other tabs).

### Problem: OpenVox Agent tab is empty
- Agent often has **no on-disk log files** (and `puppet_agent.log` may be a directory). Collection is **journal-first** (units `puppet` / `puppet-agent`, then `journalctl -t puppet-agent`, then host journal filter). Requires **3.10.4+** (or 3.10.3b12+) and matching sudoers (`ensure-sudoers.sh` adds `-t` rules on deploy/update).
- With **`log_level = err`** in puppet.conf the agent is quiet when healthy. A tight **Since** filter (Last hour / Today) can hide older error lines; **3.10.4** relaxes Since and shows last available lines with a warning when the window is empty.
- Check on the server: `sudo journalctl -u puppet -n 50 --output short-iso` and `sudo journalctl -t puppet-agent -n 50 --output short-iso`.

## Live fleet / ENC / Inventory membership

### Problem: Classification | Common Classes dropdown is empty
- Discovery is **not** from the ENC SQLite/Postgres DB — it is API-first from compilers:
  1. `GET /puppet/v3/environment_classes` on `OPENVOX_GUI_PUPPET_SERVER_HOST` (compiler VIP) and configured compiler FQDNs
  2. Bolt `list-classes-remote.py` on a code-deploy target if HTTP fails
  3. Local codedir only as last resort (dedicated consoles have none)
- **Install/update must ship** `scripts/list-classes-remote.py` (install.sh / update_local.sh / deploy.sh). If missing under `/opt/openvox-gui/scripts/`, re-run update — do not ad-hoc scp forever.
- Set **`OPENVOX_GUI_PUPPET_SERVER_HOST`** to the **compiler VIP**, not the console hostname.
- Stage/Activate at least once so compilers have modules under `/etc/puppetlabs/code/environments/<env>/`.
- Manual workaround in UI: “Add class by name” (3.11.1-alpha.2+).

### Problem: Compilers ignore ENC classes / agent gets empty catalog
- **enc.py runs only on compilers** at catalog compile. Consoles store classification; they do not need `external_nodes` unless they also compile.
- Compilers need: `/usr/local/bin/enc.py`, `node_terminus=exec`, `external_nodes` pointing at that script, and `OPENVOX_GUI_API_BASE` available to **puppetserver** (e.g. `/etc/sysconfig/openvox-enc` + systemd `EnvironmentFile`).
- Use `scripts/bootstrap-compiler-enc.sh` from a console via Bolt, or `install.sh` `CONFIGURE_ENC=auto` when puppetserver is co-located.
- Smoke: `set -a; . /etc/sysconfig/openvox-enc; set +a; /usr/local/bin/enc.py <certname>`
- Restart **puppetserver** after ENC env or drop-in changes.
- ENC YAML good but no resources → code missing on the compiler (Stage/Activate).

### Problem: ENC Unclassified or Inventory still lists hosts after `ca clean`
- **3.10.4** defines the live fleet as **active PuppetDB ∩ signed CA** (`get_live_nodes`). CA-cleaned hosts must not appear on Nodes, Inventory, ENC Unclassified, Dashboard, or Node Health. Open **Classification (ENC)** once after upgrade so SQLite reconciliation prunes stale ENC rows.
- If a host is still **active in PuppetDB** (never deactivated) **and** still has a **signed cert**, it will correctly remain on the live fleet — finish cleanup with deactivate/expire/`puppet node clean` as needed, not only `ca clean`.
- Certificates page is CA-authoritative and may still list pending/revoked state independently of the live fleet lists.

### Problem: `ovox db-reseed` says "API endpoint not found" (404) or the subcommand is missing
- The most common cause: you did `git push` (or pulled the commit), but have **not run the deploy** yet on the server.
  The API route (`POST /api/enc/reseed`) and the updated `ovox` CLI live in `/opt/openvox-gui` after deploy. The running service and the `ovox` in `$PATH` are still the old copy.
- Fix (run on the server in your git checkout):

  ```bash
  cd ~/openvox-gui
  git pull origin main
  ovox maintenance enable --message "Deploying db-reseed" --eta "5 minutes" --yes
  sudo ./scripts/update_local.sh
  ovox maintenance disable
  ```

- After deploy, confirm:

  ```bash
  ovox --version   # should show 3.10.7-dev.x or newer
  ovox db-reseed
  ```

- `db-reseed` requires admin or operator role. Run `ovox login` (or supply `--token` / `OPENVOX_TOKEN`) with a privileged account first.
- The command is safe and additive only (it never deletes existing classifications).

### Problem: Inventory node count differs from Overview | Nodes
- Fixed in **3.10.4** (3.10.3b11–b14): both use the same live-fleet membership. Older builds counted all PuppetDB inventory factsets (including deactivated/expired) vs CA-signed-only Nodes.

## Reports Page

### Problem: Nodes Inside Groups Appear in Random Order
- Fixed in 3.7.3: Nodes (via report rows) inside expanded groups are now strictly alphabetical by certname.
- The backend `GET /api/enc/hierarchy` sorts nodes; the frontend explicitly sorts per-group lists and report rows.
- If you still see random order, clear browser cache or ensure you are on RC2+.
- Group names themselves are also sorted alphabetically in the main view.

## Getting More Help

### Collect Diagnostic Information

When asking for help, gather this information:

```bash
# Create a diagnostic report
cd /opt/openvox-gui
mkdir -p /tmp/openvox-diag

# Version info
curl -k https://localhost:4567/health > /tmp/openvox-diag/version.txt

# Service status
sudo systemctl status openvox-gui > /tmp/openvox-diag/service.txt

# Recent logs
sudo journalctl -u openvox-gui -n 500 > /tmp/openvox-diag/logs.txt

# Configuration (remove passwords!)
grep -v PASSWORD /opt/openvox-gui/config/.env > /tmp/openvox-diag/config.txt

# System info
uname -a > /tmp/openvox-diag/system.txt
python3 --version >> /tmp/openvox-diag/system.txt

# Create archive
tar czf /tmp/openvox-diagnostic.tar.gz /tmp/openvox-diag/
```

### Where to Get Help

1. **GitHub Issues**: [https://github.com/cvquesty/openvox-gui/issues](https://github.com/cvquesty/openvox-gui/issues)
   - Search existing issues first
   - Include diagnostic information
   - Describe what you tried

2. **GitHub Discussions**: For questions and community help

3. **Documentation**:
   - [Installation Guide](INSTALL.md)
   - [Update Guide](UPDATE.md)
   - [LDAP Guide](docs/LDAP.md)
   - [Sudoers Guide](docs/SUDOERS.md)
   - [Agent Installer Guide](docs/INSTALLER.md)

### Emergency Recovery

If everything is broken and you need to start fresh:

```bash
# 1. Backup your data
sudo cp -r /opt/openvox-gui/data /backup/
sudo cp -r /opt/openvox-gui/config /backup/

# 2. Uninstall
sudo ./install.sh --uninstall

# 3. Reinstall
sudo ./install.sh

# 4. Restore data
sudo cp /backup/config/.env /opt/openvox-gui/config/
sudo cp -r /backup/data/* /opt/openvox-gui/data/
sudo chown -R puppet:puppet /opt/openvox-gui

# 5. Restart
sudo systemctl restart openvox-gui
```

---

## Common Error Messages

### "Failed to fetch dynamically imported module"

**Cause:** Browser has old version cached after an update

**Fix:** Hard refresh (Ctrl+F5 or Cmd+Shift+R)

### "Connection refused" or "ECONNREFUSED"

**Cause:** Service isn't running or port is blocked

**Fix:** Start service and check firewall

### "SSL: CERTIFICATE_VERIFY_FAILED"

**Cause:** SSL certificate problem with OpenVoxDB

**Fix:** Check certificate paths and permissions

### "Permission denied"

**Cause:** File ownership or permission issues

**Fix:** `sudo chown -R puppet:puppet /opt/openvox-gui`

### "Database is locked"

**Cause:** Multiple processes trying to access SQLite database

**Fix:** Restart service: `sudo systemctl restart openvox-gui`

---

**Remember:** Most problems have simple solutions. Start with the Quick Fixes, then work through the specific section for your issue. When in doubt, check the logs - they usually tell you exactly what's wrong!

**Still stuck?** Don't hesitate to ask for help on [GitHub Issues](https://github.com/cvquesty/openvox-gui/issues)!

---

<div align="center">

<sub>This document was created with the assistance of AI (Grok, xAI). All technical content has been reviewed and verified by human contributors.</sub>

</div>
