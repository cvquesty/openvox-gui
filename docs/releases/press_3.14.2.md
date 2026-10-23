# openvox-gui 3.14.2 -- Announcement Copy

> **Release:** v3.14.2 (current download) -- agent install uses the CA, fresh installs can run Bolt, and the package mirror finishes the sync.
> **Generated:** 2026-10-23
> **Canonical URLs:**
>
> - Repo: <https://github.com/cvquesty/openvox-gui>
> - Latest release: <https://github.com/cvquesty/openvox-gui/releases/latest>
> - v3.14.2 release notes (current): <https://github.com/cvquesty/openvox-gui/releases/tag/v3.14.2>
> - Status / operator map: <https://github.com/cvquesty/openvox-gui/blob/main/docs/STATUS.md>
> - Agent installer: <https://github.com/cvquesty/openvox-gui/blob/main/docs/INSTALLER.md>
> - Upgrade: <https://github.com/cvquesty/openvox-gui/blob/main/UPDATE.md>
> - Changelog: <https://github.com/cvquesty/openvox-gui/blob/main/CHANGELOG.md>

## How to use this file

Each section below is calibrated to one platform's voice, length limits, and markdown dialect. Copy the contents of the fenced code block under each heading and paste into the target surface.

Internal train numbers (`3.14.1-dev.N`) stay in CHANGELOG. Public copy leads with what an operator sees.

| # | Platform | Length | Tone | Markdown? |
|---|----------|--------|------|-----------|
| 1 | GitHub Discussions (canonical) | Long | Formal, polished | Yes (GFM) |
| 2 | VoxPupuli Connect (Discourse) | Medium | Conversational | Yes |
| 3 | VoxPupuli Slack | Short | Casual, link-heavy | Slack syntax |
| 4 | Reddit r/sysadmin / r/Puppet | Medium | "I built this" | Yes |
| 5 | Mastodon (Fosstodon, hachyderm) | 1 toot, ~470 chars | Factual + hashtags | Plain |
| 6 | X / Twitter | 3-tweet thread, ~270 chars each | Punchy | Plain |
| 7 | LinkedIn | Medium, story-shaped | Professional | Plain |
| 8 | Hacker News (Show HN) | Title + first comment | Technical, no marketing | Plain |

---

## 1. GitHub Discussions -- Announcement post

Best home for the canonical announcement. Pin it.

### Title

```
openvox-gui 3.14.2 -- Agent install uses the CA, and the mirror finishes
```

### Body

````markdown
# openvox-gui 3.14.2 is out

Stable **v3.14.2** is on the [Releases page](https://github.com/cvquesty/openvox-gui/releases/latest). This is the next stable after 3.14.0. All-in-one on the OpenVox Server is still the default install.

## Agent install talks to the CA

On a clustered console, `install.bash` was baking the compiler VIP as `CA_SERVER`. Compilers have the CA turned off, so those agents sent CSRs nowhere useful.

3.14.2 reads the CA VIP from `.env`, then from Cluster **CA VIP FQDNs**, and never writes a hostname that contains `compiler`. Saving Cluster or Application CA settings rewrites `/opt/openvox-pkgs/install.bash`.

After upgrade:

```bash
grep '^CA_SERVER=' /opt/openvox-pkgs/install.bash
```

That line should be the CA VIP.

## Fresh installs can run Bolt

`install.sh` configured Bolt from `bolt-plugin/openvox_enc` but never copied that directory into the install tree. Every Bolt run then failed with `Unknown plugin: 'openvox_enc'`. The installer copies the plugin, and upgrades refresh the live module.

## The package mirror finishes the sync

A single missing package, an unpublished yum arch, or a full disk used to stop the run or leave a success toast on the previous log. 3.14.2:

- Keeps going after one package failure
- Skips unpublished yum arches
- Stops when a selected major lands zero packages
- Aborts on a curl write error instead of looping
- Waits for a live sync lock before it reports success
- Wraps Sync now so `requiretty` sudo still runs
- Selects OpenVox 8 and 9 together

## Python 3.11

SQLAlchemy 2.1.4 needs Python 3.11 or newer. When the system `python3` is older and you did not set `PYTHON_BIN`, the installer picks `python3.13`, `python3.12`, or `python3.11`, and installs Python 3.12 from the distro repos when none of those exist. Set `INSTALL_PYTHON=false` on an air-gapped host.

## What operators see

- The Nodes page counts each certname once. Classified and unclassified lists no longer overlap.
- Node and report rows are links. Icon buttons and search fields have names. The command palette moves with the arrow keys.
- A viewer who opens Orchestration, Code Deploy, Agent Install, Hiera files, or configuration gets a read-only empty state. The page does not mount.

## Upgrading

```bash
sudo /opt/openvox-gui/scripts/update_local.sh
```

Hard-refresh browsers once. Hosts still on Python 3.10 need 3.11 or newer before this upgrade.

Full notes: [v3.14.2](https://github.com/cvquesty/openvox-gui/releases/tag/v3.14.2) · [CHANGELOG](https://github.com/cvquesty/openvox-gui/blob/main/CHANGELOG.md) · [UPDATE.md](https://github.com/cvquesty/openvox-gui/blob/main/UPDATE.md).

Issues / feedback / PRs welcome.
````

---

## 2. VoxPupuli Connect (Discourse forum)

### Title

```
[Release] openvox-gui 3.14.2 -- agent install uses the CA VIP
```

### Body

````markdown
Just shipped openvox-gui 3.14.2, the next stable after 3.14.0.

**1. Agent install uses the CA.** Clustered `install.bash` no longer bakes the compiler VIP. It reads the CA VIP from settings, and saving Cluster rewrites the script on disk.

**2. Fresh installs can run Bolt.** `openvox_enc` is copied into the install tree. The old failure was `Unknown plugin: 'openvox_enc'`.

**3. The package mirror finishes.** One failed package, a missing yum arch, or a full disk no longer looks like a successful sync. OpenVox 8 and 9 are selected together.

Also: Python 3.11 is the floor (the installer can supply 3.12), the Nodes count no longer double-counts a certname, and keyboard access covers rows and the command palette.

Repo + release notes: https://github.com/cvquesty/openvox-gui/releases/latest
Installer: https://github.com/cvquesty/openvox-gui/blob/main/docs/INSTALLER.md

Feedback welcome.
````

---

## 3. VoxPupuli Slack (`#openvox`, `#general`, `#announcements`)

````
*openvox-gui 3.14.2 is out* -- clustered agent install uses the CA VIP, not the compiler. Fresh installs ship the openvox_enc Bolt plugin. The package mirror keeps going after one failed package.

Python 3.11 is the floor. The Nodes page counts each certname once.

Releases: https://github.com/cvquesty/openvox-gui/releases/latest
Installer: https://github.com/cvquesty/openvox-gui/blob/main/docs/INSTALLER.md
````

---

## 4. Reddit r/sysadmin and/or r/Puppet

### Title

```
[Release] openvox-gui 3.14.2 -- OpenVox web GUI; agent install hits the CA, not the compiler
```

### Body

````markdown
I maintain openvox-gui, a web console for OpenVox (the open-source Puppet platform). 3.14.2 is a patch on 3.14.0.

On a clustered install, the agent bootstrap script was sending CSRs to a compiler. Compilers do not run the CA. The script now bakes the CA VIP from the console settings, and saving those settings rewrites the file on disk.

A fresh install also failed every Bolt run because the `openvox_enc` plugin was configured but never copied into the install directory. That copy happens now.

The local package mirror used to stop, or report the previous run, when one package failed or the disk filled. It now skips a missing yum arch, stops cleanly on a write error, and selects OpenVox 8 and 9 together.

Python 3.11 is required. The installer will install Python 3.12 from the distro repos when the system Python is older.

https://github.com/cvquesty/openvox-gui/releases/tag/v3.14.2
````

---

## 5. Mastodon

```
openvox-gui 3.14.2 is out.

Clustered agent install uses the CA VIP, not the compiler. Fresh installs include the Bolt plugin. The package mirror finishes after a single package failure. Python 3.11 is the floor.

https://github.com/cvquesty/openvox-gui/releases/tag/v3.14.2

#OpenVox #Puppet #SysAdmin
```

---

## 6. X / Twitter

```
openvox-gui 3.14.2: agent install on a cluster now talks to the CA VIP. Compilers do not sign CSRs.

https://github.com/cvquesty/openvox-gui/releases/tag/v3.14.2
```

```
Fresh installs copy the openvox_enc Bolt plugin. The old error was "Unknown plugin: openvox_enc".
```

```
The package mirror keeps syncing after one failed package. Python 3.11 is required; the installer can supply 3.12.
```

---

## 7. LinkedIn

```
openvox-gui 3.14.2 is the next stable after 3.14.0.

The agent bootstrap on a clustered console was sending certificate requests to a compiler. Compilers do not run the CA. The script now uses the CA VIP from the console, and saving that setting rewrites the file operators hand to new agents.

A new install can also run Bolt. The openvox_enc plugin is copied in instead of being configured and then missing.

The local package mirror finishes a sync when one package fails, and Python 3.11 is the new floor.

https://github.com/cvquesty/openvox-gui/releases/tag/v3.14.2
```

---

## 8. Hacker News (Show HN)

### Title

```
Show HN: openvox-gui 3.14.2 – web console for OpenVox, agent install uses the CA
```

### First comment

```
openvox-gui is a FastAPI and React console for an OpenVox server: fleet status, ENC, code deploy, and an agent installer that serves a local package mirror.

3.14.2 fixes three operator bugs from the 3.14.0 line. Clustered install.bash baked the compiler VIP as the CA, so new agents sent CSRs to a host with the CA disabled. The script now takes the CA VIP from console settings. install.sh configured Bolt's openvox_enc plugin without copying the module, so every Bolt run failed. And the package mirror reported success from the previous log when the new sync had not started, or aborted the whole run on one missing package.

Python 3.11 is required because of SQLAlchemy 2.1. The installer installs Python 3.12 from distro repos when it has to.

https://github.com/cvquesty/openvox-gui
```
