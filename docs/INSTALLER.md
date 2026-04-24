# OpenVox Agent Installer

**Available since**: openvox-gui 3.3.5-1

This guide covers the **agent installer** feature: a local OpenVox
package mirror, a one-line bootstrap script for Linux and Windows
hosts, and the GUI page that ties them together.

The feature is modelled on Puppet Enterprise's **install agents**
workflow described at
[help.puppet.com/pe/2023.8/topics/installing_agents.htm](https://help.puppet.com/pe/2023.8/topics/installing_agents.htm).
The end-user experience is intentionally identical -- a single
`curl ... | sudo bash` (or PowerShell equivalent) on a fresh host --
but everything below the surface is OpenVox-native: the packages come
from `yum.voxpupuli.org` / `apt.voxpupuli.org` /
`downloads.voxpupuli.org` rather than Puppet's commercial PE bundles.

---

## Why this exists

PE makes adding a new agent very easy:

```bash
curl -k https://<puppet-server>:8140/packages/install.bash | sudo bash
```

(Older PE docs show `/packages/current/install.bash`; we drop the
`current/` so the URL maps directly to the file on disk.) OpenVox
agents historically required several manual steps to install:
add the Vox Pupuli repo, install `openvox-agent`, edit
`/etc/puppetlabs/puppet/puppet.conf`, start the service, sign the
cert.  This feature collapses all of that into the same one-liner.

There are three problems it solves:

1.  **Discoverability** -- the GUI shows operators exactly what
    command to run on a fresh host.  No more cargo-culted shell
    snippets in private wikis.
2.  **Network-segmented environments** -- many enterprise networks
    don't permit direct outbound HTTPS to public package mirrors, but
    they always permit traffic to port 8140 (the puppetserver port).
    Hosting the mirror locally on 8140 means agents install without
    extra firewall holes.
3.  **Repeatability** -- a local mirror gives you a known-good set of
    packages frozen at the moment of your last sync, rather than
    pulling whatever is on the public mirror today.

---

## Architecture

```
                                         openvox-gui server
                                       ┌────────────────────────────┐
                                       │                            │
   yum.voxpupuli.org                   │  /opt/openvox-pkgs/        │
   apt.voxpupuli.org   ───[sync]──>    │    yum/openvox{7,8}/...    │
   downloads.voxpupuli.org             │    apt/dists/{debian12,    │
                                       │             ubuntu24.04}/  │
   (sync-openvox-repo.sh,              │    windows/                │
    nightly via systemd timer          │    mac/                    │
    or on-demand via GUI button)       │    install.bash            │
                                       │    install.ps1             │
                                       │            │               │
                                       │            ▼               │
                                       │  ┌─────────────────────┐   │
                                       │  │ puppetserver        │   │
                                       │  │ /packages/* mount   │   │
                                       │  │ on port 8140        │   │
                                       │  └─────────────────────┘   │
                                       │            │               │
                                       │            ▼ (also)        │
                                       │  ┌─────────────────────┐   │
                                       │  │ openvox-gui         │   │
                                       │  │ /packages/* mount   │   │
                                       │  │ on port 4567        │   │
                                       │  └─────────────────────┘   │
                                       └─────────┬──────────────────┘
                                                 │
                                  ┌──────────────┴──────────────┐
                                  ▼                             ▼
                          ┌──────────────┐              ┌──────────────┐
                          │ Linux agent  │              │ Win agent    │
                          │ install.bash │              │ install.ps1  │
                          └──────────────┘              └──────────────┘
```

There are five moving parts:

| Component | Lives at | Purpose |
|-----------|----------|---------|
| `sync-openvox-repo.sh` | `/opt/openvox-gui/scripts/` | Mirrors voxpupuli.org content to `/opt/openvox-pkgs/` |
| `openvox-repo-sync.timer` | `/etc/systemd/system/` | Runs the sync nightly at 02:30 |
| `openvox-pkgs-webserver.conf` | `/etc/puppetlabs/puppetserver/conf.d/` | Mounts `/packages/*` on port 8140 |
| `install.bash` | `/opt/openvox-pkgs/` | Linux agent bootstrap |
| `install.ps1` | `/opt/openvox-pkgs/` | Windows agent bootstrap |

## Mirror layout (3.3.5-2+)

The local mirror under `/opt/openvox-pkgs/` preserves the upstream
voxpupuli.org tree structure one-for-one rather than reorganising into
per-OS directories. This keeps the apt pool from being duplicated
across Debian and Ubuntu, and means agent install scripts use simple
URL paths that map directly to the upstream documentation.

```
/opt/openvox-pkgs/
├── install.bash                     Linux agent bootstrap
├── install.ps1                      Windows agent bootstrap
│
├── yum/                             mirrors yum.voxpupuli.org
│   ├── GPG-KEY-openvox.pub
│   ├── openvox{7,8}-release-el-{8,9}.noarch.rpm
│   └── openvox{7,8}/el/{8,9}/{x86_64,aarch64}/
│         ├── repodata/
│         └── openvox-agent-*.rpm, openbolt-*.rpm
│
├── apt/                             mirrors apt.voxpupuli.org
│   ├── GPG-KEY-openvox.pub, openvox-keyring.gpg
│   ├── openvox{7,8}-release-{debian12,debian13,ubuntu22.04,ubuntu24.04}.deb
│   ├── dists/{debian12,debian13,ubuntu22.04,ubuntu24.04}/
│   │     ├── {InRelease,Release,Release.gpg}
│   │     └── openvox{7,8}/binary-{amd64,arm64}/{Packages,Packages.gz,Release}
│   └── pool/openvox{7,8}/o/{openvox-agent,openbolt,openvox-server,...}/
│
├── windows/openvox{7,8}/
│   ├── openvox-agent-{ver}-x64.msi      every published version
│   └── openvox-agent-x64.msi            real copy of the latest stable
│                                         (puppetserver mount can't follow
│                                          symlinks, so we copy)
│
└── mac/openvox{7,8}/
    ├── openvox-agent-{ver}-1.macos.all.{x86_64,arm64}.dmg
    ├── openvox-agent-{x86_64,arm64}.dmg  latest copies per arch
    └── 13/, 14/, 15/                      per-macOS-major sub-trees
```

The openvox-gui FastAPI app **also** mounts `/opt/openvox-pkgs/` at
`/packages/*` on its own port (4567 by default).  This is the
fallback path if puppetserver isn't installed locally, and it's used
by the in-browser preview on the Installer page.

---

## Installing the feature

The whole feature is set up automatically by `install.sh` from
openvox-gui 3.3.5-1 onward.  The interactive prompts are:

```
Agent Package Mirror (3.3.5-1+)
  Sets up a local OpenVox package mirror under /opt/openvox-pkgs so
  agents can be installed via 'curl ... | sudo bash' without internet
  access. Mirror is populated from yum/apt.voxpupuli.org.
  Configure local agent package mirror? [Y/n]: y
  Package mirror directory [/opt/openvox-pkgs]:
  Install puppetserver static-content mount on port 8140? (recommended) [Y/n]: y
  Enable nightly repo sync (systemd timer)? [Y/n]: y
  Run initial sync now? (downloads several GB; can be done later) [y/N]: n
```

For unattended installs, set the same variables in `install.conf`:

```bash
CONFIGURE_PKG_REPO="true"
PKG_REPO_DIR="/opt/openvox-pkgs"
INSTALL_PUPPETSERVER_MOUNT="true"
ENABLE_REPO_SYNC_TIMER="true"
RUN_INITIAL_SYNC="false"
```

After installing, **restart puppetserver** to activate the
`/packages/*` mount on port 8140:

```bash
sudo systemctl restart puppetserver
```

Then either trigger an initial sync from the **Installer** page in
the GUI ("Sync now" button), or from the CLI:

```bash
sudo systemctl start openvox-repo-sync.service
```

The first sync downloads roughly 1-3 GB depending on which
platforms/architectures you've enabled and can take 15-45 minutes
on a typical broadband connection.  Subsequent syncs are
incremental (only new/changed files are downloaded) and finish in
a few minutes.

---

## The Agent Install page

`Infrastructure -> Agent Install` is where day-to-day operators
interact with the feature. It's two stacked cards:

### 1. Install Commands (tabbed)

The headline card. Header always shows the puppetserver FQDN, a
"Sync in progress" badge when relevant, and a "Sync now" button
(admin/operator only -- viewers see it disabled). Five tabs:

- **Linux** -- copy-to-clipboard one-liner for `curl ... | sudo bash`.
- **Windows** -- copy-to-clipboard PowerShell snippet.
- **Direct URLs** -- raw URLs for install.bash, install.ps1, and the
  mirror root (useful if you want to script the install yourself).
- **Mirror Status** -- last-sync time + result, mirror size, per-
  platform breakdown table (yum / apt / windows / mac with
  package counts and bytes), and a disk-space widget on the side.
- **Sync Log** -- tail of `/opt/openvox-gui/logs/repo-sync.log`, or
  the captured stdout/stderr of the most recent manual sync. The
  page auto-switches to this tab when you click "Sync now" so you
  see what happened immediately.

### 2. Pending Certificate Requests *(moved here in 3.3.5-20)*

Was previously on the Certificate Authority page. Lives here now
because CSR signing is part of the agent bring-up workflow:

```
install agent -> agent submits CSR -> operator signs here -> first puppet run succeeds
```

Shows certname + fingerprint with **Sign** / **Reject** buttons per
row (admin/operator only). After signing or rejecting, the table
refreshes automatically. The Certificate Authority page still
handles everything else: CA info panel, signed-cert list (with
revoke / clean / details), expiry warnings.

### Roles

- **viewer** can read everything (commands, status, logs, pending
  CSR list) but can't trigger a sync or sign/reject CSRs.
- **operator** and **admin** can trigger syncs and sign / reject CSRs.
  Buttons are visibly disabled with a tooltip for viewers.

---

## How the install one-liners work

The Agent Install page publishes copy-to-clipboard one-liners for
both Linux and Windows. The script auto-discovers everything it
needs from the URL the operator just typed -- no `--server` flag,
no env vars, no manual configuration.

### Linux

```bash
curl -k --noproxy <fqdn> https://<fqdn>:8140/packages/install.bash | sudo bash
```

Three things the bare-looking command quietly does:

- **`--noproxy <fqdn>`** tells curl to bypass any inherited
  `http_proxy` / `https_proxy` for the puppetserver host. Without
  this, hosts behind a corporate proxy fail at the bootstrap
  curl with `CONNECT tunnel failed, response 407`.
- **`-k`** skips cert verification on the bootstrap curl because
  the puppetserver presents a cert signed by Puppet's internal CA
  that the agent doesn't trust *yet* (the script installs that CA
  later, see step 2 below).
- **No script args needed** -- the script extracts the puppetserver
  FQDN from the kernel's TCP state (the curl connection lingers in
  `/proc/net/tcp` for ~60 s in TIME_WAIT) and reverse-DNSes the
  remote IP back to the FQDN. Whatever hostname the operator
  pointed curl at IS the hostname the agent gets configured against.

The script then:

1.  **Resolves the puppetserver FQDN.** Four-step resolution order
    (highest priority first):
    1. `--server` CLI arg or `PUPPET_SERVER` env var
    2. **NEW (3.3.5-11+)** `/proc/net/tcp` + reverse DNS of the
       curl connection that just downloaded us
    3. `__OPENVOX_PUPPET_SERVER__` placeholder substituted at
       server-side render time
    4. `[main] server=` from existing `/etc/puppetlabs/puppet/puppet.conf`
    Path 2 handles the common case; the others are belt-and-suspenders.
2.  **Sets `no_proxy`** in the script's environment so subsequent
    apt/yum invocations bypass the corporate proxy too.
3.  **Installs the puppet CA into the system trust store** (3.3.5-18+)
    by fetching `https://<server>:8140/puppet-ca/v1/certificate/ca`
    and dropping it into `/usr/local/share/ca-certificates/openvox-puppet-ca.crt`
    (Debian/Ubuntu) or `/etc/pki/ca-trust/source/anchors/openvox-puppet-ca.crt`
    (RHEL family), then runs `update-ca-certificates` /
    `update-ca-trust extract`. After this, future `apt-get update`,
    `dnf upgrade openvox-agent`, manual `curl`, etc. work without
    any `--insecure` / `Verify-Peer=false` / `sslverify=0` flags.
4.  **Detects the platform** (RHEL family / Debian / Ubuntu,
    version, architecture) by reading `/etc/os-release`.
5.  **Drops a yum/apt repo file** pointing at the local mirror:
    -   RHEL: `/etc/yum.repos.d/openvox8.repo`
    -   Debian/Ubuntu: `/etc/apt/sources.list.d/openvox8.list`
    -   APT distro names use **numeric** form: `debian12`, `ubuntu24.04`
        (matching the upstream apt suite layout).
6.  **Installs `openvox-agent`** via the platform's package manager.
7.  **Sets `server` and `certname`** in `/etc/puppetlabs/puppet/puppet.conf`.
8.  **Starts and enables the puppet service.**
9.  **Symlinks** `puppet` / `facter` / `hiera` into `/usr/local/bin/`
    so they're on `PATH` without needing `/opt/puppetlabs/bin`.

You can append extra arguments using bash's `-s --` form (required so
bash treats trailing tokens as positional args for the script, not
options for itself):

```bash
curl -k --noproxy <fqdn> https://<fqdn>:8140/packages/install.bash | sudo bash -s -- \
    extension_requests:pp_role=webserver \
    extension_requests:pp_environment=prod \
    --puppet-service-ensure stopped
```

Supported argument forms:

| Argument | Effect |
|----------|--------|
| `--server <fqdn>` | Override the puppetserver FQDN (rare -- discovery handles it) |
| `--pkg-repo-url <url>` | Override the package mirror base URL. Default: `https://<server>:8140/packages` |
| `--version <7\|8>` | Pick OpenVox major version (default: 8) |
| `--puppet-service-ensure running\|stopped` | Service state after install (default: running) |
| `--puppet-service-enable true\|false\|manual` | Service startup mode (default: true) |
| `<section>:<key>=<value>` | Apply a setting to puppet.conf at install time |
| `custom_attributes:<key>=<value>` | Add to csr_attributes.yaml |
| `extension_requests:<key>=<value>` | Add to csr_attributes.yaml (becomes a trusted fact) |

### Windows

```powershell
[System.Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; `
[Net.ServicePointManager]::ServerCertificateValidationCallback = {$true}; `
$url = 'https://<server>:8140/packages/install.ps1'; `
$wc = New-Object System.Net.WebClient; `
$wc.Proxy = $null; `
$wc.DownloadFile($url, 'install.ps1'); `
.\install.ps1 -Server ([System.Uri]$url).Host -v
```

Notice three things:

- **`$wc.Proxy = $null`** bypasses the system-configured proxy
  (PowerShell's `WebClient` inherits it by default), preventing
  the same `407 Proxy Authentication Required` failure Linux can
  hit at the bootstrap step.
- **`-Server ([System.Uri]$url).Host`** extracts the puppetserver
  FQDN from the download URL and passes it to install.ps1
  explicitly. install.ps1 can't auto-discover from `/proc/net/tcp`
  the way install.bash does -- the script runs from a downloaded
  file, not via a pipe -- so the one-liner does the extraction
  up front.
- The `ServerCertificateValidationCallback = {$true}` line skips
  cert verification on the bootstrap download (puppet's internal
  CA isn't trusted yet); install.ps1 itself uses normal verification
  after that point.

The script:

1.  Downloads the appropriate `openvox-agent-x64.msi` (or x86) from
    the local mirror.
2.  Runs `msiexec /qn /i ...` with `PUPPET_MASTER_SERVER` and
    `PUPPET_AGENT_STARTUP_MODE` properties set.
3.  Sets `server` and `certname` in `puppet.conf`.
4.  Starts and enables the puppet service via `puppet resource service`.

PowerShell parameters mirror the PE installer:

| Parameter | Effect |
|-----------|--------|
| `-Server <fqdn>` | Override puppetserver FQDN |
| `-OpenVoxVersion 7\|8` | Pick OpenVox major version |
| `-InstallDir <path>` | Custom install location |
| `-PuppetAgentAccountUser <name>` | Service account for the agent |
| `-PuppetServiceEnsure running\|stopped` | Service state |
| `-PuppetServiceEnable true\|false\|manual` | Startup mode |
| `-EnableLongPaths` | Enable Windows long-path support |
| `<section>:<key>=<value>` | puppet.conf / csr_attributes.yaml directive |

---

## What gets mirrored

By default `sync-openvox-repo.sh` mirrors (3.3.5-2 defaults are
"latest two only" -- expand via flags if you need older OS releases):

| Source | OpenVox versions | OS releases | Architectures |
|--------|------------------|-------------|---------------|
| `yum` (RHEL family: rocky/alma/centos/rhel/oracle) | 7, 8 | el-8, el-9 | x86_64, aarch64 |
| `apt` Debian | 7, 8 | debian12 (bookworm), debian13 (trixie) | amd64, arm64 |
| `apt` Ubuntu | 7, 8 | ubuntu22.04 (jammy), ubuntu24.04 (noble) | amd64, arm64 |
| `windows` | 7, 8 | n/a | x64 |
| `mac` | 7, 8 | n/a | x86_64, arm64 |

Override via flags or environment variables:

```bash
sudo /opt/openvox-gui/scripts/sync-openvox-repo.sh \
    --platforms yum,apt \
    --versions 8 \
    --el-releases 8,9 \
    --ubuntu-releases 22.04,24.04 \
    --debian-releases 12,13 \
    --arches x86_64
```

Note that `--ubuntu-releases` and `--debian-releases` take **numeric**
versions (matching the upstream apt suite names), not codenames.

Persistent overrides go in `/etc/sysconfig/openvox-repo-sync` (RHEL
family) or `/etc/default/openvox-repo-sync` (Debian/Ubuntu).  The
systemd unit reads both files via `EnvironmentFile=-`.

---

## Disk space considerations

A full mirror of every supported platform is roughly:

| Source | Approx size |
|--------|-------------|
| yum (el-8,9 x86_64+aarch64, openvox 7+8) | 600 MB |
| apt (debian12,13 + ubuntu22.04,24.04, openvox 7+8) | 500 MB |
| Windows MSIs | 100 MB |
| macOS DMGs | 200 MB |
| **Total** | **~1.4 GB** |

The Installer page shows a "Disk space" widget that warns when the
filesystem holding `/opt/openvox-pkgs/` is more than 90 % full.

---

## Troubleshooting

### `Mirror size: 0 B` and `Last sync: never`

The mirror hasn't been populated yet.  Click "Sync now" on the
Installer page or run `sudo systemctl start openvox-repo-sync.service`.

### `wget: command not found`

`sync-openvox-repo.sh` uses `wget` for portability across RHEL and
Debian families.  Install it with `sudo dnf install wget` or
`sudo apt install wget`.

### Puppetserver returns 404 for `/packages/install.bash` (~ 378 bytes of HTML)

This is the most common post-install gotcha and almost always means
puppetserver was never restarted after the openvox-gui upgrade
dropped its static-content mount config. The 378-byte HTML you got
back is puppetserver's default "unknown path" page.

```bash
sudo systemctl restart puppetserver
# wait 15-30s for it to come back up
sudo systemctl is-active puppetserver
```

If the mount config wasn't installed (you said "no" to
`INSTALL_PUPPETSERVER_MOUNT`), you can install it manually:

```bash
sudo cp /opt/openvox-gui/config/openvox-pkgs-webserver.conf \
        /etc/puppetlabs/puppetserver/conf.d/
sudo systemctl restart puppetserver
```

To confirm the mount loaded, look for `openvox-pkgs` or
`static-content` in the puppetserver journal:

```bash
sudo journalctl -u puppetserver --since "5 minutes ago" --no-pager \
    | grep -iE 'static-content|openvox-pkgs|webserver'
```

### `bash: --server: invalid option`

You appended args to the one-liner without `bash -s --` between
`bash` and them. Bash interpreted `--server` as one of its own
options. The fix is to insert `-s --`:

```bash
# WRONG -- bash eats --server itself
curl -k --noproxy server https://server:8140/packages/install.bash | sudo bash --server foo

# RIGHT -- -s -- tells bash "everything after this is for the script"
curl -k --noproxy server https://server:8140/packages/install.bash | sudo bash -s -- --server foo
```

The GUI's published one-liner doesn't pass extra args (discovery
handles the FQDN on its own), so this only trips you if you're
overriding behavior with `--server` / `extension_requests:` /
similar.

### `curl: (56) CONNECT tunnel failed, response 407`

Your agent host is behind a corporate proxy and the bootstrap
curl tried to tunnel through it. Use the GUI's published
one-liner (it includes `--noproxy <fqdn>` to bypass the proxy
for the puppetserver host):

```bash
curl -k --noproxy <fqdn> https://<fqdn>:8140/packages/install.bash | sudo bash
```

If you'd rather make the bare `curl ... | bash` form work
without `--noproxy`, set `no_proxy` in the host environment
once (e.g. via `/etc/environment`) and any future curl will
bypass the proxy automatically.

### `Certificate verification failed: The certificate is NOT trusted`

You're seeing this AFTER install.bash completed -- e.g. a follow-up
`apt-get update` or `dnf upgrade` failing because the puppet CA
isn't in the system trust store.

In 3.3.5-18+, install.bash installs the puppet CA into the system
trust store automatically (`/usr/local/share/ca-certificates/openvox-puppet-ca.crt`
on Debian/Ubuntu, `/etc/pki/ca-trust/source/anchors/openvox-puppet-ca.crt`
on RHEL family). If you're seeing this error on a newly installed
agent, install.bash either failed to fetch the CA or failed to run
the trust-refresh command. Re-run install.bash on the agent to
retry, or install the CA manually:

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

### `404 Not Found` fetching e.g. `/packages/apt/dists/ubuntu24.04/openvox8/binary-amd64/Packages`

Different from "puppetserver returns ~378 bytes of HTML" above --
that's the puppetserver mount missing entirely. This 404 means
the mount is working but the mirror has no content for that
specific OS family / arch. Two causes:

1.  The sync hasn't run yet on this server. Trigger one:
    ```bash
    sudo systemctl start openvox-repo-sync.service
    ```
2.  The sync IS running but hasn't reached that platform / arch.
    Check Infrastructure -> Agent Install -> Mirror Status tab
    for the per-platform breakdown.

Fast option: limit the sync to just what your test agent needs:
```bash
sudo /opt/openvox-gui/scripts/sync-openvox-repo.sh \
    --platforms apt --ubuntu-releases 24.04 --arches x86_64
```

### `Could not determine the puppetserver FQDN`

All four resolution paths failed:

1. `--server` arg / `PUPPET_SERVER` env var (not set)
2. `/proc/net/tcp` + reverse DNS of the curl connection that just
   downloaded the script (no matching connection found, or reverse
   DNS returned nothing)
3. The `__OPENVOX_PUPPET_SERVER__` placeholder substituted server-side
   (not rendered)
4. `[main] server=` from existing `puppet.conf` (not present)

In normal operation path 2 hits and the script self-configures.
This error means none of those worked. Most likely causes:

- Running install.bash from a downloaded file, not a curl pipe
  (no TCP connection in `/proc/net/tcp` to discover from).
- Reverse DNS for the puppetserver IP returns nothing or returns
  a name that's not the puppetserver's actual FQDN.
- `/proc/net/tcp` isn't a procfs (rare, but happens in some
  containerized environments).

Workarounds:

- **One-shot fix on the agent** -- re-run with `--server` explicit:
  ```bash
  curl -k --noproxy <fqdn> https://<fqdn>:8140/packages/install.bash \
    | sudo bash -s -- --server <fqdn>
  ```
- **Fix the underlying render on the openvox-gui server** so
  path 3 covers future agents even if path 2 fails:
  ```bash
  cd ~/openvox-gui && git pull && sudo ./scripts/update_local.sh
  ```

### Agent install fails with "openvox-agent MSI not found"

Check that the Windows MSIs were mirrored:

```bash
ls /opt/openvox-pkgs/windows/
```

If the directory is empty, the sync hasn't run yet, or the
`--platforms` flag excluded windows.  Re-run sync with
`--platforms windows` to limit the work.

### Agent install fails with `apt-get update` errors

The OpenVox apt repos are signed.  When the openvox-release public
key isn't installed locally, `install.bash` falls back to
`[trusted=yes]` in the sources list.  Some hardened apt configs
reject `[trusted=yes]`; if so, install the repo definition `.deb`
manually first:

```bash
sudo dpkg -i /opt/openvox-pkgs/apt/openvox8-release-debian12.deb
```

### Sync runs but takes hours

The first sync is full (~2 GB).  Subsequent syncs are incremental
because `wget --mirror` skips files that haven't changed upstream.
If syncs are routinely slow, mirror only the platforms you actually
deploy. The platform names match the upstream-source layout
(`yum`, `apt`, `windows`, `mac`) -- the older `redhat,debian,ubuntu`
names from 3.3.5-1 are still accepted with a deprecation warning:

```bash
echo 'PLATFORMS=yum,apt'        | sudo tee /etc/sysconfig/openvox-repo-sync
echo 'EL_RELEASES=8,9'          | sudo tee -a /etc/sysconfig/openvox-repo-sync
echo 'UBU_RELEASES=22.04,24.04' | sudo tee -a /etc/sysconfig/openvox-repo-sync
echo 'DEB_RELEASES=12,13'       | sudo tee -a /etc/sysconfig/openvox-repo-sync
```

### "A sync is already running" -- but I don't see one

A previous sync may have been killed without cleaning up its lock
file.  Remove it manually:

```bash
sudo rm -f /opt/openvox-pkgs/.sync.lock
```

---

## Security considerations

-   **HTTP vs HTTPS** (bootstrap): The published one-liner uses
    `curl -k --noproxy <fqdn>` because the puppetserver presents
    a cert signed by its own internal CA, which the agent doesn't
    trust until install.bash gets a chance to install it. `-k` is
    a one-time band-aid for the bootstrap curl only.
-   **Permanent cert trust** (3.3.5-18+): install.bash installs the
    puppet CA into the system trust store as one of its first
    steps, so subsequent `apt-get update` / `dnf upgrade
    openvox-agent` / `curl https://<server>:8140/...` etc. work
    *without* `--insecure` / `Verify-Peer=false` / `sslverify=0`
    flags. CA goes to `/usr/local/share/ca-certificates/` (Debian/
    Ubuntu) or `/etc/pki/ca-trust/source/anchors/` (RHEL family);
    the trust store is then refreshed via `update-ca-certificates`
    or `update-ca-trust extract`.
-   **Repo signature verification**: the OpenVox repos are signed.
    install.bash fetches `openvox-keyring.gpg` from the local
    mirror and installs it into `/etc/apt/trusted.gpg.d/`. On
    failure it falls back to `[trusted=yes]` in the sources.list,
    which works but skips GPG verification -- acceptable on
    internal networks but worth knowing.
-   **Proxy bypass** (3.3.5-17/19+): install.bash exports `no_proxy`
    with the puppetserver FQDN appended (preserving any inherited
    value) so apt/yum bypass the corporate proxy for the local
    mirror. The bootstrap curl uses `--noproxy <fqdn>` for the
    same reason.
-   **Sync runs as root**: `sync-openvox-repo.sh` writes into
    `/opt/openvox-pkgs/` and chowns the result to `puppet:puppet`.
    The systemd unit runs as root. The "Sync now" button in the
    GUI shells out via `sudo` using a NOPASSWD rule restricted to
    the exact sync script path.
-   **The Agent Install page is auth-protected**. Anonymous users
    cannot trigger a sync or sign CSRs. Viewer-role users can read
    status and copy install commands but cannot trigger work.
-   **/packages/\* is intentionally unauthenticated** -- agents have
    no JWT to present. The puppetserver mount and the openvox-gui
    static mount both serve files anonymously, exactly as PE does.

---

## See also

-   [INSTALL.md](../INSTALL.md) -- main openvox-gui installation guide
-   [config/openvox-pkgs-webserver.conf](../config/openvox-pkgs-webserver.conf) -- puppetserver mount config
-   [scripts/sync-openvox-repo.sh](../scripts/sync-openvox-repo.sh) -- mirror sync script
-   [packages/install.bash](../packages/install.bash) -- Linux agent installer template
-   [packages/install.ps1](../packages/install.ps1) -- Windows agent installer template
