# openvox-gui 3.10.2-1 — Bugfix Release

> **Release:** v3.10.2-1 — maintenance cut on the 3.10.2 line (Orchestration, Monitoring, nav, Inventory export, PQL, mail ops notes).
> **Generated:** 2026-06-26
> **URLs:** https://github.com/cvquesty/openvox-gui/releases/tag/v3.10.2-1

## GitHub Release body (canonical)

```markdown
# openvox-gui 3.10.2-1 (bugfix)

Maintenance release on **3.10.2** — **not** a feature train. Collects fixes validated after the 3.10.2 stable cut (interim `3.10.2+bugfix` … `+bugfix9`).

## Bugs fixed (operator-facing)

- **Orchestration:** one click no longer runs Bolt three times ([#38](https://github.com/cvquesty/openvox-gui/issues/38)); Human / JSON / Rainbow tabs show CLI-style, structured JSON, and safe colorized views; Human no longer leaks terminal control codes; `puppet agent -t` respects run locks (`--waitforlock`) and treats exit **0/2** as success.
- **Monitoring:** Server JVM heap, catalog route latency, and process CPU **keep trend history** across refresh/reload; charts stay **inside** the panel (no drawing under the X-axis).
- **Sidebar:** section for the current page **stays expanded** so you always see context on sub-pages.
- **PQL Console:** long result values **scroll horizontally** instead of truncating.
- **Inventory export:** multi-column filter works; **Export CSV** (and copy) use the selected columns — main download is no longer “always full table only.”
- **Executive Summary mail:** clearer ops guidance when the local MTA accepts mail but remote delivery fails (empty `mailq`, direct MX vs authenticated submission / operator relay).

## Upgrade

```bash
sudo /opt/openvox-gui/scripts/update_local.sh
```

Full detail: [CHANGELOG](https://github.com/cvquesty/openvox-gui/blob/main/CHANGELOG.md) · tag `v3.10.2-1`.
```
