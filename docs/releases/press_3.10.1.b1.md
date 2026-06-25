# openvox-gui 3.10.1.b1 -- Announcement Copy (Beta)

> **Release:** v3.10.1.b1 (beta / pre-release) -- First beta on `main` after merging the 3.10 alpha refactor trains (security, architecture, Monitoring NOC / Ops UI).
> **Generated:** 2026-06-25
> **Canonical URLs:**
> - Repo: https://github.com/cvquesty/openvox-gui
> - This release: https://github.com/cvquesty/openvox-gui/releases/tag/v3.10.1.b1
> - Upgrade note: https://github.com/cvquesty/openvox-gui/blob/main/UPDATE.md

## How to use this file

Beta announcement kit. Prefer **GitHub Release notes** as the canonical surface; other platforms can wait until stable **3.10.1** if you want less noise.

| # | Platform | Notes |
|---|----------|--------|
| 1 | GitHub Release | Primary for betas — use the notes below |
| 2 | GitHub Discussions | Optional; link the pre-release |
| 3–8 | Community channels | Prefer holding for stable 3.10.1 unless testers need a heads-up |

---

## 1. GitHub Release -- body (use with `gh release create`)

```markdown
# openvox-gui 3.10.1.b1 (beta)

**Pre-release** — first **3.10.1** beta on `main` after landing the full `3.10.a_r_alpha.6` train (formerly labeled through **3.10.04.a8** on lab). Same product line; versioning settled for beta cadence (**b2**, **b3**, … then stable **3.10.1**).

## Highlights

- **Monitoring NOC wallboard** — multi-graph live Monitoring with a shared UTC timeline (windowed trends + live JMX/series fixes for seconds-vs-ms).
- **Ops UI consistency (sruiux2)** — shared **OpsTable** / **FilterBar** patterns on fleet list surfaces; Insights hub at `/insights/all`.
- **3.10 platform work from alpha** — security, architecture, and UI trains merged from alpha into `main` (see CHANGELOG for the full train).
- **Executive Summary** — From-address / schedule delivery included (supersedes the interim **3.9.8** main-only port).

## Upgrading (lab / test)

Remote (typical lab):

```bash
OPENVOX_DEPLOY_HOST=<host> OPENVOX_DEPLOY_USER=<user> scripts/update_remote.sh --yes
```

On-box:

```bash
sudo /opt/openvox-gui/scripts/update_local.sh
```

## Notes for testers

- This is a **beta** tag (`3.10.1.b1`), not a stable SemVer promotion.
- Full audit trail: [CHANGELOG.md](https://github.com/cvquesty/openvox-gui/blob/main/CHANGELOG.md).
- Feedback and issues welcome on the repo.

**Tag:** `v3.10.1.b1` on `main` @ merge settle commit.
```

---

## 2. Short social (optional)

```
openvox-gui v3.10.1.b1 beta is on main — Monitoring NOC + ops UI train from the 3.10 alpha merge. Pre-release only; lab/test first.
https://github.com/cvquesty/openvox-gui/releases/tag/v3.10.1.b1
```
