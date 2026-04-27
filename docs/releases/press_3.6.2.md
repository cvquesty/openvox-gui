# openvox-gui 3.6 -- Announcement Copy

> **Release:** v3.6.2 (current download) -- consolidates the v3.6.0 feature work and the v3.6.1 security patches.
> **Generated:** 2026-04-26
> **Canonical URLs:**
> - Repo: https://github.com/cvquesty/openvox-gui
> - Latest release: https://github.com/cvquesty/openvox-gui/releases/latest
> - v3.6.0 release notes (full feature story): https://github.com/cvquesty/openvox-gui/releases/tag/v3.6.0
> - v3.6.2 release notes (current): https://github.com/cvquesty/openvox-gui/releases/tag/v3.6.2
> - Installer feature guide: https://github.com/cvquesty/openvox-gui/blob/main/docs/INSTALLER.md
> - Upgrade note: https://github.com/cvquesty/openvox-gui/blob/main/UPDATE.md

## How to use this file

Each section below is calibrated to one platform's voice, length limits, and markdown dialect. Copy the contents of the fenced code block under each heading and paste into the target surface.

The internal v3.6.1 -> v3.6.2 release-engineering churn is intentionally **not** mentioned in any of the public copy -- the CHANGELOG carries the full audit trail for anyone who looks; community announcements lead with the feature and security story.

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
openvox-gui 3.6 -- Agent Installer + Security Hardening
```

### Body

````markdown
# openvox-gui 3.6 is out

Today's release brings the biggest feature openvox-gui has shipped to date: a full **PE-style agent installer**, plus comprehensive **security hardening** across every privileged endpoint. Current download is **v3.6.2** -- get it from the [Releases page](https://github.com/cvquesty/openvox-gui/releases/latest).

## OpenVox Agent Installer (the headline)

If you've ever migrated to OpenVox from Puppet Enterprise and missed the `curl ... | sudo bash` agent bootstrap, this release closes that gap.

```bash
# Linux
curl -k --noproxy <fqdn> https://<fqdn>:8140/packages/install.bash | sudo bash
```

```powershell
# Windows
[Net.ServicePointManager]::ServerCertificateValidationCallback = {$true}
$wc = New-Object Net.WebClient; $wc.Proxy = $null
iex $wc.DownloadString('https://<fqdn>:8140/packages/install.ps1')
```

The script that downloads to your agent is fully self-configuring -- no `--server` arg required. It discovers the puppetserver FQDN by reading the kernel's TCP state (`/proc/net/tcp`) and reverse-DNSing the IP of the curl connection that just downloaded it. It then installs the puppet CA into the system trust store so subsequent `apt-get update` / `dnf upgrade openvox-agent` work without any `--insecure` / `Verify-Peer=false` band-aids, sets `no_proxy` so apt/yum bypass corporate proxies for your local mirror, and installs `openvox-agent` from a local OpenVox package mirror at `/opt/openvox-pkgs/`.

The mirror is populated nightly from `yum.voxpupuli.org`, `apt.voxpupuli.org`, and `downloads.voxpupuli.org` and served on the standard puppetserver port (8140) via a static-content mount drop-in -- no new firewall rules. RHEL family, Debian, Ubuntu, Windows, and macOS are all covered out of the box.

The whole agent bring-up workflow now lives on a single page: paste the install one-liner on your agent, wait for the CSR to appear in **Infrastructure -> Agent Install -> Pending Certificate Requests**, click **Sign**, done.

Full feature reference: [docs/INSTALLER.md](https://github.com/cvquesty/openvox-gui/blob/main/docs/INSTALLER.md).

## Security hardening

3.6 closes every CRITICAL and HIGH finding from an internal security audit:

- **Per-route role enforcement** on every privileged endpoint (Bolt, Cert Authority, Configuration, ENC, PQL Console). Pre-3.6, an authenticated `viewer` could still trigger Bolt commands as root, sign certs, edit Hiera, or restart the puppet stack -- now each endpoint declares the minimum role it requires.
- **Deploy webhook (`/api/deploy/webhook`)** now requires HMAC-SHA256 signature verification with a shared secret. Disabled by default; opt in via `OPENVOX_GUI_DEPLOY_WEBHOOK_SECRET`.
- **JWT logout actually revokes the token** via a server-side `jti` denylist. Pre-3.6, `/logout` only deleted the cookie -- the JWT stayed cryptographically valid for its full 24-hour expiry.
- **LDAP bind password encrypted at rest** with Fernet (AES-128-CBC + HMAC-SHA256). Plaintext values are read transparently and re-encrypted on next save.
- **Sudoers wildcards tightened** -- replaced the dangerous `openssl x509 *` and `puppetserver ca *` patterns with explicit per-form rules.
- **3.6.2** also folds in two Dependabot patches: `postcss` 8.5.6 -> 8.5.12 (XSS) and `python-multipart` 0.0.22 -> 0.0.26 (DoS).

## UI reorganization

**Infrastructure** is now a top-level nav group (Certificate Authority / Orchestration / Agent Install), so the agent bring-up workflow has a proper home. The Agent Install page consolidates Install Commands, Mirror Status, Sync Log, and Pending Certificate Requests into one screen.

## Upgrading

```bash
sudo /opt/openvox-gui/scripts/update_local.sh
```

If you use the GitHub deploy webhook, see the [mandatory webhook-secret action note](https://github.com/cvquesty/openvox-gui/blob/main/UPDATE.md#special-note-for-upgrades-to-360-or-later) in `UPDATE.md`. Otherwise, no special action required.

Full release notes: [v3.6.0](https://github.com/cvquesty/openvox-gui/releases/tag/v3.6.0) (feature release) and [v3.6.2](https://github.com/cvquesty/openvox-gui/releases/tag/v3.6.2) (current).

Issues / feedback / PRs all welcome.
````

---

## 2. VoxPupuli Connect (Discourse forum)

Slightly less formal than the GitHub post, conversational opener.

### Title

```
[Release] openvox-gui 3.6 -- agent installer + security hardening
```

### Body

````markdown
Just shipped openvox-gui 3.6. Two big things in this release:

**1. Agent installer.** Full PE-style bootstrap workflow for OpenVox -- a one-line `curl ... | sudo bash` for Linux and the equivalent PowerShell snippet for Windows, backed by a local OpenVox package mirror at `/opt/openvox-pkgs/` populated nightly from yum/apt.voxpupuli.org. The bootstrap script auto-discovers the puppetserver FQDN from the kernel's TCP state (no `--server` arg needed), installs the puppet CA into the system trust store so future `apt-get update` works without flags, and handles corporate proxy bypass automatically.

The whole agent bring-up flow lives on one page now: copy the install one-liner, paste on the agent, wait for the CSR to show up, click Sign.

**2. Security hardening.** Closed every CRITICAL/HIGH from an internal audit:
- Per-route role enforcement on every privileged endpoint (was: any authenticated viewer could fire Bolt commands as root)
- HMAC-signed deploy webhook (was: open r10k-deploy-as-root entrypoint)
- JWT denylist on logout (was: token stayed valid for 24h after logout)
- LDAP bind password encrypted at rest with Fernet
- Tightened sudoers wildcards

3.6.2 also patches two Dependabot findings (postcss XSS, python-multipart DoS).

Repo + release notes: https://github.com/cvquesty/openvox-gui/releases/latest
Full installer docs: https://github.com/cvquesty/openvox-gui/blob/main/docs/INSTALLER.md

Feedback welcome -- happy to iterate based on what folks need.
````

---

## 3. VoxPupuli Slack (any open channel -- `#openvox`, `#general`, `#announcements`)

Slack syntax (`*bold*`, `_italic_`).

````
*openvox-gui 3.6 is out* -- finally brings PE-style agent install to OpenVox.

`curl -k --noproxy <fqdn> https://<fqdn>:8140/packages/install.bash | sudo bash`

Self-configuring (no --server arg), installs the puppet CA into the system trust store, handles corporate proxies, signs CSRs from the same page. Local mirror under /opt/openvox-pkgs/ populated nightly from yum/apt.voxpupuli.org.

Also closed every CRIT/HIGH from a security audit: per-route role enforcement, HMAC-signed deploy webhook, JWT denylist on logout, encrypted LDAP password, tightened sudoers.

Releases: https://github.com/cvquesty/openvox-gui/releases/latest
Installer docs: https://github.com/cvquesty/openvox-gui/blob/main/docs/INSTALLER.md
````

---

## 4. Reddit r/sysadmin and/or r/Puppet

Reddit favors honest, "I built this and here's what changed" framing. Avoid marketing-speak.

### Title (works for r/Puppet, r/sysadmin, r/devops)

```
[Release] openvox-gui 3.6 -- agent installer + security audit fixes for the OpenVox web GUI
```

### Body

````markdown
Maintainer here. Just cut the 3.6 release of [openvox-gui](https://github.com/cvquesty/openvox-gui) -- the open-source web GUI for managing an OpenVox (the open-source Puppet fork) installation. Two things worth your attention if you run OpenVox:

**Agent installer.** If you came to OpenVox from PE, you probably miss the `curl ... | sudo bash` agent bootstrap. 3.6 brings it back: one-liner for Linux, equivalent PowerShell for Windows, backed by a local mirror at `/opt/openvox-pkgs/` synced nightly from voxpupuli.org. The bootstrap script figures out the puppetserver FQDN on its own (reads `/proc/net/tcp`, reverse-DNSes the curl connection that downloaded it), installs the puppet CA into the system trust store, handles corporate proxy bypass, and signs the CSR from the same page in the GUI.

```
curl -k --noproxy <fqdn> https://<fqdn>:8140/packages/install.bash | sudo bash
```

**Security hardening.** Did an audit at the end of the test cycle and closed every CRITICAL/HIGH:

- Per-route role enforcement on every privileged endpoint. Pre-3.6, any authenticated user including `viewer` could trigger Bolt commands as root, sign/revoke certs, edit Hiera, restart the puppet stack. Now each endpoint declares its minimum role.
- Deploy webhook now requires HMAC-SHA256 sig verification with a shared secret. Disabled by default. Pre-3.6 it was an open r10k-deploy-as-root entrypoint.
- JWT logout actually revokes the token now (server-side denylist via `jti` claim). Pre-3.6, `/logout` only deleted the cookie -- the JWT itself stayed valid for its full 24h expiry.
- LDAP bind password encrypted at rest with Fernet. Was previously plaintext in SQLite despite the column comment claiming otherwise.
- Tightened sudoers wildcards -- replaced `openssl x509 *` (which allowed arbitrary file write as root) with per-form rules.

Plus 3.6.2 patches two Dependabot findings (postcss XSS, python-multipart DoS).

Apache-2.0 licensed. Repo: https://github.com/cvquesty/openvox-gui

Happy to answer questions or take feedback in the thread.
````

---

## 5. Mastodon (sysadmin / DevOps community -- Fosstodon, hachyderm.io)

Single toot, ~470 chars, hashtags at the end.

````
openvox-gui 3.6 just shipped. Brings PE-style agent install to OpenVox: one-line curl|bash bootstrap, self-configuring (auto-discovers the puppetserver FQDN), installs the puppet CA into the system trust store, handles corporate proxy bypass.

Plus a security pass that closed every CRIT/HIGH from an internal audit: per-route role enforcement, HMAC-signed deploy webhook, JWT logout denylist, encrypted LDAP password.

https://github.com/cvquesty/openvox-gui/releases/latest

#OpenVox #Puppet #DevOps #SysAdmin
````

---

## 6. X / Twitter (3-tweet thread, ~270 chars each)

### Tweet 1 (anchor)

````
openvox-gui 3.6 just shipped -- the open-source web GUI for OpenVox now has full PE-style agent install.

curl -k --noproxy <fqdn> https://<fqdn>:8140/packages/install.bash | sudo bash

Self-configuring. Auto CA trust. Corporate proxy bypass. Sign CSRs from the same page.
````

### Tweet 2

````
3.6 also closes every CRITICAL/HIGH from an internal security audit:

* Per-route role enforcement on every privileged endpoint
* HMAC-SHA256 signed deploy webhook
* Real JWT revocation on logout (server-side denylist)
* Fernet-encrypted LDAP bind password
* Tightened sudoers wildcards
````

### Tweet 3 (CTA)

````
3.6.2 (current download) also folds in two Dependabot patches -- postcss XSS + python-multipart DoS.

Apache-2.0. Drop-in for any OpenVox / Puppet 8 fleet.

Releases: https://github.com/cvquesty/openvox-gui/releases/latest
Installer docs: https://github.com/cvquesty/openvox-gui/blob/main/docs/INSTALLER.md
````

---

## 7. LinkedIn

Professional, story-shaped. Good fit for the SS Consulting Group identity.

````
Shipped openvox-gui 3.6 today.

For folks not deep in the weeds: openvox-gui is an open-source web management interface for OpenVox -- the community-led continuation of Puppet open-source. It gives ops teams a fleet dashboard, certificate management, orchestration via Bolt, Hiera browsing, and a few other quality-of-life tools, all without needing Puppet Enterprise's commercial Console.

3.6 brings two things I'm proud of.

The headline feature is a full PE-style agent installer. If you've migrated from Puppet Enterprise to OpenVox, you've felt the gap -- PE's `curl ... | sudo bash` agent bootstrap is one of the things people miss most. 3.6 closes it: a one-line install for Linux, the equivalent for Windows, backed by a local OpenVox package mirror that's populated nightly from voxpupuli.org. The bootstrap script figures out the puppetserver FQDN on its own by reading the kernel's TCP state, installs the puppet CA into the system trust store so subsequent package updates work without security band-aids, and handles corporate proxy bypass automatically. Paste the one-liner on your agent, sign the CSR in the GUI, done.

The other half is a thorough security pass. I ran an internal audit at the end of the test cycle and closed every CRITICAL and HIGH finding -- per-route role enforcement on every privileged endpoint (so an authenticated viewer can no longer trigger Bolt commands as root), HMAC signature verification on the deploy webhook, real JWT revocation on logout via a server-side denylist, Fernet encryption of the LDAP bind password at rest, and tightened sudoers wildcards. The companion 3.6.2 patch release also folds in two Dependabot fixes.

Apache-2.0 licensed, runs anywhere OpenVox runs, and built for teams who want PE-grade ergonomics on community-edition infrastructure.

Repo: https://github.com/cvquesty/openvox-gui
Release: https://github.com/cvquesty/openvox-gui/releases/latest

#OpenVox #Puppet #DevOps #InfrastructureAsCode #OpenSource
````

---

## 8. Hacker News (Show HN -- optional)

If you want to test community reception there. HN audience is harsher but if it lands it'll drive real eyeballs to the repo. Title <80 chars, no emoji, no marketing-speak.

### Title

```
Show HN: openvox-gui 3.6 -- web management for OpenVox (open-source Puppet fork)
```

### First comment (post immediately after submission so it appears at top)

````
Maintainer here. openvox-gui is an Apache-2.0 web GUI for OpenVox, the community-led continuation of Puppet open-source. It gives you fleet dashboard, certificate management, Bolt orchestration, Hiera browsing, ENC, and PQL console -- basically the things you'd reach for the PE Console for, without paying for PE.

3.6 was the release I'd been holding the "feature complete" label for. Two big things:

(1) A full PE-style agent installer. One-line curl|bash for Linux, equivalent PowerShell for Windows, backed by a local OpenVox package mirror under /opt/openvox-pkgs/ populated nightly from voxpupuli.org. The bootstrap script auto-discovers the puppetserver FQDN by reading the kernel's TCP state (/proc/net/tcp lingers in CLOSE_WAIT for ~60s after curl exits -- works out perfectly), installs the puppet CA into the system trust store so subsequent apt-get update works without --insecure flags, and handles corporate proxy bypass. The whole bring-up flow including CSR signing lives on one page.

(2) A security pass that closed every CRITICAL/HIGH from an internal audit: per-route role enforcement (was: any authenticated user could trigger root-level Bolt commands), HMAC-signed deploy webhook, real JWT revocation on logout via a server-side denylist with `jti` claims, Fernet-encrypted LDAP bind password at rest, tightened sudoers patterns (the previous `openssl x509 *` rule allowed `-out /etc/shadow` as root -- that's gone).

Stack is FastAPI + React/TypeScript/Mantine, SQLite via SQLAlchemy. Runs as a systemd unit, deploys via a single install.sh that handles cert trust, repo mirror, and puppetserver static-content mount setup.

Happy to dig into any of the design choices.

https://github.com/cvquesty/openvox-gui
````

---

## Notes

- Each section's body is in a fenced code block so you can triple-click + copy without picking up surrounding text.
- The Reddit and HN posts mention features (Hiera, ENC, PQL Console) that predate 3.6; they're useful context for new audiences. If you'd rather scope strictly to "what's new in 3.6," delete those clauses.
- LinkedIn copy uses your SS Consulting Group voice -- adjust the first paragraph if you want it framed as personal vs. company.
- For the X thread, post tweets 2 and 3 as replies to tweet 1 (not standalone posts), so they thread properly.
- The Mastodon toot fits in a default 500-char instance; if you're on an instance with a higher limit you have room to add a sentence about the security work.
