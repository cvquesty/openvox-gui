# openvox-gui 3.9 -- Announcement Copy (3.9.3 Security Patch)

> **Release:** v3.9.3 (current download) -- security patch release addressing multiple Dependabot vulnerabilities on top of the 3.9.2 inventory features.
> **Generated:** 2026-06-16
> **Canonical URLs:**
> - Repo: https://github.com/cvquesty/openvox-gui
> - Latest release: https://github.com/cvquesty/openvox-gui/releases/latest
> - v3.9.2 release notes (feature base): https://github.com/cvquesty/openvox-gui/releases/tag/v3.9.2
> - v3.9.3 release notes (current, security): https://github.com/cvquesty/openvox-gui/releases/tag/v3.9.3
> - Upgrade note: https://github.com/cvquesty/openvox-gui/blob/main/UPDATE.md

## How to use this file

Each section below is calibrated to one platform's voice, length limits, and markdown dialect. Copy the contents of the fenced code block under each heading and paste into the target surface.

The internal pre-release train details and dependency churn are intentionally **not** mentioned in any of the public copy -- the CHANGELOG carries the full audit trail for anyone who looks; community announcements lead with the security and user story.

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
openvox-gui 3.9.3 -- Security updates (Dependabot fixes)
```

### Body

````markdown
# openvox-gui 3.9.3 is out

This is a security patch release (v3.9.3) on top of the 3.9.2 inventory features. Current download is **v3.9.3** -- get it from the [Releases page](https://github.com/cvquesty/openvox-gui/releases/latest).

## Security updates (the headline)

We resolved all open Dependabot alerts affecting the project:

**Backend (Python):**
- `python-multipart` 0.0.29 → 0.0.31: Fixed quadratic-time querystring parsing DoS (semicolons), parameter smuggling, Content-Disposition smuggling via RFC 2231/5987, and negative Content-Length memory issues.
- `PyJWT[crypto]` 2.12.1 → 2.13.0: Fixed PyJWKClient SSRF + token forgery (file://, ftp://, data: schemes), public-key JWK accepted as HMAC secret, unbounded Base64URL decoding DoS, algorithm allow-list bypass, and unbounded JWKS endpoint DoS.
- `cryptography` 48.0.0 → 48.0.1: Fixed vulnerable OpenSSL included in bundled wheels.

**Frontend:**
- `vite` ^6.4.1 → ^7.3.5: Fixed `server.fs.deny` bypass on Windows alternate paths and launch-editor NTLMv2 hash disclosure via UNC path handling on Windows.
- Strengthened npm `overrides` for transitive issues: `esbuild` ^0.25.0 (missing binary integrity verification enabling RCE via NPM_CONFIG_REGISTRY) and `@babel/core` ^7.28.0 (arbitrary file read via sourceMappingURL Comment).

These are drop-in updates. No breaking changes for OpenVox users.

## Upgrading

```bash
sudo /opt/openvox-gui/scripts/update_local.sh
```

(Or your normal remote deploy process.) The updated requirements and lockfile will pull the hardened versions.

Full release notes: [v3.9.3](https://github.com/cvquesty/openvox-gui/releases/tag/v3.9.3) (security) and [v3.9.2](https://github.com/cvquesty/openvox-gui/releases/tag/v3.9.2) (inventory features + prior work).

Issues / feedback / PRs all welcome.
````

---

## 2. VoxPupuli Connect (Discourse forum)

Slightly less formal than the GitHub post, conversational opener.

### Title

```
[Release] openvox-gui 3.9.3 -- security updates (Dependabot fixes)
```

### Body

````markdown
Just shipped openvox-gui 3.9.3 (security patch on the 3.9.2 inventory release).

**Security hardening.** Resolved all open Dependabot alerts:

- Backend: python-multipart (multiple DoS + smuggling issues) to 0.0.31, PyJWT (SSRF, token forgery, DoS, bypasses) to 2.13.0, cryptography (OpenSSL wheels) to 48.0.1.
- Frontend: vite (Windows UNC/fs bypass + editor issues) to 7.3.5, plus overrides for esbuild (RCE vector) and @babel/core (file read).

All within the existing 3.9 series (live inventory reports, etc.). Drop-in upgrade.

Repo + release: https://github.com/cvquesty/openvox-gui/releases/latest

Stay safe out there.
````

---

## 3. VoxPupuli Slack (any open channel -- `#openvox`, `#general`, `#announcements`)

Slack syntax (`*bold*`, `_italic_`).

````
*openvox-gui 3.9.3 is out* -- security patch.

Bumped:
* python-multipart 0.0.29→0.0.31 (DoS/smuggling fixes)
* PyJWT 2.12.1→2.13.0 (SSRF/forgery/DoS/bypass fixes)
* cryptography 48.0.0→48.0.1 (OpenSSL wheels)
* vite ^6.4→^7.3.5 (Windows bypasses)
* + overrides for esbuild + @babel/core

On top of 3.9.2's live Inventory reports. Drop-in.

Releases: https://github.com/cvquesty/openvox-gui/releases/latest
````

---

## 4. Reddit r/sysadmin and/or r/Puppet

Reddit favors honest, "I built this and here's what changed" framing. Avoid marketing-speak.

### Title (works for r/Puppet, r/sysadmin, r/devops)

```
[Release] openvox-gui 3.9.3 -- security dependency updates for the OpenVox web GUI
```

### Body

````markdown
Maintainer here. Just cut the 3.9.3 security patch release of [openvox-gui](https://github.com/cvquesty/openvox-gui) (on top of the 3.9.2 inventory work).

**Security updates.** Closed all open Dependabot alerts by bumping:

- python-multipart (0.0.29 → 0.0.31): quadratic DoS, multiple parameter/Content-Disposition smuggling vectors.
- PyJWT (2.12.1 → 2.13.0): SSRF/token forgery via PyJWKClient, HMAC forgery with public keys, unbounded DoS, algorithm bypasses.
- cryptography (48.0.0 → 48.0.1): vulnerable OpenSSL in wheels.
- vite (^6.4.1 → ^7.3.5): Windows UNC path launch-editor NTLM disclosure and server.fs.deny bypass.
- Added npm overrides for esbuild (RCE via missing binary verification) and @babel/core (file read via source maps).

These are the kinds of issues that show up in fleet management tools. All changes are in the backend requirements and frontend lockfile. No user-facing breakage.

Apache-2.0. Builds on the live Inventory page from 3.9.2.

Repo: https://github.com/cvquesty/openvox-gui
Release: https://github.com/cvquesty/openvox-gui/releases/tag/v3.9.3

Happy to answer questions or take feedback in the thread.
````

---

## 5. Mastodon (sysadmin / DevOps community -- Fosstodon, hachyderm.io)

Single toot, ~470 chars, hashtags at the end.

````
openvox-gui 3.9.3 just shipped (security patch).

Bumps: python-multipart (DoS/smuggling), PyJWT (SSRF/forgery/DoS/bypasses), cryptography (OpenSSL), vite (Windows bypasses + editor), + overrides for esbuild/@babel/core.

On top of 3.9.2's live Inventory reports. Drop-in for OpenVox fleets.

https://github.com/cvquesty/openvox-gui/releases/latest

#OpenVox #Puppet #DevOps #SysAdmin #Security
````

---

## 6. X / Twitter (3-tweet thread, ~270 chars each)

### Tweet 1 (anchor)

````
openvox-gui 3.9.3 just shipped -- security patch release.

Bumped python-multipart, PyJWT, cryptography, vite + overrides to close all open Dependabot alerts (DoS, smuggling, SSRF, forgery, Windows bypasses, RCE vectors).
````

### Tweet 2

````
Details:
- python-multipart 0.0.29→0.0.31
- PyJWT 2.12.1→2.13.0
- cryptography 48.0.0→48.0.1
- vite ^6.4→^7.3.5
- esbuild + @babel/core overrides

Builds on 3.9.2 inventory features.
````

### Tweet 3 (CTA)

````
Apache-2.0. Drop-in for OpenVox/Puppet 8.

Releases: https://github.com/cvquesty/openvox-gui/releases/latest
Full notes in CHANGELOG.
````

---

## 7. LinkedIn

Professional, story-shaped. Good fit for the SS Consulting Group identity.

````
Shipped openvox-gui 3.9.3 today.

This is a security patch release on the 3.9 series (which added live Inventory reporting in 3.9.2).

We closed every open Dependabot alert:

- Backend Python deps: python-multipart (multiple DoS and smuggling issues), PyJWT (SSRF, token forgery, DoS, algorithm bypasses), cryptography (OpenSSL wheels).
- Frontend: vite (Windows-specific bypasses and disclosure), plus overrides hardening esbuild (RCE) and @babel/core (file reads).

These updates are in the requirements.txt and package-lock.json. No breaking changes — just a more secure base for managing OpenVox fleets.

Apache-2.0 licensed, community-driven.

Repo: https://github.com/cvquesty/openvox-gui
Release: https://github.com/cvquesty/openvox-gui/releases/latest

#OpenVox #Puppet #DevOps #Security #InfrastructureAsCode #OpenSource
````

---

## 8. Hacker News (Show HN -- optional)

If you want to test community reception there. HN audience is harsher but if it lands it'll drive real eyeballs to the repo. Title <80 chars, no emoji, no marketing-speak.

### Title

```
Show HN: openvox-gui 3.9.3 -- security updates for the OpenVox web GUI
```

### First comment (post immediately after submission so it appears at top)

````
Maintainer here. openvox-gui is an Apache-2.0 web GUI for OpenVox (community open-source Puppet). 3.9.2 added live inventory reporting; 3.9.3 is a security patch that resolves all open Dependabot alerts on the default branch.

Bumps:
- python-multipart (DoS + smuggling vectors)
- PyJWT (SSRF, forgery, DoS, bypasses)
- cryptography (OpenSSL in wheels)
- vite (Windows UNC/fs bypasses + editor disclosure)
- overrides for esbuild (RCE) and @babel/core (file reads)

All changes are dependency-only. The 3.9 series (FastAPI + React/Mantine) remains the same for users.

https://github.com/cvquesty/openvox-gui
````

---

## Notes

- Each section's body is in a fenced code block so you can triple-click + copy without picking up surrounding text.
- This is a pure security patch release (3.9.3) on the 3.9.2 feature base (Inventory reports). Scope copy to the hardening work where appropriate.
- LinkedIn copy uses the SS Consulting Group voice.
- For the X thread, post as replies.
- The Mastodon toot is sized for default limits.
- This press document was created as part of the official GitHub release process per the updated AGENTS.md.
- Pruned the last Dependabot branch (python-multipart) as part of cleanup.
