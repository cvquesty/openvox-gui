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
curl -k https://<puppet-server>:8140/packages/current/install.bash | sudo bash
```

OpenVox agents historically required several manual steps to install:
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

## The Installer page

`Infrastructure -> Installer` is where day-to-day operators interact
with the feature.  It shows three things:

1.  **Install commands** -- the curl/PowerShell one-liners ready to
    paste, with a copy-to-clipboard button per platform.
2.  **Mirror status** -- last sync time, total bytes mirrored, disk
    usage, and a per-platform breakdown of how many packages are
    present.  Admins and operators see a "Sync now" button.
3.  **Sync log** -- tail of `/opt/openvox-gui/logs/repo-sync.log`,
    or the captured output of the most recent manual sync.

Viewer-role users can copy the install commands but cannot trigger
a sync.

---

## How the install one-liners work

### Linux

```bash
curl -k https://<openvox-gui-server>:8140/packages/install.bash | sudo bash
```

The script:

1.  Detects the platform (RHEL family / Debian / Ubuntu, version,
    architecture) by reading `/etc/os-release`.
2.  Drops a yum/apt repo file pointing at the local mirror:
    -   RHEL: `/etc/yum.repos.d/openvox8.repo`
    -   Debian/Ubuntu: `/etc/apt/sources.list.d/openvox8.list`
3.  Installs `openvox-agent` via the platform's package manager.
4.  Sets `server` and `certname` in `/etc/puppetlabs/puppet/puppet.conf`.
5.  Starts and enables the puppet service.
6.  Symlinks `puppet`, `facter`, `hiera` into `/usr/local/bin/` for
    convenience.

You can pass extra arguments after the pipe:

```bash
curl -k https://server:8140/packages/install.bash | sudo bash -s -- \
    extension_requests:pp_role=webserver \
    extension_requests:pp_environment=prod \
    --puppet-service-ensure stopped
```

Supported argument forms:

| Argument | Effect |
|----------|--------|
| `--server <fqdn>` | Override the puppetserver FQDN baked into the script |
| `--version <7\|8>` | Pick OpenVox major version (default: 8) |
| `--puppet-service-ensure running\|stopped` | Service state after install |
| `--puppet-service-enable true\|false\|manual` | Service startup mode |
| `<section>:<key>=<value>` | Apply a setting to puppet.conf at install time |
| `custom_attributes:<key>=<value>` | Add to csr_attributes.yaml |
| `extension_requests:<key>=<value>` | Add to csr_attributes.yaml (becomes a trusted fact) |

### Windows

```powershell
[System.Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; `
[Net.ServicePointManager]::ServerCertificateValidationCallback = {$true}; `
$wc = New-Object System.Net.WebClient; `
$wc.DownloadFile('https://<openvox-gui-server>:8140/packages/install.ps1','install.ps1'); `
.\install.ps1 -v
```

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

### Puppetserver returns 404 for `/packages/install.bash`

Restart puppetserver to pick up the static-content mount config:

```bash
sudo systemctl restart puppetserver
```

If the mount config wasn't installed (you said "no" to
`INSTALL_PUPPETSERVER_MOUNT`), you can install it manually:

```bash
sudo cp /opt/openvox-gui/config/openvox-pkgs-webserver.conf \
        /etc/puppetlabs/puppetserver/conf.d/
sudo systemctl restart puppetserver
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
deploy:

```bash
echo 'PLATFORMS=redhat,ubuntu' | sudo tee /etc/sysconfig/openvox-repo-sync
echo 'EL_RELEASES=8,9'         | sudo tee -a /etc/sysconfig/openvox-repo-sync
echo 'UBU_RELEASES=jammy,noble'| sudo tee -a /etc/sysconfig/openvox-repo-sync
```

### "A sync is already running" -- but I don't see one

A previous sync may have been killed without cleaning up its lock
file.  Remove it manually:

```bash
sudo rm -f /opt/openvox-pkgs/.sync.lock
```

---

## Security considerations

-   **HTTP vs HTTPS**: install.bash uses `curl -k` (skip cert
    verification) because the puppetserver presents a self-signed cert
    by default.  This is the same pattern PE uses.  If you front the
    puppetserver with a public CA-signed cert, you can drop the `-k`.
-   **Repo signature verification**: the OpenVox repos are signed.
    On apt platforms, install.bash falls back to `[trusted=yes]` when
    the public key isn't available -- this is acceptable on internal
    networks but consider distributing the openvox-release `.deb` /
    `.rpm` alongside install.bash for production.
-   **Sync runs as root**: `sync-openvox-repo.sh` writes into
    `/opt/openvox-pkgs/` and chowns the result to `puppet:puppet`.
    The systemd unit runs as root.  The "Sync now" button in the
    GUI shells out via `sudo` using a NOPASSWD rule restricted to
    the exact sync script path.
-   **The Installer page is auth-protected**.  Anonymous users
    cannot trigger a sync.  Viewer-role users can read status and
    copy install commands but cannot trigger work.
-   **/packages/* is intentionally unauthenticated** -- agents have
    no JWT to present.  The puppetserver mount and the openvox-gui
    static mount both serve files anonymously, exactly as PE does.

---

## See also

-   [INSTALL.md](../INSTALL.md) -- main openvox-gui installation guide
-   [config/openvox-pkgs-webserver.conf](../config/openvox-pkgs-webserver.conf) -- puppetserver mount config
-   [scripts/sync-openvox-repo.sh](../scripts/sync-openvox-repo.sh) -- mirror sync script
-   [packages/install.bash](../packages/install.bash) -- Linux agent installer template
-   [packages/install.ps1](../packages/install.ps1) -- Windows agent installer template
