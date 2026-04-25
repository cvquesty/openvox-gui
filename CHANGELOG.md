# Changelog

All notable changes to OpenVox GUI are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Note:** Earlier entries reference "Puppet" product names (PuppetServer, PuppetDB, Puppet Bolt).
> As the OpenVox project evolves, these are being rebranded to OpenVox Server, OpenVoxDB, and
> OpenBolt respectively. Historical entries are preserved as-is for accuracy.

## [3.3.5-29] - 2026-04-24

### Security
- **`/api/auth/logout` now actually revokes the JWT** (audit finding HIGH-11). Previously logout only deleted the cookie client-side -- the underlying JWT stayed cryptographically valid for its full 24-hour expiry, so anyone who captured the token (browser cache, network tap pre-HTTPS, copy-pasted curl) could keep using it indefinitely after the user thought they had logged out. Now the token's `jti` is added to a server-side denylist; subsequent requests with the same token are rejected even though the signature still verifies.

### Added
- **New `jti` (JWT ID) claim** on all newly-minted tokens (`secrets.token_urlsafe(16)`). Pre-3.3.5-29 tokens have no `jti`, so they can't be revoked individually -- they expire normally. New tokens are always revocable.
- **`backend/app/models/token_denylist.py`**: SQLAlchemy `TokenDenylist` model (jti primary key, `expires_at`, `revoked_at`). Auto-created at startup via `Base.metadata.create_all` -- no Alembic migration needed.
- **`backend/app/middleware/auth_local.py`** gains `verify_token_async()` (sync verify + denylist check), `revoke_token()` (decode + insert), and `prune_expired_tokens()` (cleanup of rows past their original JWT expiry, run at startup).
- **Auth middleware** (`backend/app/middleware/auth_local.py:LocalAuthBackend.authenticate`) now uses `verify_token_async`, so denylist hits reject the request with 401.

### Notes
- Cost is one PK lookup per authenticated request -- the denylist table is small (entries past their original JWT expiry are pruned at startup) and a SQLite indexed lookup is sub-millisecond. No measurable latency impact.
- DB-error fail-safe: if the denylist lookup itself errors, the request is rejected (treat-as-revoked). Better to fail closed than to let a hiccup let revoked tokens through.

## [3.3.5-28] - 2026-04-24

### Security
- **LDAP bind password is now encrypted at rest** (audit finding HIGH-6). The `LDAPConfig.bind_password` column had a comment claiming "Encrypted at rest" since 2.0 but was actually storing plaintext. The audit found this discrepancy. Now it's actually encrypted, using Fernet (AES-128-CBC + HMAC-SHA256) with a key derived from the existing `OPENVOX_GUI_SECRET_KEY` via SHA-256.

### Added
- New `backend/app/services/secrets.py` module with `encrypt_secret()` / `decrypt_secret()` / `is_encrypted()` helpers. Versioned ciphertext (`enc:v1:<token>`) so plaintext / encrypted values can coexist in the same column during migration -- legacy plaintext is returned unchanged on read and gets re-encrypted on the next save through the LDAP config form.
- Encryption is invoked on save in `backend/app/routers/auth.py:update_ldap_configuration` (preserves the "blank password = keep existing" UI semantic by not double-wrapping when the form left the field empty).
- Decryption happens at bind time in `backend/app/middleware/auth_ldap.py:authenticate_user`. Decrypt failures (wrong key, tampered ciphertext) fail soft -- log a warning and treat as no-password rather than crashing the request.

### Notes
- Operators using LDAP today: existing plaintext bind passwords keep working unchanged. The next time you save the LDAP configuration form (or re-test the connection) the password is encrypted.
- Rotating `OPENVOX_GUI_SECRET_KEY` invalidates the encrypted bind password (and all JWTs) -- same operational tradeoff the JWT subsystem already accepts.
- The `cryptography` library was already an indirect dependency; no new package install required.

## [3.3.5-27] - 2026-04-24

### Security
- **`/api/deploy/webhook` now requires HMAC-SHA256 signature verification** (audit finding CRIT-3). Previously the endpoint accepted unauthenticated POSTs from anywhere, with a docstring suggesting the operator add an IP filter themselves -- effectively an open r10k-deploy-as-root entrypoint for any scanner that found it. Now:
  - When `OPENVOX_GUI_DEPLOY_WEBHOOK_SECRET` is unset / empty in `.env`, every webhook call returns **503 Disabled** (fail-closed default). The webhook simply doesn't work until the operator opts in.
  - When the secret IS set, every request must carry a valid `X-Hub-Signature-256: sha256=<hex>` header (HMAC-SHA256 of the raw body keyed by the shared secret). Mismatched signatures return **401**. `hmac.compare_digest` is used to avoid timing attacks.
- **r10k `ref` (branch) field strictly validated** before being passed as a subprocess argument (audit finding CRIT-3 secondary). Default pattern `^[a-zA-Z0-9._/-]{1,200}$` allows everything git itself accepts in a branch name and rejects anything with whitespace, shell metacharacters, or path-traversal sequences. Pattern is configurable via `OPENVOX_GUI_DEPLOY_WEBHOOK_REF_PATTERN`.

### Added
- New settings: `deploy_webhook_secret` (default `""`) and `deploy_webhook_ref_pattern` (default `^[a-zA-Z0-9._/-]{1,200}$`) in `backend/app/config.py`. Both read from environment variables prefixed `OPENVOX_GUI_DEPLOY_WEBHOOK_*`.

### BREAKING
- **Existing webhook deployments will return 503 until the secret is configured.** Anyone with a GitHub webhook currently pointed at `/api/deploy/webhook` needs to:
  1. Generate a strong shared secret (e.g. `openssl rand -hex 32`).
  2. Add `OPENVOX_GUI_DEPLOY_WEBHOOK_SECRET=<that-secret>` to `/opt/openvox-gui/config/.env`.
  3. Restart openvox-gui (`sudo systemctl restart openvox-gui`).
  4. In the GitHub webhook settings, set the `Secret` field to the same string.
- This is intentional. Falling back to "open" by default would defeat the security fix; operators who have already configured a webhook need to take one explicit action to keep it working.

## [3.3.5-26] - 2026-04-24

### Security
- **Per-route role enforcement on every destructive endpoint** (audit findings CRIT-1, CRIT-2, CRIT-4, HIGH-5, HIGH-10). The `AuthMiddleware` was correctly verifying JWTs at the gateway, but a large fraction of mutating endpoints declared only `Depends(get_current_user)` -- meaning *any* authenticated user (including viewer-role and auto-provisioned LDAP accounts) could trigger them. Now every mutating endpoint requires `admin` or `admin/operator` via `require_role(...)`.
- **`bolt.py`** -- all six `/run/*` and `/file/*` endpoints (`run_command`, `run_task`, `run_plan`, `upload_file_to_targets`, `download_file_from_targets`, `run_script_on_targets`) now require **admin or operator**. `PUT /config` (rewrites `bolt-project.yaml` / `inventory.yaml`) requires **admin only**. `POST /inventory/sync` requires **admin or operator**.
- **`certificates.py`** -- `sign`, `revoke`, `clean` now require **admin or operator**. Read endpoints (`list`, `info/{certname}`, `info`) remain accessible to all authenticated users.
- **`config.py`** -- all 13 mutating endpoints (puppet.conf, hiera, ssl, .env, restart-puppet-stack, services/restart, files/read, files/save, lookup, app, ssl, preferences, hiera data CRUD) require **admin only**. These edit cluster-wide configuration and call `puppet lookup` as root via sudo; not operator-level work.
- **`enc.py`** -- all 10 mutating endpoints (common/save, environments CRUD, groups CRUD, nodes CRUD) require **admin or operator**.
- **`pql.py`** -- `POST /query` requires **admin or operator**. PQL queries against PuppetDB can leak Hiera-rendered passwords / API keys / network topology via fact queries; restricting to operator+ keeps viewers from exfiltrating fleet-wide secrets.
- **Pattern**: a small number of routers define a module-level `_ADMIN_ONLY = require_role("admin")` or `_ENC_WRITE = require_role("admin", "operator")` constant and reuse it across every endpoint, both for brevity and so the role-policy contract is visible at the top of the file.

### Notes
- Frontend impact is minimal: the existing pages already gate destructive actions on `user.role` client-side (Sign / Reject buttons are already disabled for viewers on the Agent Install + Certificate Authority pages). The backend was the missing belt-and-suspenders.
- Read-only endpoints (`/list`, `/info`, `/status`, `/inventory`, `/tasks`, `/plans`, `/config` GET, dashboard, reports, nodes, facts) are unchanged -- still accept any authenticated user.

## [3.3.5-25] - 2026-04-24

### Fixed
- **`sync-openvox-repo.sh` lock-file race window closed** (audit BUG-2). The original `acquire_lock` wrote the lock file (`echo "$$" > "$LOCK_FILE"`) and THEN installed the cleanup trap. If the script was killed in between (e.g. SIGTERM from systemd-on-shutdown), the lock would survive and every subsequent sync would have to take the stale-lock cleanup branch. Trap is now installed BEFORE the lock write -- no race window.
- **Two bare `except:` clauses in `routers/certificates.py` `get_ca_info` narrowed to `except (ValueError, TypeError):`** (audit BUG-4). Bare `except:` swallows `KeyboardInterrupt` and `asyncio.CancelledError`, which can mask real failures. The narrowed exception list catches only the date-parse failures we actually expect.
- **Three blocking `subprocess.run` calls in `async` certificates handlers wrapped in `asyncio.to_thread`** (audit BUG-3). The original code called sync `subprocess.run(..., timeout=10)` directly inside `async def` handlers (`get_ca_info` x2, `certificate_info` x1), which blocks the entire uvicorn event loop for up to 10 s per request -- under any load the GUI would freeze for everyone every time someone opened the Certificate Authority page or clicked a cert detail. `asyncio.to_thread` runs the subprocess in the default thread pool so other requests stay responsive.

## [3.3.5-24] - 2026-04-24

### Fixed
- **`install.bash` no longer uses `--insecure` / `Verify-Peer=false` / `sslverify=0` after a successful CA install** (3.3.5-21 audit BUG-5). The CA install added in 3.3.5-18 made it possible to verify the puppetserver cert properly via the system trust store -- but the apt + yum repo setup paths kept passing the band-aid flags unconditionally, undermining the trust install.
- Now: install.bash tracks the CA-install outcome in `CA_TRUSTED`. When true, the keyring fetch drops `--insecure`, `apt-get update`/`install` drop `Acquire::https::Verify-Peer=false`, and the yum repo file uses `sslverify=1`. When false (CA endpoint unreachable, `update-ca-certificates` missing, etc.), the band-aids stay in place so the install still completes -- just with the documented loss of trust verification.
- Net effect: on a host where the CA install succeeded, the install-time TLS posture matches the post-install TLS posture (both verify against the same trust store). No more silent skip of cert verification on the install fetch.

## [3.3.5-23] - 2026-04-24

### Fixed
- **`install.ps1` placeholder check was clobbering its own substituted value** -- same self-inflicted wound that hit `install.bash` on production in 3.3.5-13 and was fixed there in 3.3.5-14, but the parallel fix never propagated to the Windows path. The line `if ($Server -like '*__OPENVOX_PUPPET_SERVER__*') { $Server = '' }` had the literal placeholder, which the server-side `sed` render replaces along with everything else -- leaving `if ($Server -like '*openvox.questy.org*') { $Server = '' }` after render, which always matched the real FQDN and wiped it. Fix: build the marker via PowerShell concatenation `'__OPENVOX' + '_PUPPET_SERVER__'` so the literal sequence never appears as a single token in the source -- `sed` matches on text, with the literal split it leaves it alone. Verified by simulating a render and confirming both that the substituted FQDN reaches `$Server` and that the marker variable contains the placeholder string at runtime.

### Added
- **`install.ps1` now installs the puppet CA into the Windows system trust store** at install time, mirroring the Linux behavior added in 3.3.5-18. New `Install-PuppetCaCert` function fetches `https://<server>:8140/puppet-ca/v1/certificate/ca` (using `ServerCertificateValidationCallback={$true}` for the chicken-and-egg fetch), validates the response, then imports it into `Cert:\LocalMachine\Root` via `Import-Certificate`. After this, subsequent HTTPS requests to the puppetserver from the Windows host (PowerShell `Invoke-WebRequest`, browser, future puppet-agent invocations) work without disabling cert verification. Failure is non-fatal -- the bootstrap download already used a callback and the MSI install path doesn't depend on system-trust verification.

## [3.3.5-22] - 2026-04-24

### Removed
- **Dead-code cleanup batch from the 3.3.5-21 audit findings.** Eight items, all behavior-preserving:
  - `frontend/src/components/AppShell.tsx`: removed unused imports (`Divider`, `IconAppWindow`) and unused locals (`sectionLabelColor`, `anyChildActive`, `anyActive`) -- left over from the Infrastructure-promotion + nav rename in 3.3.5-8 / 3.3.5-10.
  - `frontend/src/pages/Certificates.tsx`: removed unused `Progress` and `Box` imports -- left over from the Pending Requests removal in 3.3.5-20.
  - `backend/app/routers/certificates.py`: removed `_parse_cert_list` helper (38 lines, never called -- the actual parser is inlined in `list_certificates`). Comment crumb left in its place explaining the move.
  - `backend/app/routers/installer.py`: removed `SUPPORTED_LINUX_FAMILIES` constant (defined, never referenced; frontend renders platform labels from `info.platforms` instead).
  - `backend/app/routers/installer.py`: removed dead `__OPENVOX_PKG_REPO_URL__` substitution from `_render_template`. The placeholder was retired in 3.3.5-5 when install.bash/install.ps1 started deriving the repo URL from the FQDN at runtime; the substitution was kept as a "defensive bridge" but had no template referencing it. Docstring updated to record when and why.
  - `install.sh`: removed `FRONTEND_BUILT` variable (set in two places, never read; the next block checks the `frontend/dist` directory directly).
  - `scripts/deploy.sh`: corrected step-numbering display from `[1/5]..[5/6]..[6/6]` to `[1/6]..[6/6]`. The early echoes had the wrong denominator left over from when the agent installer step (Step 5) was added in 3.3.5-1.
  - `packages/install.ps1`: corrected stale comment referring to "ManagePuppetService call below" -- the actual function name is `Set-PuppetService` (cosmetic typo from the PE installer it was modelled on).

### Notes
- Pure cleanup release; no behavior change. Build + TS check + Python AST + shellcheck all clean.
- These are 8 of the items flagged during an internal review pass; further follow-up items are tracked separately.

## [3.3.5-21] - 2026-04-23

### Documentation
- **End-to-end documentation refresh** to bring every operator-facing doc in line with the actual current behavior after twenty 3.3.5-x iterations. No code changes -- pure docs.
  - **`docs/INSTALLER.md`** -- the canonical feature reference. Major rewrites:
    - Updated "How the install one-liners work" section: bare `curl -k --noproxy <fqdn> ...` form (was `bash -s -- --server`); 4-step resolution chain documented (added `/proc/net/tcp` discovery as path 2); the `--noproxy`, `-k`, and "no script args needed" rationale spelled out; CA install + `no_proxy` export listed as steps in the install flow.
    - "The Agent Install page" section rewritten for the new layout: one tabbed Install Commands card (Linux | Windows | Direct URLs | Mirror Status | Sync Log) + a Pending Certificate Requests card. Old "three sections" description replaced.
    - New troubleshooting entries: `CONNECT tunnel failed, response 407`, `Certificate verification failed: The certificate is NOT trusted`, `404 Not Found` on a specific dist's `Packages` index. Existing entries updated to match the current resolution chain.
    - Security considerations section rewritten to reflect the CA install + proxy bypass mechanisms; old `[trusted=yes]` framing replaced.
    - "Sync runs but takes hours" entry updated to use current `yum,apt` platform names instead of the legacy `redhat,debian,ubuntu`.
  - **`README.md`** -- "What's New in the 3.3.5-x series" updated:
    - Bare one-liner form described accurately.
    - Per-iteration history list expanded to cover 3.3.5-9 through 3.3.5-21.
    - Self-configuring agent scripts description updated to mention the 4-step resolution chain (added `/proc/net/tcp` + reverse DNS) and the CA install.
  - **`INSTALL.md`** -- prompt #7 description updated: bare one-liner form + new bullet about automatic CA-trust install on agents (3.3.5-18+).
  - **`UPDATE.md`** -- "Special note for upgrades" updated: describes the new tabbed Install Commands card + Pending Certificate Requests card layout, and shows the bare one-liner as the published form.
  - **`TROUBLESHOOTING.md`** -- three new entries (407 proxy, cert-not-trusted, mirror-not-synced 404), one updated entry (`bash: --server: invalid option` now references the bare GUI one-liner). Existing entries adjusted to current behavior.
  - **`docs/SUDOERS.md`** -- added the missing sync-trigger sudoers rule (`puppet ALL=(root) NOPASSWD: /opt/openvox-gui/scripts/sync-openvox-repo.sh*`) that install.sh has been writing since 3.3.5-1 but the doc didn't mention.

## [3.3.5-20] - 2026-04-23

### Changed
- **Reorganized the Infrastructure pages so the agent-bring-up workflow lives in one place.** Two moves:
  1. **Pending Certificate Requests moved from Certificate Authority to Agent Install.** Agent install + CSR signing are two halves of the same workflow (install agent → agent submits CSR → operator signs here → first puppet run succeeds), so they now sit next to each other. Certificate Authority keeps everything else: CA info panel, signed-cert list (with revoke / clean / details), expiry warnings.
  2. **Mirror Status, Disk Space, and Sync Log are now tabs inside the Install Commands card** instead of three standalone cards taking up the lower half of the Agent Install page. Layout is now: header → one tabbed Install Commands card (Linux | Windows | Direct URLs | Mirror Status | Sync Log) → Pending Certificate Requests card. Less vertical real estate, clearer information architecture.
- **"Sync now" button moved into the Install Commands card header**, alongside the server FQDN and "Sync in progress" badge -- it's always visible regardless of which tab is active. After a manual sync, the page automatically switches to the Sync Log tab so the captured output is immediately visible.
- **CSR sign / reject** in the new Pending Certificate Requests card uses the same backend endpoints (`/api/certificates/sign`, `/api/certificates/clean`) as before; the move is purely UI. Same admin/operator role gating; viewers see the buttons disabled.

### Notes
- No backend changes -- pure frontend reorganization.
- Both the `/installer` route and the `/certificates` route stay where they are; existing bookmarks keep working.

## [3.3.5-19] - 2026-04-23

### Fixed
- **Bootstrap curl failed with `CONNECT tunnel failed, response 407` on hosts behind a corporate proxy.** The `no_proxy` export added in 3.3.5-17 fixes the proxy issue for apt/yum *inside* install.bash, but the `curl` that downloads install.bash itself runs *before* install.bash starts -- it inherits the host's `http_proxy` / `https_proxy` env vars and tries to tunnel through the corporate proxy to reach the puppetserver. The proxy then demands authentication the bare `curl` can't supply (HTTP 407).
- **Fix**: the GUI's published one-liners now bypass the proxy at the bootstrap level too:
  - **Linux**: `curl -k --noproxy <fqdn> https://...`. `--noproxy` takes a comma-separated list of hosts that should bypass any proxy; we pass the puppetserver FQDN.
  - **Windows**: `$wc.Proxy = $null;` between `New-Object System.Net.WebClient` and `DownloadFile`. PowerShell's `WebClient` inherits the system proxy unless explicitly disabled.
- Both updates are pure GUI-side rendering changes -- the on-disk install.bash and install.ps1 are unchanged. Operators get the new one-liners as soon as they refresh the Installer page.

## [3.3.5-18] - 2026-04-23

### Added
- **`install.bash` now installs the puppet CA into the agent's system trust store** at install time, so subsequent `apt-get update` / `dnf upgrade openvox-agent` / manual `curl` / browser visits to the puppetserver work normally without `--insecure` / `Verify-Peer=false` / `sslverify=0` band-aids. Mechanism: fetches the CA cert from `https://<server>:8140/puppet-ca/v1/certificate/ca` (using `--insecure` because we don't trust it yet), drops the resulting PEM into the OS-specific trust path, and runs the trust-refresh command:
  - **Debian/Ubuntu**: `/usr/local/share/ca-certificates/openvox-puppet-ca.crt` + `update-ca-certificates`
  - **RHEL family**: `/etc/pki/ca-trust/source/anchors/openvox-puppet-ca.crt` + `update-ca-trust extract`
- Caught when an Ubuntu 24.04 agent install completed successfully but a follow-up `apt-get update` (without our `Verify-Peer=false` flag) failed with "certificate is NOT trusted, the certificate issuer is unknown". Without the CA in the trust store, post-install package management broke.

### Notes
- The install-time band-aids (`Acquire::https::Verify-Peer=false`, `sslverify=0`, `--insecure` for the keyring fetch) are kept as fallbacks for the rare case where the CA install itself fails (e.g., the puppetserver's CA endpoint isn't reachable, or `update-ca-certificates` isn't on the path). Both paths cover the same failure mode -- belt-and-suspenders.
- The CA install is platform-aware. macOS, SUSE, Solaris, AIX etc. would need their own trust-path branches; not added now since none of those are in the supported-agent list yet.

## [3.3.5-17] - 2026-04-23

### Fixed
- **Agent install was failing in environments with a corporate proxy.** Apt and yum honour `http_proxy` / `https_proxy` env vars and route ALL HTTPS requests through the configured proxy -- including the localhost-LAN request to the openvox-gui server. The proxy then either demanded authentication the agent didn't have, or did TLS interception that defeated `Verify-Peer=false`/`sslverify=0` (because the cert chain was now the proxy's MITM cert, not the puppetserver's). Fix: `install.bash` now exports `no_proxy` and `NO_PROXY` with the puppetserver FQDN (and the standard localhost entries) appended, preserving any pre-existing `no_proxy` value. Both apt-get and dnf honour these env vars and bypass the proxy for the puppetserver, going direct to the local mirror.

### Notes
- **Re: cert trust** -- the puppetserver presents a cert signed by Puppet's internal CA, which the agent doesn't trust until the puppet-agent package's first run does `puppet ssl bootstrap`. For the install fetch we sidestep this with `--insecure` curl (keyring fetch), `Acquire::https::Verify-Peer=false` (apt), and `sslverify=0` (yum) -- all already in place. With the no_proxy fix above, the request now goes direct to openvox-gui where these per-invocation flags actually take effect.
- **Architecture note** -- Puppet Enterprise's installer takes a different approach: it downloads a single tarball of agent packages directly from the master (no yum/apt repo involved), which sidesteps both the proxy and the repo-cert issues entirely. Our approach (mirror upstream voxpupuli + add a local repo file) gives users a working `dnf upgrade openvox-agent` after install, but introduces the proxy/cert complexity. If the no_proxy approach hits more edge cases, switching to PE's tarball-direct approach is on the table.

## [3.3.5-16] - 2026-04-23

### Fixed
- **`install.bash` was calling an undefined `warn` function.** Caught when an Ubuntu 24.04 agent install made it past discovery and platform detection, started configuring the apt repo, and then died at `main: line 496: warn: command not found` -- the apt-keyring-fetch fallback path tried to log a non-fatal warning but `warn()` had never been defined alongside `fail()`/`info()`/`cmd()` in the helpers block. The `set -e` at the top of the script then killed the run because `warn` returned non-zero. Added the trivial helper:
  ```bash
  warn() { echo >&2 "openvox-install: WARN: $*"; }
  ```

## [3.3.5-15] - 2026-04-23

### Security
- **Cleared 3 high-severity npm audit findings** in the frontend dependency tree:
  - `vite` 6.4.1 -> 6.4.2 -- CVE-2025-... Path Traversal in Optimized Deps `.map` handling ([GHSA-4w7w-66w2-5vf9](https://github.com/advisories/GHSA-4w7w-66w2-5vf9)) and Arbitrary File Read via Vite Dev Server WebSocket ([GHSA-p9ff-h696-f583](https://github.com/advisories/GHSA-p9ff-h696-f583)). Both CVEs only affect `vite serve` (the dev server), not `vite build` (production), so the real-world risk to the deployed openvox-gui was effectively zero. Patched anyway.
  - `lodash` -> 4.18.1 -- Code Injection via `_.template` imports key names ([GHSA-r5fr-rjxr-66jc](https://github.com/advisories/GHSA-r5fr-rjxr-66jc)) and Prototype Pollution via array-path bypass in `_.unset` and `_.omit` ([GHSA-f23m-r3pf-42rh](https://github.com/advisories/GHSA-f23m-r3pf-42rh)). Transitive dep.
  - `picomatch` -> 4.0.4 -- Method Injection in POSIX Character Classes ([GHSA-3v7f-55p6-f55p](https://github.com/advisories/GHSA-3v7f-55p6-f55p)) and ReDoS via extglob quantifiers ([GHSA-c2c7-rcm5-vvqj](https://github.com/advisories/GHSA-c2c7-rcm5-vvqj)). Transitive dep.
- All three were patched non-breaking inside their existing major versions (`npm audit fix` only). No `package.json` manifest changes needed -- the existing `^6.4.1` constraint resolves to 6.4.2 automatically. Production build verified clean.

## [3.3.5-14] - 2026-04-23

### Fixed
- **install.bash placeholder check was clobbering its own substituted value.** Self-inflicted wound discovered on production: the line
  ```bash
  if [[ "$PUPPET_SERVER" == *"__OPENVOX_PUPPET_SERVER__"* ]]; then PUPPET_SERVER=""; fi
  ```
  was meant to detect an UN-rendered placeholder and clear the var so the fallback paths could fire. But the server-side `sed` render replaces **every** literal `__OPENVOX_PUPPET_SERVER__` in the file -- including the literal in this check. After render, the check became `*"openvox.pdxc-it.twitter.biz"*` which always matches the substituted value, so PUPPET_SERVER was getting set to `openvox.pdxc-it.twitter.biz` and then immediately wiped to `""`. All four resolution paths then failed with the canonical "Could not determine the puppetserver FQDN" error -- on a host where the FQDN was *literally* the rendered value.
- **Fix**: build the placeholder-marker string at runtime via bash concatenation (`'__OPENVOX''_PUPPET_SERVER__'`) so the literal sequence `__OPENVOX_PUPPET_SERVER__` never appears in the source as a single token. `sed` matches on text in the file; with the literal split, the render leaves it alone. Same fix applied to the literal in the "all paths failed" error message text.
- **Caught by**: an actual install attempt on `eveng` against production where the error confessed itself ("openvox.pdxc-it.twitter.biz placeholder substituted by the openvox-gui server (not rendered)"). The mangled wording made the bug obvious in retrospect.

## [3.3.5-13] - 2026-04-23

### Changed
- **Linux one-liner trimmed to `curl -k <url> | sudo bash`** -- no `bash -s -- --server <fqdn>` suffix anymore. Now that 3.3.5-12 has the `/proc/net/tcp` discovery working, the script extracts the puppetserver FQDN from the URL the operator just typed; passing `--server` was redundant noise. The published one-liner is now identical in shape to Puppet Enterprise's.

## [3.3.5-12] - 2026-04-23

### Fixed
- **`/proc/net/tcp` discovery now matches the real kernel state.** Tested 3.3.5-11's discovery on questy.org and it fell through to the puppet.conf fallback instead of finding the connection. Root cause: I limited the state filter to `01` (ESTABLISHED) and `06` (TIME_WAIT), but on RHEL 9 the actual /proc/net/tcp entry was state `08` (CLOSE_WAIT) -- curl had already done its half-close. Changed the filter to accept any state EXCEPT `0A` (LISTEN, which is server-side); discovery now picks up the connection regardless of where it is in the teardown sequence (CLOSE_WAIT, FIN_WAIT1/2, LAST_ACK, etc.).

## [3.3.5-11] - 2026-04-23

### Added
- **`install.bash` now auto-discovers the puppetserver FQDN from the kernel's TCP state.** When an agent runs `curl -k https://server:8140/packages/install.bash | sudo bash`, the URL the operator typed IS the source of truth for the server -- and now the script uses it directly. Mechanism: even though curl exits before bash starts executing (proven empirically -- the script is ~17 KB, written to the pipe in microseconds and curl is gone), the kernel keeps the TCP connection in TIME_WAIT for ~60 seconds. install.bash reads the remote IP out of `/proc/net/tcp`, reverse-DNSes it, and uses the resulting FQDN. No `--server` flag needed; no dependency on the server-side render of `__OPENVOX_PUPPET_SERVER__`.

### Changed
- **install.bash resolution chain reordered**: (1) `--server` arg / env var, (2) `/proc/net/tcp` + reverse DNS (NEW, the user's original design intent), (3) server-side rendered placeholder (belt-and-suspenders), (4) existing `puppet.conf`. The `--server` flag in the GUI's published one-liner is now redundant in the common case but kept as belt-and-suspenders for hosts where reverse DNS doesn't return a usable name.
- **"All resolution paths failed" error message** updated to name the new path 2.

## [3.3.5-10] - 2026-04-23

### Changed
- **Nav item renamed: "Installer" -> "Agent Install"** under Infrastructure. The previous label was ambiguous (could be misread as "openvox-gui installer"); "Agent Install" matches the actual purpose -- bootstrapping OpenVox agents on remote hosts. Route (`/installer`), feature name ("OpenVox Agent Installer"), and underlying source files (`Installer.tsx`, `installer.py`) are unchanged so existing bookmarks, code references, and the historical CHANGELOG keep working. Doc references to the menu path ("Infrastructure -> Installer") in README, UPDATE, INSTALLER, TROUBLESHOOTING, and the install/update shell scripts updated to match. Older CHANGELOG entries preserved as-is for historical accuracy.

## [3.3.5-9] - 2026-04-23

### Documentation
- **Cumulative documentation refresh** to reflect the current state of the project after eight 3.3.5-x iterations. No code changes -- pure docs.
  - `README.md` "What's New" consolidated. Each iteration is no longer a separate fix paragraph -- the headline OpenVox Agent Installer feature now reads as a single cumulative description, with the per-iteration fix history pointed at the CHANGELOG.
  - `docs/INSTALLER.md` rewritten to match the actual current behavior: one-liners now show `bash -s -- --server <fqdn>`, resolution chain documented, troubleshooting section gained entries for the real-world failures we hit (puppetserver-not-restarted 378-byte HTML, `bash: --server: invalid option`, "Could not determine the puppetserver FQDN" error, partial-mirror 404s).
  - `INSTALL.md` now documents the new `CONFIGURE_PKG_REPO` and `RUN_INITIAL_SYNC` interactive prompts, and shows the 11-step installer progress (was 10).
  - `TROUBLESHOOTING.md` gained a dedicated "Agent Installer Problems" section with the most common gotchas + pointers into INSTALLER.md.

## [3.3.5-8] - 2026-04-23

### Changed
- **Navigation: Infrastructure promoted to a top-level nav group.** Was previously a nested sub-group inside Monitoring (Monitoring -> Infrastructure -> {Certificate Authority, Orchestration, Installer}). Now sits parallel to Monitoring at the top level. Final left-nav order: Monitoring, Infrastructure, Code, Data, Information, Settings. Same routes, same pages -- only the grouping changed.

## [3.3.5-7] - 2026-04-23

### Changed
- **Linux one-liner now passes `--server <fqdn>` explicitly**, so whatever hostname the operator points curl at is the same hostname the agent ends up configured to talk to. The GUI extracts the FQDN from its own configured puppetserver name when generating the copy-to-clipboard command, so the operator never has to type it twice. Mirrors the Windows trick of extracting `Host` from the download URL via `[System.Uri]$url.Host`. Eliminates any dependency on `__OPENVOX_PUPPET_SERVER__` being substituted server-side -- the script gets the FQDN directly from the one-liner.

### Removed
- **Failed `/proc`-based curl-pipe discovery experiment** (introduced and never shipped). The plan was to have install.bash walk `/proc` looking for a sibling curl process and read the URL out of its argv. Verified empirically on RHEL 9 that this race is unwinnable: by the time bash starts executing the script, curl has already finished writing the entire ~17 KB of installer to the pipe and exited. /proc no longer has any record of it. The dead code is gone; comments at the top of install.bash explain why we don't try this.

### Notes
- Resolution order in install.bash is now: (1) `--server` CLI arg / `PUPPET_SERVER` env var, (2) `__OPENVOX_PUPPET_SERVER__` placeholder substituted server-side, (3) `[main] server=` from existing puppet.conf. With the new one-liner, path (1) is always populated for fresh installs, so paths (2) and (3) are belt-and-suspenders.

## [3.3.5-6] - 2026-04-23

### Fixed
- **Installer page one-liner now uses `bash -s --`** so operators can append `--server`/`--version`/`<section>:<key>=<value>` arguments without bash mis-parsing them as its own options. The bare `| sudo bash` worked fine for argument-less invocations, but anyone who tried `| sudo bash --server foo` got `bash: --server: invalid option` because `--server` was treated as a bash option, not a script arg. The new form works identically when no extra args are passed AND lets `bash -s -- --server foo` work as expected. Mirrors PE's published one-liner. Backend `linux_command` field on `/api/installer/info` updated.

## [3.3.5-5] - 2026-04-23

### Fixed
- **Agent installer no longer fails when the server-side render didn't run.** The previous design hard-required two placeholders (`__OPENVOX_PKG_REPO_URL__` and `__OPENVOX_PUPPET_SERVER__`) to be substituted on the openvox-gui server before serving install.bash/install.ps1. If the render didn't run -- as happened in the field on production -- the agent script failed with a misleading "PKG_REPO_URL is not set. Either run this script via the openvox-gui or set PKG_REPO_URL in the environment", which falsely implied the agent host needed to run the GUI.

### Changed
- **`install.bash` and `install.ps1` are now self-configuring** at agent runtime. Resolution order for the puppetserver FQDN:
  1. `--server <fqdn>` CLI argument (or `-Server` on Windows)
  2. `PUPPET_SERVER` environment variable
  3. The `__OPENVOX_PUPPET_SERVER__` placeholder substituted at server-side render time (still the normal "happy path" for `curl ... | sudo bash`)
  4. **NEW** -- `[main] server=` line read out of `/etc/puppetlabs/puppet/puppet.conf` (or `C:\ProgramData\PuppetLabs\puppet\etc\puppet.conf`) when an agent is being re-installed on a host that's already configured.
- **`PKG_REPO_URL` is no longer a separate placeholder.** It's *derived* from the puppetserver FQDN as `https://<server>:8140/packages` unless explicitly overridden via the new `--pkg-repo-url` flag (Linux) or `-PkgRepoUrl` parameter (Windows). One less thing to break in the render pipeline.
- **OPENVOX_VERSION default no longer clobbers env var.** The pre-arg-parsing seed of `OPENVOX_VERSION="$DEFAULT_OPENVOX_VERSION"` previously meant `OPENVOX_VERSION=7 bash install.bash` was silently ignored. Removed; resolution now happens after arg parsing via `${OPENVOX_VERSION:-$DEFAULT_OPENVOX_VERSION}`.
- **install.sh + deploy.sh + update_local.sh** drop the dead `__OPENVOX_PKG_REPO_URL__` sed substitution. Only the puppetserver FQDN and the default OpenVox major version are rendered server-side now.

### Notes
- **Failure mode on misconfigured servers is now actionable.** When the server fails to render AND the agent has no existing puppet.conf AND `--server` is not passed, the script dies with a clear error that names both the underlying fix (run `update_local.sh --force` on the openvox-gui server) and a one-shot workaround (re-run with `--server <fqdn>`).

## [3.3.5-4] - 2026-04-23

### Added
- **Interactive "Sync now?" prompt during `update_local.sh`**: Existing installations that get the agent installer feature for the first time on upgrade are now offered a one-shot prompt to populate the local mirror immediately, instead of having to wait for the 02:30 systemd timer. The prompt is skipped in `--auto`, `--security`, and `--force` modes (cron / unattended security updates) so nightly auto-runs aren't surprised by a multi-GB download. Detects an empty mirror by looking for openvox{7,8} subtrees under `${PKG_REPO_DIR}/{yum,apt,windows,mac}`.

### Notes
- **Heads-up about first-run sync time** for any operator upgrading to a 3.3.5-x release: this release introduces the new agent installer feature and a local OpenVox package mirror under `/opt/openvox-pkgs/`. The first sync downloads roughly **1-2 GB** from yum.voxpupuli.org / apt.voxpupuli.org / downloads.voxpupuli.org and can take **15-45 minutes** on a typical broadband connection. Subsequent syncs are incremental (only changed/new files), and a systemd timer keeps the mirror current overnight at 02:30 with a randomised delay. Operators can pick whichever first-sync path fits their workflow:
  - The interactive `update_local.sh` prompt (new in 3.3.5-4)
  - The "Sync now" button on Infrastructure -> Installer in the GUI
  - `sudo systemctl start openvox-repo-sync.service` from the CLI
  - Just wait for the 02:30 nightly timer

## [3.3.5-3] - 2026-04-23

### Fixed
- **sync-openvox-repo.sh wget double-nesting**: Discovered during the live trial sync against openvox.questy.org that wget was producing nested paths like `/opt/openvox-pkgs/yum/openvox8/el/9/x86_64/openvox8/el/9/x86_64/openvox-agent-*.rpm` because `--no-host-directories` strips only the hostname (the URL path is preserved under `--directory-prefix`). Each `sync_*` function now passes the mirror **root** (e.g. `/opt/openvox-pkgs/yum`) as the wget destination and lets the URL path determine the subdirectory layout. Validated by re-running the trial: 42 RPMs landed at the correct path before the test was aborted.

## [3.3.5-2] - 2026-04-23

### Fixed
- **Installer URL patterns matched to live voxpupuli.org**: Validated `sync-openvox-repo.sh`, `install.bash`, and `install.ps1` against the actual upstream layouts at yum.voxpupuli.org / apt.voxpupuli.org / downloads.voxpupuli.org and corrected several mismatches that would have caused 404s on the first sync:
  - **yum**: directory layout is `openvox{N}/el/{R}/{arch}/` not `openvox{N}/el-{R}/{arch}/` (slash, not hyphen). Also gained support for amazon, fedora, redhatfips, sles families (yum tree includes them but only `el` is mirrored by default).
  - **apt**: structure is one shared tree with `dists/{numeric}/openvox{N}/binary-{arch}/` and `pool/openvox{N}/o/{component}/`, NOT per-openvox-version dist trees. Distros use **numeric** names (`debian12`, `ubuntu24.04`) not codenames (`bookworm`, `noble`). Sources line is now `deb <base>/apt/ debian12 openvox8` etc.
  - **Windows MSIs**: actual path is `windows/openvox{N}/openvox-agent-{ver}-x64.msi`, with the version embedded in the filename. sync now downloads all versions and creates a real-copy `openvox-agent-x64.msi` at a stable URL for install.ps1 (puppetserver mount does not follow symlinks -- verified empirically).
  - **macOS DMGs**: actual path is `mac/openvox{N}/[<macos-major>/]openvox-agent-{ver}-1.macos.all.{arch}.dmg`. Same "latest copy" trick applied per arch.
- **GPG key handling**: install.bash now sets `gpgcheck=1` and points to the keyring served from the local mirror (`/yum/GPG-KEY-openvox.pub`), and install.bash's apt path tries to install `openvox-keyring.gpg` to `/etc/apt/trusted.gpg.d/` before falling back to `[trusted=yes]`.

### Changed
- **Mirror layout under `/opt/openvox-pkgs/`**: replaced per-OS-family dirs (`redhat/`, `debian/`, `ubuntu/`) with per-upstream-source dirs (`yum/`, `apt/`). The apt tree is now a single shared mirror that serves both Debian and Ubuntu (matching upstream). The deploy scripts remove the empty old dirs automatically.
- **Default OS releases trimmed to "latest two"**: EL=8,9; Debian=12,13; Ubuntu=22.04,24.04. Override via `--el-releases` / `--debian-releases` / `--ubuntu-releases` (numeric for apt -- not codenames).
- **Installer page breakdown labels updated**: shows `yum (RHEL family)` and `apt (Debian + Ubuntu)` rather than separate redhat/debian/ubuntu rows so the GUI matches the underlying mirror layout.
- **`docs/INSTALLER.md`**: full rewrite of the mirror layout section with the validated upstream paths and corrected disk-size estimates.

### Notes
- Old `--platforms redhat|debian|ubuntu` flags still work in `sync-openvox-repo.sh` (they emit a deprecation warning and are translated to `yum|apt`) so any custom cron entries don't break.
- Test build for openvox.questy.org -- subsumed into 3.4.0 once issues are shaken out.

## [3.3.5-1] - 2026-04-23

### Added
- **OpenVox Agent Installer (PE-style bootstrap)**: New end-to-end feature for installing OpenVox agents from a single command, modelled on Puppet Enterprise's `install agents` workflow.
  - **Local package mirror** at `/opt/openvox-pkgs/` populated from `yum.voxpupuli.org`, `apt.voxpupuli.org`, and `downloads.voxpupuli.org`. Subdirectories: `redhat/`, `debian/`, `ubuntu/`, `windows/`, `mac/`. New `scripts/sync-openvox-repo.sh` does the mirroring via `wget --mirror`. Lock file prevents concurrent syncs (cron + manual button collisions).
  - **Nightly sync** via new `openvox-repo-sync.{service,timer}` systemd units (02:30 + randomized delay). Operator can disable via `ENABLE_REPO_SYNC_TIMER=false` in `install.conf`.
  - **PuppetServer static-content mount** at `/packages/*` on port 8140 -- new `config/openvox-pkgs-webserver.conf` HOCON drop-in for `/etc/puppetlabs/puppetserver/conf.d/`. Reuses port 8140 so existing firewall rules already permit agent traffic.
  - **Linux agent installer** (`packages/install.bash`) -- detects platform (RHEL family / Debian / Ubuntu, version, architecture), drops a yum/apt repo file pointing at the local mirror, installs `openvox-agent`, configures `puppet.conf`, and starts the service. Supports the same `<section>:<setting>=<value>` directive syntax as PE's installer.
  - **Windows agent installer** (`packages/install.ps1`) -- downloads `openvox-agent-{x64,x86}.msi` from the mirror, runs `msiexec`, configures `puppet.conf`, manages the service. PowerShell parameters mirror PE's `-PuppetAgentAccountUser`, `-EnableLongPaths`, etc.
  - **Backend router** (`backend/app/routers/installer.py`) -- new `/api/installer/{info,sync,log,diskinfo,files,script/*}` endpoints. `/api/installer/script/install.bash` and `/api/installer/script/install.ps1` are unauthenticated (agents have no JWT) and dynamically render the templates with current `puppet_server_host`. `/api/installer/sync` requires admin or operator role.
  - **FastAPI `/packages/*` mount** -- the openvox-gui app also serves the mirror on its own port (4567 by default) as a fallback for environments where the puppetserver mount isn't configured.
  - **New "Installer" page** under Infrastructure (`/installer`). Headline feature: copy-to-clipboard one-liners for Linux and Windows, with a tabbed UI showing direct URLs as well. Mirror status panel surfaces last-sync time, total bytes, per-platform breakdown (RHEL / Debian / Ubuntu / Windows / Mac), disk usage with high-water-mark warning, sync log tail, and a "Sync now" button (admins/operators only).
  - **install.sh enhancements** -- new step 10 "Agent Package Mirror" creates `/opt/openvox-pkgs/`, renders install.bash/install.ps1 with the operator's chosen `PUPPET_SERVER_HOST`, installs the systemd timer, drops the puppetserver mount config, and (optionally) runs an initial sync. New `install.conf` variables: `CONFIGURE_PKG_REPO`, `PKG_REPO_DIR`, `INSTALL_PUPPETSERVER_MOUNT`, `ENABLE_REPO_SYNC_TIMER`, `RUN_INITIAL_SYNC`.
  - **Sudoers update** -- service user can now `sudo` the sync script via NOPASSWD rule for the GUI's "Sync now" button.
  - **Documentation** -- new `docs/INSTALLER.md` covers architecture, install, day-to-day operation, security considerations, and troubleshooting.

## [3.3.0] - 2026-04-14

### Added
- **Orchestration targets from PuppetDB**: Selecting "All nodes" in the Orchestration UI now queries PuppetDB for every known certname and passes them as explicit `--targets` to Bolt, instead of relying on the static `inventory.yaml`. Falls back gracefully if PuppetDB is unreachable.

### Fixed
- **Deploy health check SSL**: `update_local.sh` and `deploy.sh` always used `http://` for the post-restart `/health` check. When SSL is enabled, uvicorn only serves HTTPS, so the check silently failed every time — reporting "Service did not become healthy" even though the service was running. Both scripts now detect `OPENVOX_GUI_SSL_ENABLED` and use `https://` with `curl -k`.

### Changed
- **Dashboard status trends chart**: Green (unchanged) area now renders as a background field (higher fillOpacity, thinner stroke) with orange (changed), red (failed), and blue (noop) superimposed in the foreground with thicker strokes and higher opacity.

## [3.2.7] - 2026-04-07

### Fixed
- **ENC enc.py HTTPS + SSL context**: Fixed enc.py to properly handle HTTPS URLs with SSL context for PuppetDB connections.
- **install.sh uses HTTPS**: Installer now uses HTTPS for health check when SSL is enabled.

### Changed
- **Dashboard graph enhancements**: Improved dashboard trends visualization with node count tracking for active nodes. Replaced scatter plot with pie chart and added 2D/3D toggle. Fixed crash on null trends data.

## [3.2.6] - 2026-04-03

### Changed
- **SSL Configuration editable**: SSL Configuration page now allows editing certificate paths and SSL settings directly from the UI.

## [3.2.5] - 2026-04-01

### Changed
- **SSL Configuration as Settings tab**: Moved SSL Configuration from a standalone page to a tab inside Settings > Application Configuration. Updated documentation to reflect the new location.

## [3.2.4] - 2026-03-31

### Changed
- **SSL Configuration as Settings tab**: The SSL Configuration page is now a tab inside **Settings → Application Configuration**, positioned to the right of "Auth Settings". The separate Settings nav entry has been removed.
- **Documentation updated**: INSTALL.md, UPDATE.md now document the SSL prompt during install/update and the SSL Config tab location.

## [3.2.3] - 2026-03-31

### Added
- **update_local.sh SSL prompt**: During updates, if SSL is not enabled in `.env`, the script prompts: "Enable SSL using Puppet certs? [y/N]". Answering yes updates `.env` and adds `--ssl-certfile`/`--ssl-keyfile` to the systemd service.

### Changed
- **update_local.sh Step 2**: Auto-adds SSL flags to systemd if `.env` already has `OPENVOX_GUI_SSL_ENABLED=true`.

## [3.2.2] - 2026-03-30

### Added
- **Native SSL support on port 4567**: The GUI can now serve HTTPS directly via uvicorn using `--ssl-certfile` and `--ssl-keyfile` flags. Enable via installer prompt "Enable SSL on port 4567?" or set `OPENVOX_GUI_SSL_ENABLED=true` in `.env`. Defaults to Puppet certs at `/etc/puppetlabs/puppet/ssl/`. No architectural changes — frontend uses relative URLs, internal calls stay localhost.

### Changed
- **Install script prompts for SSL**: New interactive prompt asks whether to enable SSL on the GUI port, with optional custom cert/key paths. Answer file (`install.conf`) supports `SSL_ENABLED`, `SSL_CERT_PATH`, `SSL_KEY_PATH`.
- **Systemd service conditional SSL**: `ExecStart` now conditionally adds `--ssl-certfile`/`--ssl-keyfile` when `OPENVOX_GUI_SSL_ENABLED=true`.
- **Install output shows correct scheme**: Summary now prints `https://` when SSL enabled, `http://` otherwise.

## [3.2.1] - 2026-03-25

### Fixed
- **LDAP troubleshooting**: Added detailed logging of server URL, timeout, and Bind/User Base DN values. Improved error messages and hints for connection timeouts.
- **Proxy handling**: Expanded default `no_proxy` to cover common internal/corporate networks (including `.local` domains and 172.29.* ranges) to prevent proxies from interfering with direct LDAP connections.
- **User Base DN**: Clarified in docs that the base must exactly match the directory structure (e.g. including intermediate `dc=ods,...` components). Mismatches were a common cause of "ldapsearch works but app times out".
- **Version bump and docs**: Updated defaults, frontend, and troubleshooting documentation.

## [3.2.0] - 2026-03-24

### Added
- **Reports grouped by ENC node groups**: Reports page now organizes reports by ENC node groups. Each group header shows a status badge: green "Unchanged" (all nodes unchanged), orange "Changed" (any node changed), or red "Failed" (any node failed). Groups are expandable to show individual node reports.
- **Data navigation group**: New "Data" nav group under Code containing Hiera Data Files and Hiera Lookup (moved from OpenVox Configuration).
- **Comprehensive inline documentation**: All backend Python modules and frontend TypeScript components now have verbose inline comments and docstrings explaining functionality, security decisions, and design rationale.

### Changed
- **Navigation restructure**: Infrastructure nav group moved under Monitoring as an expandable submenu. Orchestration (previously top-level) is now nested under Infrastructure. Certificate Authority remains the first sub-item under Infrastructure. Navigation now supports nested items via recursive renderNavItem.
- **Code nav restructure**: Node Classifier moved from standalone nav group into Code as first submenu item. Deployment remains as second submenu item under Code.
- **Rename Node Classifier**: Nav label and page title changed from "Node Classifier" to "Classification".
- **Rename OpenVoxDB Explorer**: Nav label changed from "OpenVoxDB Explorer" to "Information". PQL Console, Fact Explorer, Resource Explorer, and Package Inventory remain as sub-items under Information.
- **Nav collapsed by default**: All left-column menu groups (Monitoring, Code, Information, Settings, etc.) now appear collapsed on initial page load. Users click to expand.
- **Settings submenu renamed**: "Settings" submenu under Settings main menu renamed to "Application Configuration".
- **Nav parent click behavior**: Clicking a nav group with children (e.g., Infrastructure, Data) now toggles expand/collapse without navigating. Users click child items to navigate, eliminating blanking between clicks.
- **CA info async**: Certificate Authority info endpoint (`/certificates/ca-info`) now uses async subprocess (`asyncio.create_subprocess_exec`) instead of blocking `subprocess.run`, eliminating event-loop blocking and speeding up Certificate Authority page load.
- **Certificate caching**: In-memory cache added for certificate list (30s TTL) and CA info (1h TTL). Cache for cert list is invalidated on sign/revoke/clean operations. This speeds up repeated Certificate Authority page loads.
- **Version 3.2.0 release**: Full release with all features from 3.1.1 beta series, comprehensive documentation, and inline code comments throughout.

### Fixed
- **Dashboard on login**: Fixed dashboard not loading properly on initial login.
- **Monitoring click**: Fixed navigation when clicking Monitoring in sidebar.
- **Reports badge logic**: Fixed badge grouping to use last 10 reports instead of 20.
- **Nodes page grouping**: Fixed nodes page to derive grouping from hierarchy.nodes like Reports page.

## [3.1.1-10_beta] - 2026-03-24

### Changed
- **Navigation restructure**: Infrastructure nav group moved under Monitoring as an expandable submenu. Orchestration (previously top-level) is now nested under Infrastructure. Certificate Authority remains the first sub-item under Infrastructure. Navigation now supports nested items via recursive renderNavItem.
- **Code nav restructure**: Node Classifier moved from standalone nav group into Code as first submenu item. Deployment remains as second submenu item under Code.
- **Rename Node Classifier**: Nav label and page title changed from "Node Classifier" to "Classification".
- **Rename OpenVoxDB Explorer**: Nav label changed from "OpenVoxDB Explorer" to "Information". PQL Console, Fact Explorer, Resource Explorer, and Package Inventory remain as sub-items under Information.
- **Nav collapsed by default**: All left-column menu groups (Monitoring, Code, Information, Settings, etc.) now appear collapsed on initial page load. Users click to expand.
- **Data menu added**: New "Data" nav group under Code containing Hiera Data Files and Hiera Lookup (moved from OpenVox Configuration).
- **Settings submenu renamed**: "Settings" submenu under Settings main menu renamed to "Application Configuration".
- **Reports grouped by node groups**: Reports page now organizes reports by ENC node groups. Each group header shows a status badge: green "Unchanged" (all nodes unchanged), orange "Changed" (any node changed), or red "Failed" (any node failed). Groups are expandable to show individual node reports.
- **Nav parent click behavior**: Clicking a nav group with children (e.g., Infrastructure, Data) now toggles expand/collapse without navigating. Users click child items to navigate, eliminating blanking between clicks.
- **CA info async**: Certificate Authority info endpoint (`/certificates/ca-info`) now uses async subprocess (`asyncio.create_subprocess_exec`) instead of blocking `subprocess.run`, eliminating event-loop blocking and speeding up Certificate Authority page load.
- **Certificate caching**: In-memory cache added for certificate list (30s TTL) and CA info (1h TTL). Cache for cert list is invalidated on sign/revoke/clean operations. This speeds up repeated Certificate Authority page loads.

## [2.3.2] - 2026-03-23

### Fixed
- **ProtectSystem=strict → true**: The `strict` filesystem lockdown was fundamentally incompatible with a service that orchestrates Puppet agent, Bolt, and r10k — tools that write to `/var/cache/dnf`, `/etc/puppetlabs/puppet/ssl`, `/opt/puppetlabs/puppet/public`, and many other system paths during normal operation. Changed to `ProtectSystem=true` which protects only `/usr` and `/boot` (OS binaries) while allowing management tools to function. The puppet user's Unix permissions and scoped sudoers rules provide the actual access control. This eliminates all "Read-only file system" errors in a single change, replacing the `ReadWritePaths` patchwork that was growing with every new writable path discovery.
- **Command validation regex blocked all Bolt commands**: An unescaped pipe character (`|`) in the netcat detection pattern (`r'|.*nc\s'`) caused the regex alternation operator to match the empty string — which matches every input. All commands submitted through Bolt (including "Run OpenVox") were rejected with "Command contains potentially dangerous patterns". Fixed to `r'\|.*nc\s'` to match a literal pipe.
- **r10k deploy from GUI**: Created `r10k-deploy.sh` wrapper script that reconstructs root's full login environment before running r10k. The wrapper sources `/etc/profile`, root's `.bash_profile` and `.bashrc`, and extracts git proxy settings from root's `.gitconfig`. This resolves the "Could not resolve host: github.com" error that occurred because `sudo`'s `env_reset` stripped environment variables needed for DNS resolution and proxy access.
- **Bolt config save 500 error**: Added `/etc/puppetlabs/bolt` to `ReadWritePaths` (and later absorbed by the `ProtectSystem=true` change) so the service can create and write `bolt-project.yaml` and `inventory.yaml`.
- **Update script creates required directories**: The update script now creates `/etc/puppetlabs/bolt` before deploying the service file, preventing systemd `NAMESPACE` failures (exit 226) when `ReadWritePaths` references a non-existent directory.

### Added
- **Run OpenVox output panel**: The Node Detail page now displays Bolt's stdout and stderr inline after clicking "Run OpenVox", with an exit code badge and scrollable output area. Previously, the result was captured but discarded — users only saw a toast notification with no way to diagnose failures.
- **Key Facts full display**: The Value column in the Key Facts tab now word-wraps naturally. Object values (os, networking, processors) render as pretty-printed JSON in a `Code` block instead of being truncated at 120 characters.
- **ENC groups in Orchestration targets**: The Run Command and Run Task target selectors now display ENC node groups alongside individual PuppetDB nodes, organized in labeled dropdown sections (📁 Groups, Nodes). Selecting a group name passes it to Bolt as the target.

### Changed
- **Update scripts deploy system configs**: `update_local.sh` now deploys the systemd service file (with `INSTALL_DIR` substitution) and regenerates the sudoers rules on every update, so fixes to permissions, `ReadWritePaths`, and sudo policies take effect without manual file editing.

## [2.3.1] - 2026-03-23

### Security
- **CVE-2025-54121** (Starlette, DoS via multipart parsing): Resolved by upgrading FastAPI from 0.115.5 to 0.135.1 which pulls Starlette 1.0.0.
- **CVE-2025-62727** (Starlette, DoS via HTTP Range headers): Resolved by the same FastAPI upgrade.
- **CVE-2024-23342** (ecdsa, Minerva timing side-channel attack enabling private key recovery): Eliminated entirely by replacing `python-jose[cryptography]` with `PyJWT[crypto]`. The `ecdsa` library was a transitive dependency of `python-jose` with no planned fix. `PyJWT` uses the `cryptography` library for all cryptographic operations, which is actively maintained and handles ECDSA securely.

### Changed
- **Major dependency upgrades**: FastAPI 0.115.5 → 0.135.1, Uvicorn 0.32.1 → 0.42.0, httpx 0.27.2 → 0.28.1, Pydantic 2.10.4 → 2.12.5, pydantic-settings 2.6.1 → 2.13.1, SQLAlchemy 2.0.36 → 2.0.48, aiosqlite 0.20.0 → 0.22.1, PyYAML 6.0.2 → 6.0.3, Alembic 1.14.0 → 1.18.4, prometheus-client 0.21.1 → 0.24.1.
- **JWT library migration**: Replaced `python-jose[cryptography]` 3.5.0 with `PyJWT[crypto]` 2.12.1. The API is nearly identical (`jwt.encode`/`jwt.decode`). `python-jose` is unmaintained; FastAPI themselves have moved to PyJWT.
- **bcrypt held at 4.2.1**: Not upgraded to 5.0 because `passlib` 1.7.4 is incompatible with bcrypt 5.0's new password length enforcement.

## [2.3.0] - 2026-03-23

### Fixed
- **405 Method Not Allowed on ENC group/node deletion**: The SPA catch-all route was defined as `@app.get("/{full_path:path}")` (GET-only). When a DELETE request to a valid API endpoint fell through to this route, Starlette matched the path but not the method, returning 405. Changed to `@app.api_route` handling all methods with explicit 404 for unmatched `/api/*` paths and proper SPA serving for non-API requests.
- **Update process assumed /opt/openvox-gui was a git repo**: The update scripts and documentation incorrectly instructed users to `cd /opt/openvox-gui && git pull`. In reality, the git repository is cloned to a staging directory (e.g. `~/openvox-gui`) and the installer deploys files from there to `/opt/openvox-gui`. Rewrote `update_local.sh`, `deploy.sh`, and `UPDATE.md` to reflect this clone-then-deploy architecture.

### Added
- **SUDOERS.md**: New guide documenting the exact sudoers configuration required for the GUI, including rules for r10k, Bolt, certificate management, service control, and Puppet lookup.
- **Comprehensive inline docstrings**: All backend modules (routers, services, middleware, database, dependencies) now have detailed docstrings explaining security decisions, PQL injection prevention, and design rationale.

### Changed
- **r10k deploy wrapper**: `deploy.py` now calls `r10k-deploy.sh` instead of invoking r10k directly, ensuring proper environment setup regardless of how the service is started.
- **Sudoers points at wrapper**: The sudoers rule for r10k now references `/opt/openvox-gui/scripts/r10k-deploy.sh` instead of the bare r10k binary.

## [2.2.2] - 2026-03-10 – [2.2.9] - 2026-03-23

### Fixed
- **Installer proxy support**: Progressive improvements to proxy handling for corporate environments behind HTTP proxies — added programmatic proxy detection from environment variables, explicit `--proxy` flags for pip, improved URL encoding for proxy credentials with special characters, reduced npm concurrency to avoid proxy timeouts, and direct proxy passthrough to npm install.
- **Installer Node.js auto-install**: The installer now automatically installs Node.js 18 from system repositories (dnf module, apt, or NodeSource) when it's not already present, removing the need for manual pre-installation.
- **Pre-built frontend fallback**: If Node.js is unavailable or the npm build fails (common in restricted proxy environments), the installer falls back to a pre-built `frontend/dist/` directory shipped with the repository.
- **Node.js MaxListenersExceededWarning**: Suppressed spurious warning during frontend builds by setting `NODE_OPTIONS=--max-old-space-size=4096`.

## [2.2.0-1] - 2026-03-02

**Patch release** — security dependency update, installer fix, documentation corrections, and community PR.

### Security
- **CVE: Rollup path traversal (GHSA-mw96-cpmx-2vgc)**: Bumped rollup from 4.57.1 to 4.59.0 to resolve Dependabot alert #17 — "Rollup 4 Arbitrary File Write via Path Traversal" (Fixes Dependabot alert #17)

### Fixed
- **Installer: missing frontend/dist directory** (Issue #6): Changed `BUILD_FRONTEND` default from `false` to `true` in `install.sh` and `install.conf.example` so fresh installs build the frontend automatically when Node.js 18+ is present (Closes #6)
- **Docs: manage_users.py typo** (Issue #7): Fixed `manage_user.py` → `manage_users.py` (plural) across README.md, INSTALL.md, and TROUBLESHOOTING.md (9 occurrences). Also fixed incorrect `delete` subcommand → `remove` in README.md (Closes #7)
- **Docs: manage_users.py privilege escalation** (PR #8, credit: @albatrossflavour): Replaced broken `source venv/bin/activate` + `sudo ./scripts/manage_users.py` pattern with fully-qualified `sudo /opt/openvox-gui/venv/bin/python /opt/openvox-gui/scripts/manage_users.py` across all 3 doc files — the previous approach did not work because `sudo` creates a new root shell that does not inherit the user's venv environment. The fully-qualified path is portable, reliable, and requires no `sudo -E` environment passthrough (Closes #8)
- **TROUBLESHOOTING.md markdown linting** (PR #8, credit: @albatrossflavour): Added blank lines between labels/headings and code blocks, removed trailing whitespace, added trailing newline at EOF

### Changed
- **Docs: local installation requirement**: Added prominent callouts in README.md Quick Start and INSTALL.md prerequisites clarifying that OpenVox GUI requires local installation on the OpenVox Server — remote/separate-host installation is not currently supported

## [2.2.0-Release] - 2026-02-25

**Production release** — complete OpenVox rebranding with scrollability and UI polish.

### Changed
- **Full Puppet-to-OpenVox rebranding**: Every user-visible label, description, notification, and page title across the entire application now uses OpenVox product names (OpenVox Server, OpenVoxDB, OpenBolt). Sidebar navigation, config file groups, settings labels, SVG captions, error messages, and installation instructions all updated. Literal CLI commands and filesystem paths correctly retain `puppet` where that is the on-disk name.
- **Sidebar**: "PuppetDB Explorer" → "OpenVoxDB Explorer", "Puppet Configuration" → "OpenVox Configuration"
- **Settings**: "PuppetServer Host/Port" → "OpenVox Server Host/Port", "PuppetDB Host/Port" → "OpenVox DB Host/Port", "Puppet Infrastructure" → "OpenVox Infrastructure"
- **Code Deployment**: "Restart Puppet Services" → "Restart OpenVox Services"
- **Node Detail**: "Run Puppet" → "Run OpenVox", "Puppet Version" → "OpenVox Version"
- **Orchestration**: "Puppet Bolt" → "OpenBolt" throughout, package names → `openbolt`
- **Login page**: "Puppet infrastructure" → "OpenVox infrastructure"

### Fixed
- **PQL Console results scrolling**: Results pane now uses fixed viewport-based height so results scroll when they exceed the display area
- **Fact Explorer results scrolling**: Overall results table uses fixed viewport height. Per-cell values in the Value column now scroll individually when content exceeds 200px — fixed the `PrettyJson` component to use `h=` instead of `maxHeight=` on its ScrollArea, and plain text values use native `overflow: auto`
- **CONTRIBUTING.md typos**: Fixed "Str" → "Star", capitalization, spacing

## [2.1.2] - 2026-02-25

### Changed
- **Complete Puppet-to-OpenVox rebranding**: All user-facing prose, labels, and descriptions across the entire application and documentation now reference OpenVox product names (OpenVox Server, OpenVoxDB, OpenBolt). This includes:
  - All 5 documentation files (README, INSTALL, UPDATE, TROUBLESHOOTING, CHANGELOG note)
  - All 15 frontend component files (sidebar, page titles, notifications, descriptions, SVG captions, table headers, error messages, installation instructions)
  - Backend config file group labels (OpenVox Agent, OpenVox Server, OpenVox DB, System Configuration)
  - Literal CLI commands, filesystem paths, config values, and variable names correctly retain `puppet` where that is the actual on-disk name
- **CONTRIBUTING.md typo fixes**: Corrected "Str" → "Star", capitalization, and spacing issues

## [2.1.1] - 2026-02-25

### Changed
- **Documentation rebranding**: Initial pass replacing Puppet product names in documentation files. CHANGELOG historical entries preserved with a rebrand note.

## [2.1.0] - 2026-02-25

This is the first stable release of the 2.x series, consolidating all Alpha/Beta fixes and improvements since 2.0.0.

### Added
- **CONTRIBUTING.md**: Contribution guidelines for the project (issues, pull requests, community)
- **CONTRIBUTORS.md**: Acknowledgments for Massimiliano Adamo, Alessandro Franceschi, Ben Ford, Martin Alfke, and Tim Meusel
- **`scripts/update_local.sh`**: Local update script with automatic backup, version checking, `--skip-backup`, `--force`, `--auto`, and `--security` flags

### Fixed
- **Installer: directory nesting bug**: `cp -a backend/ dest/backend/` created nested `dest/backend/backend/` directories, putting `requirements.txt` and `package.json` at wrong paths. Fixed with clean copy pattern.
- **Installer: missing VERSION file**: Backend and frontend both require the `VERSION` file at the project root. The installer now copies it during Step 3.
- **Installer: silent npm failures**: `npm install` and `npm run build` had stderr suppressed. Errors are now visible with actionable messages.
- **LDAPS port 636 with self-signed certs**: Backend now auto-detects SSL from `ldaps://` URL scheme so the TLS configuration (including `CERT_NONE` for unverified certs) is always created. Frontend auto-toggles the SSL switch when typing `ldaps://`.
- **LDAP connection test diagnostics**: SSL failures now return actionable troubleshooting hints (certificate verify, wrong version, connection refused, timeouts).

### Changed
- **LDAP is authentication only**: `ldap_login()` no longer calls `resolve_role_from_groups()`. LDAP has zero knowledge of user roles. Auto-provisioned LDAP users get a default role of Operator, changeable in User Manager.
- **Roles managed in one place**: Removed the "Group Mapping → Local Roles" section from Auth Settings. User roles are managed exclusively in the User Manager tab.
- **Default role is Operator**: Both the Add User form and LDAP auto-provisioning default to Operator instead of Viewer.
- **`scripts/update_remote.sh`**: Genericized — accepts `--host`, `--user`, `--name` flags or `OPENVOX_DEPLOY_HOST`/`OPENVOX_DEPLOY_USER` env vars instead of hardcoded server address.
- **`backend/app/config.py`**: Default hostnames changed from site-specific to `localhost` (overridden by `.env` at install time).
- **`scripts/bump-version.sh`**: Fixed overly greedy regex that mangled version history in docs on every bump.
- **README.md**: Updated "What's New" section to reflect 2.1.0 features. Added links to CONTRIBUTING.md and CONTRIBUTORS.md.

## [2.0.0-3 Alpha] - 2026-02-20

### Added
- **Editable Bolt configuration**: `bolt-project.yaml` and `inventory.yaml` are now editable inline on the Orchestration → Configuration tab with monospace editor, Save/Cancel buttons, and YAML syntax validation before save
- **Bolt debug log viewer**: `bolt-debug.log` displayed as a read-only scrollable section for troubleshooting (shown when present)
- **Bolt rerun viewer**: `.rerun.json` displayed as a read-only scrollable section showing the last executed Bolt command (shown when present)
- **Backend save endpoint**: `PUT /api/bolt/config` saves Bolt YAML files with syntax validation and automatic `.bak` backup
- **ENC executable fix**: `scripts/enc.py` git filemode set to 0755; `deploy.sh` explicitly ensures executable permissions on re-deploy

### Changed
- **Scrollable config display**: All Bolt configuration file viewers use `ScrollArea` with constrained max-height instead of unconstrained overflow
- **Reusable EditableConfigFile component**: Consistent edit UX for any YAML config file with Edit/Save/Cancel workflow and error feedback

## [2.0.0-2 Alpha] - 2026-02-20

### Added
- **LDAP Documentation**: New comprehensive [LDAP / Active Directory Guide](docs/LDAP.md) covering setup, configuration reference, directory server presets (OpenLDAP, 389 DS, Active Directory), per-user auth source management, group-to-role mapping, AD UPN mode, connection testing, troubleshooting, and security considerations
- **Single-file version management**: Application version is now declared in a single `VERSION` file at the repo root — backend, frontend, installer, and all documentation read from it automatically; no manual edits needed anywhere else when the version changes

### Changed
- **Version architecture**: `backend/app/__init__.py` reads `VERSION` at import time; `vite.config.ts` reads it at build time; `install.sh` and `update_remote.sh` read it at runtime; `bump-version.sh` propagates to `package.json` and doc headers automatically
- **bump-version.sh**: Reframed as internal build/CI automation (not user-facing); quiet output for machine consumption
- **README.md**: Updated documentation links to include LDAP guide; removed references to non-existent docs
- **INSTALL.md**: Added LDAP setup as a post-installation step with link to the LDAP guide

## [2.0.0-1 Alpha] - 2026-02-20

### Fixed
- **PQL Console**: Removed two invalid example queries that always threw errors:
  - `fact-names {}` — not a valid PQL entity (fact-names is a REST endpoint, not a PQL query target)
  - `nodes { report_timestamp < "2 hours ago" }` — PuppetDB PQL requires ISO 8601 timestamps, not relative time strings
- **PQL Console error handling**: PuppetDB 400 errors now show the actual human-readable error message (e.g. `'2 hours ago' is not a valid timestamp value`) instead of an opaque HTTP client error
- **PQL Console error display**: Errors now show a clean text message with a helpful hint instead of a raw JSON dump

### Added
- **PQL Console**: New valid example queries — "Nodes by oldest report", "Nodes with catalog errors", "Service resources"

## [2.0.0] - 2026-02-20

### Added — LDAP / Active Directory Split Authentication
- **LDAP authentication backend**: Users can now authenticate against OpenLDAP, 389 Directory Server, Red Hat Directory Server, or Microsoft Active Directory
- **Per-user authentication source**: Each user can be individually configured to authenticate via LDAP or local password — selectable when creating users and changeable at any time via the UI
- **Auto-provisioning**: New LDAP users are automatically created in the local database on their first login, with roles derived from LDAP group membership
- **LDAP group-to-role mapping**: Map LDAP groups to Admin, Operator, and Viewer roles; administrators can always override roles locally
- **Quick presets**: One-click configuration templates for OpenLDAP, 389 DS / Red Hat DS, and Active Directory
- **Connection testing**: Test LDAP connectivity with diagnostic feedback before saving configuration
- **New `auth_source` column**: User model tracks whether each user authenticates via `local` or `ldap`
- **New API endpoints**:
  - `PUT /api/auth/users/{username}/auth-source` — change a user's authentication source
  - LDAP config CRUD: `GET/PUT /api/auth/ldap/config`
  - LDAP connection test: `POST /api/auth/ldap/test`
- **`ldap3` library**: Pure-Python LDAP client (cross-platform, no system dependencies)

### Changed — UI Improvements
- **New "Auth Settings" tab**: LDAP/AD configuration has its own dedicated tab in Settings (previously embedded in User Manager)
- **Add User form**: Now includes an "Authentication Source" selector (LDAP / Local); password field is conditionally shown only for local users; defaults to LDAP
- **User table**: New "Change auth source" action button (⇌) per user row for switching between local and LDAP authentication
- **Auth source change modal**: Includes a warning when switching to LDAP that the local password will be invalidated
- **Source badge**: Each user shows a colored badge indicating their authentication source (local/LDAP)
- **Settings tabs reordered**: Application Settings → Services → User Manager → Auth Settings

### Security
- Switching a user from local to LDAP invalidates their local password hash (prevents stale credential reuse)
- LDAP bind passwords are never exposed via the API (masked with `bind_password_set` boolean)
- Local accounts continue to work for service accounts and break-glass access alongside LDAP

### Technical Details
- **Backend files changed**: `auth_local.py`, `auth_ldap.py` (new), `auth.py` middleware, `user.py` model, `auth.py` router, `requirements.txt`
- **Frontend files changed**: `ConfigApp.tsx`, `UserManager.tsx`, `api.ts`
- **Database migration**: `auth_source` column added to `users` table; `ldap_config` table created
- **Login flow**: Per-user routing — checks user's `auth_source` to decide LDAP vs local authentication; unknown users try LDAP when enabled

## [1.4.8] - 2026-02-17

### Fixed
- **Run Puppet button always returned exit code 1**: The "Run Puppet" button on the Node Detail page used `bolt task run puppet_agent::run`, but the `puppet_agent` module was never installed — Bolt returned "Could not find a task named 'puppet_agent::run'"
  - **Fix**: Changed to `bolt command run '/opt/puppetlabs/bin/puppet agent -t'` which runs the agent directly and works with any Bolt installation
  - **Bolt inventory fix**: Configured `transport: local` for the Puppet server itself (root SSH was disabled) so Bolt executes locally without SSH; remote agents use SSH with sudo escalation
  - **Exit code handling**: Puppet exit code 2 (changes applied) is now correctly reported as success instead of an error

## [1.4.7] - 2026-02-17

### Security
- **python-multipart** (CVE-2026-24486, HIGH): Updated from 0.0.20 to 0.0.22 — fixes arbitrary file write via non-default configuration. Required upgrading production Python from 3.9 to 3.11 (python-multipart 0.0.22 requires Python ≥ 3.10)
- **esbuild** (GHSA-67mh-4wv8-2f99, MODERATE): Fully resolved by upgrading Vite from 5.4.x to 6.4.1, which bundles esbuild ≥ 0.25.0
- **Vite**: Upgraded from 5.4.21 to 6.4.1 — latest stable release
- **@vitejs/plugin-react**: Updated from 4.2.1 to 4.7.0 for Vite 6 compatibility

### Changed
- **Production Python runtime**: Upgraded from Python 3.9 to Python 3.11 to support latest security patches in dependencies

## [1.4.6] - 2026-02-17

### Security
- **Vite** (CVE-2025-62522, MODERATE): Upgraded from 4.5.x to 5.4.21 — fixes `server.fs.deny` bypass via backslash on Windows
- **Vite** (CVE-2025-58751, CVE-2025-58752, LOW): Vite 5.4.21 also fixes middleware file serving issues with public directory and HTML files
- **python-multipart** (CVE-2026-24486, HIGH): Not exploitable — this application uses default configuration (no `UPLOAD_DIR` or `UPLOAD_KEEP_FILENAME`); fix requires Python ≥ 3.10 but production runs Python 3.9; kept at 0.0.20
- **esbuild** (GHSA-67mh-4wv8-2f99, MODERATE): Dev-server-only CORS vulnerability — does not affect production builds; esbuild is used only as a build-time transpiler, never as a server in this application. Vite 5.4.x pins esbuild to 0.21.x internally; upgrading to esbuild ≥ 0.25.0 requires Vite 6+/7+ which is tracked for a future release
- Removed stale `vite` override from package.json (no longer needed with Vite 5.x)

## [1.4.5] - 2026-02-17

### Fixed
- **Ghost User Prevention**: Usernames are now stripped of leading/trailing whitespace on creation and login
  - **Root cause**: Creating a user with a trailing space (e.g. `"adrian "`) stored it as a distinct entry from `"adrian"`, making it impossible to delete via the UI which sent the trimmed name
  - **Fix**: Added `.strip()` to the user creation endpoint, the `add_user()` function, and the login endpoint
  - Empty usernames after stripping are now rejected with a 400 error

## [1.4.4] - 2026-02-17

### Changed
- **Centralized Version Management**: Eliminated hardcoded version strings scattered across the codebase
  - **Backend**: `backend/app/__init__.py` is now the single source of truth; `main.py` imports `__version__` instead of hardcoding the version in 3 places (FastAPI metadata, startup log, health endpoint)
  - **Frontend**: `package.json` version is injected at build time via Vite `define` → new `src/version.ts` module exports `APP_VERSION` for all components
  - **Login page & navigation bar**: Now import `APP_VERSION` instead of hardcoded strings — fixes the bug where the login page showed v1.3.0 while the dashboard showed v1.4.3
  - **New `scripts/bump-version.sh`**: Single command to update both `package.json` and `__init__.py` atomically, preventing version drift
  - **New `/api/version` endpoint**: Public (no-auth) endpoint returning the current application version
  - **`update_remote.sh`**: Now reads the version dynamically from `__init__.py` instead of hardcoding it

## [1.4.3] - 2026-02-16

### Fixed
- **User Deletion 404 Error**: Fixed bug where deleting a user from the User Manager returned "API Error 404: User not found" even though the user was successfully deleted from the database
  - **Root cause (backend)**: `remove_user()` in `auth_local.py` used a SQLAlchemy Core `delete()` statement whose `rowcount` is unreliable with aiosqlite after `commit()` — it could return `0` or `-1` even on a successful delete, causing the API to incorrectly report failure
  - **Fix (backend)**: Rewrote `remove_user()` to use the ORM pattern: fetch the user with `select()`, check if it exists, then delete with `session.delete(user)` — this gives a reliable existence check before deletion
  - **Fix (frontend)**: Moved `loadUsers()` call in `handleDeleteUser()` from the success-only path into a `finally` block so the user list always refreshes after a delete attempt, preventing stale UI state

## [1.4.2] - 2026-02-13

### 🔒 Comprehensive Security Update - All 11 Dependabot Alerts Fixed

This release addresses all 11 security vulnerabilities identified by GitHub Dependabot.

### Security
- **Fixed all 11 Dependabot security alerts**
- Updated Python dependencies to secure versions while maintaining compatibility
- Updated JavaScript dependencies with security overrides for transitive vulnerabilities
- Fixed vulnerable transitive dependencies including:
  - semver (ReDoS vulnerability)
  - ws (WebSocket DoS)
  - braces (prototype pollution)
  - micromatch (ReDoS vulnerability)
  - nanoid (insufficient entropy)
  - path-to-regexp (ReDoS vulnerability)
  - cookie (prototype pollution)
  - cross-spawn (command injection)
  - dompurify (XSS vulnerability)

### Changed
- Downgraded Vite from 6.x to 4.5.5 for Node 14 compatibility while maintaining security
- Updated PostCSS to 8.4.47 with security patches
- Updated all Python packages to latest secure versions
- Added package overrides to force secure versions of transitive dependencies

### Technical
- cryptography remains at 44.0.1 (secure version)
- All packages tested and verified to build successfully
- Maintained backward compatibility with production environment

## [1.4.1] - 2026-02-13

### 🔒 Security Update

This release focuses on strengthening the security posture of OpenVox GUI.

### Security
- **Fixed critical vulnerability in cryptography package** - Updated to v43.0.3
- **Implemented comprehensive security headers** including CSP, HSTS, X-Frame-Options
- **Added rate limiting** to prevent brute force attacks
  - Authentication endpoints: 5 requests/minute
  - API endpoints: 60 requests/minute
  - Resource-intensive endpoints: 10 requests/minute
- **Restricted CORS origins** - Only allows configured origins in production
- **Added input validation and sanitization module** to prevent injection attacks
- **Updated all frontend dependencies** to latest secure versions
- **Implemented secure cookie settings** with httponly and secure flags
- **Added protection against common attack patterns** in command execution

### Changed
- Updated backend dependencies to latest secure versions
- Enhanced authentication security with rate limiting
- Improved error handling for security-related failures
- CORS now restricts origins in production mode

### Added
- New validation utilities for all user inputs
- Security middleware with configurable headers
- Rate limiting middleware using slowapi
- Input sanitization for filenames and paths
- Command validation for Bolt execution
- PQL query validation

## [1.4.0] - 2026-02-13

**🎉 Production Release - Launch Ready!**

This is our first production-ready release with comprehensive documentation, improved stability, and a better user experience.

### ✨ New Features
- **Comprehensive Documentation Suite**
  - Brand new installation guide with step-by-step instructions
  - Detailed update guide for seamless upgrades
  - Complete troubleshooting guide for common issues
  - User-friendly README with clear explanations

### 🐛 Bug Fixes from Recent Development
- **Application Update Handling** - No more errors when navigating after deployments
- **Scrolling Issues** - Fixed multiple scrolling problems throughout the interface
- **Certificate Statistics** - Corrected counting and display of certificates
- **Fact Explorer** - Enhanced with nested fact support and autocomplete
- **Module Loading** - Better caching and error recovery

### 📝 Documentation
- Created [INSTALL.md](INSTALL.md) - Complete installation guide for new users
- Created [UPDATE.md](UPDATE.md) - Step-by-step update procedures
- Created [TROUBLESHOOTING.md](TROUBLESHOOTING.md) - Solutions for common problems
- Rewrote [README.md](README.md) - Clear, beginner-friendly overview
- Simplified this changelog to be more user-friendly

### 🔧 Technical Improvements
- Version checking system to detect updates
- Graceful error handling for chunk loading failures
- Improved cache control headers
- Better error messages throughout
- Enhanced ScrollArea components for better UX

## [1.3.11] - 2026-02-13

### Added
- **Graceful Handling of Application Updates**: Prevents errors when navigating after deployment
  - Added lazyWithRetry wrapper for code-split pages to handle chunk loading failures
  - Implemented version checking that runs every 5 minutes to detect updates
  - Shows user-friendly notification when new version is available
  - ErrorBoundary now detects and specially handles version mismatch errors
  - Users are prompted to refresh rather than seeing cryptic error messages
  - Prevents "Failed to fetch dynamically imported module" errors during deployments

### Technical Details
- Created `utils/versionCheck.ts` for version monitoring and chunk error detection
- Created `utils/lazyWithRetry.tsx` wrapper for React.lazy with error recovery
- Enhanced ErrorBoundary to differentiate between version errors and other crashes
- Version checker uses ETag/Last-Modified headers to detect changes without polling backend

## [1.3.10] - 2026-02-13

### Changed
- **Puppet Configuration Page**: Renamed "Hiera" tab to "Hiera Data Files" for clarity
  - Better describes the tab's content which shows Hiera data file management
  - Improves user understanding of the tab's functionality

## [1.3.9] - 2026-02-13

### Fixed
- **Fact Explorer Results Pane Scrolling**: Fixed scrolling issue with the main results table
  - Changed from maxHeight-only to fixed height (50vh) with min/max constraints
  - Results table now properly scrolls when content exceeds viewport
  - Maintains responsive behavior with viewport-based sizing

## [1.3.8] - 2026-02-13

### Fixed
- **Orchestration Result Tab Scrolling**: Fixed scrolling issues when switching between result tabs
  - Wrapped tab panels with ScrollArea components with fixed 65vh height
  - Removed redundant nested ScrollArea from renderOutput function
  - All three view modes (Human/JSON/Rainbow) now scroll properly
- **Fact Explorer Node Output Scrolling**: Fixed scrollability of large fact values in table cells
  - Wrapped individual fact values in ScrollArea with 300px max height
  - Large JSON and text values can now be scrolled within their cells
  - Improved usability when viewing complex nested fact structures

## [1.3.7] - 2026-02-13

### Fixed
- **Certificate Statistics Accuracy**: Fixed incorrect certificate counting in CA info panel
  - Now properly counts signed certificates from the actual list
  - Fixed pending count to accurately reflect waiting certificate requests
  - Statistics now match the data shown in the panels below
- **Certificate Details Modal Scrolling**: Fixed scrollability of certificate details window
  - Increased modal size to extra-large for better visibility
  - Set proper height with viewport units (70vh) for consistent scrolling
  - Added min/max height constraints for better usability
- **Certificate Statistics Clarity**: Improved labels and added tooltips
  - "Signed" renamed to "Active" to clarify these are currently active certificates
  - Added hover tooltips explaining each statistic
  - Clarified that revoked count is all-time total from CRL

## [1.3.6] - 2026-02-13

### Added
- **Certificate Authority Information Panel**: Added comprehensive CA info display to Certificates page
  - New dedicated panel at top of page showing CA certificate details
  - Displays Subject, Issuer, Serial Number, and Fingerprint
  - Shows validity dates with automatic expiration warnings
  - Displays days until expiry with color-coded badges
  - Shows key algorithm and key size information
  - Displays signature algorithm details
  - Real-time certificate statistics (signed, pending, revoked counts)
  - Automatic alerts for expired or soon-to-expire CA certificates
  - New backend endpoint `/api/certificates/ca-info` for fetching CA details
  - CRL (Certificate Revocation List) information when available

## [1.3.5] - 2026-02-13

### Fixed
- **Orchestration Result Window Scrolling**: Fixed scrollability issues in command/task/plan result output
  - Replaced fixed 500px height with dynamic viewport-based height (60vh)
  - Added proper ScrollArea component for smooth scrolling
  - Minimum height of 400px and maximum of 800px for better usability
  - All output formats (human, JSON, rainbow) now properly scrollable
  - Users can now view complete output regardless of length

## [1.3.4] - 2026-02-13

### Fixed
- **Resource Explorer Module Loading**: Fixed cache issues causing module loading failures
  - Added proper cache-control headers for versioned assets (immutable, long-term cache)
  - Ensured index.html is never cached to always get latest chunk references
  - Cleared stale cached files on production server
  - Prevents "Failed to fetch dynamically imported module" errors

## [1.3.3] - 2026-02-13

### Enhanced
- **Fact Explorer Nested Fact Support**: Significantly improved nested fact querying experience
  - Replaced Select dropdown with Autocomplete component for direct typing of nested facts
  - Added intelligent autocomplete suggestions that understand dotted notation (e.g., os.family, memory.system.total)
  - Added ability to press Enter or click Query button to submit any typed fact name
  - Added quick access badges for common nested facts organized by category (System, Network)
  - Improved suggestion filtering with prefix-first matching
  - Supports up to 100 autocomplete suggestions with scrollable dropdown
  - Clear button to reset the fact search
  - Better placeholder text showing example nested fact paths

## [1.3.2] - 2026-02-13

### Changed
- **Orchestration Page UI Reorganization**: Moved Execution History from bottom pane to dedicated tab
  - Removed split-screen layout with fixed bottom pane
  - Added new "Execution History" tab between "Run Plan" and "Configuration" tabs
  - Cleaner single-pane interface with all features accessible via tabs
  - Better use of screen real estate for command execution results

## [1.3.1] - 2026-02-13

### Bug Fixes
- **Resource Explorer Scrolling**: Fixed issue where query results extending beyond the visible area could not be scrolled
  - Output window now uses viewport-based dynamic height instead of fixed 500px
  - Scrollable area properly expands to show all results
  - Added proper word-wrapping for long resource titles and file paths
  - Improved scrollbar visibility and usability

## [1.3.0] - 2026-02-13

### New Features
- **Nested Fact Querying**: Fact Explorer now supports querying nested fact values using dot notation
  - Query structured facts like "os.family", "memory.system.total", "networking.hostname"
  - Automatically discovers and suggests available nested paths for structured facts
  - Shows both base fact and nested path information in results
  - Grouped dropdown organizes facts by their base name for easier navigation
- **Pretty JSON Display**: All JSON outputs throughout the application are now formatted for readability
  - Similar to `jq` output with proper indentation and syntax highlighting
  - Implemented in: Fact Explorer, PQL Console, Node Details, Node Classifier, Orchestration results, Execution History
  - New reusable PrettyJson component for consistent JSON formatting
- **Fact Structure Explorer**: New API endpoint to explore the structure of complex facts
  - Sample values from multiple nodes to understand fact structure
  - Automatically extract available nested paths from structured facts

### Technical Improvements
- Enhanced Facts API with nested value extraction using dot notation
- New `get_nested_value` function for traversing complex fact structures
- PrettyJson component with scrollable areas and proper overflow handling
- Improved fact name suggestions with common nested paths for known structured facts

## [1.2.0] - 2026-02-13

### New Features
- **Execution History Tracking**: New scrollable pane at the bottom of the Orchestration page showing all commands, tasks, and plans executed in the last 14 days
  - Automatic logging of all orchestration executions with timestamps, duration, and status
  - Filter by execution type (command/task/plan), status (success/failure/running), node, and time period
  - View detailed execution information including parameters, errors, and result previews
  - Auto-refresh every 10 seconds to show latest executions
  - Delete individual history entries or bulk cleanup old entries
- **Execution Statistics API**: New `/api/execution-history/stats` endpoint providing execution analytics

### Technical Improvements
- Added new `ExecutionHistory` database model with comprehensive execution tracking
- Modified Bolt orchestration endpoints to automatically log all executions
- New `ExecutionHistory` React component with advanced filtering and detail views
- Responsive layout with the history pane taking up to 40% of the Orchestration page

## [1.1.0] - 2026-02-13

### New Features
- **Multi-format Output Display**: Orchestration page now displays command/task/plan results in all three formats (Human, JSON, Rainbow) simultaneously in tabbed panes - users can switch between formats without re-running commands
- **Parallel Format Fetching**: All three output formats are fetched in parallel for better performance

### Security Updates
- **Critical Security Fixes**: Updated 11 vulnerable dependencies (1 critical, 3 high, 7 moderate)
  - **Frontend Dependencies**:
    - Vite: 5.0.8 → 6.4.1 (fixes CVE-2024-23331 critical directory traversal vulnerability)
    - React: 18.2.0 → 18.2.0 (kept stable)
    - React Router DOM: 6.20.0 → 6.21.0
    - TypeScript: 5.3.3 → 5.3.3 (kept compatible)
    - PostCSS and build tools updated to latest secure versions
    - esbuild: Now using 0.25.12 (fixes GHSA-67mh-4wv8-2f99 CORS vulnerability)
  - **Backend Dependencies**:
    - **python-jose**: 3.3.0 → 3.5.0 (CRITICAL - fixes CVE-2024-33663 CVSS 9.3 algorithm confusion, CVE-2025-61152 alg=none bypass)
    - FastAPI: 0.104.1 → 0.129.0
    - Uvicorn: 0.24.0 → 0.30.6
    - Pydantic: 2.5.2 → 2.10.5
    - SQLAlchemy: 2.0.23 → 2.0.36
    - Jinja2: 3.1.2 → 3.1.6
    - python-multipart: 0.0.6 → 0.0.22
    - bcrypt: 4.0.1 → 4.2.1
    - PyYAML: 6.0.1 → 6.0.2
    - aiosqlite: 0.19.0 → 0.20.0
    - alembic: 1.13.0 → 1.14.1
    - httpx: 0.25.2 → 0.27.2
- **Virtual Environment**: Added Python virtual environment support to backend for better dependency isolation
- **Node.js Requirement**: Vite 6+ requires Node.js 18+ (previously Node 14.18+ was sufficient)

### Improvements
- **Orchestration Results**: Removed single format selector in favor of tabbed display showing all formats
- **Error Handling**: Better error display in each format tab
- **Build System**: Updated to latest Vite which includes numerous performance improvements

### Bug Fixes
- **Security Vulnerability Remediation**: Resolved all critical and high severity vulnerabilities, reduced moderate vulnerabilities from 7 to 1

## [1.0.0] - 2026-02-12

### Highlights
First stable release of OpenVox GUI. All core features are complete, tested, and production-ready.

### New Features
- **Settings > Services Tab**: New dedicated Services tab in the Settings page with full ecosystem service management -- shows live status, PID, uptime, and individual restart buttons for PuppetServer, PuppetDB, Puppet agent, and the OpenVox GUI application itself
- **Dynamic Application Name**: The configured "Application Name" setting now dynamically updates the browser tab title, the login page title, and the app header -- changes take effect immediately on next page load
- **Clickable Logo and Title**: Clicking the OpenVox logo or application title in the header navigates back to the Dashboard
- **Service Restart Link**: The "service restart" text in the Application Settings instructions is now an active link that switches directly to the Services tab
- **Public App Name Endpoint**: New unauthenticated `GET /api/config/app/name` endpoint so the login page can display the configured app name before authentication

### Improvements
- **Code Deployment Restart Button**: Replaced the full services panel (individual service cards) with a single "Restart All Puppet Services" button that restarts PuppetDB, PuppetServer, and Puppet agent in the correct dependency order via `POST /api/config/services/restart-puppet-stack`
- **Node Classifier Tab Order**: Nodes tab is now the default/first tab; Hierarchy tab renamed to "Help" and moved to last position
- **Node Classifier Groups Dropdown**: The groups MultiSelect when classifying a node now shows ALL configured groups organized by environment as option groups, instead of filtering to only the selected environment (which hid groups in other environments)
- **Orchestration Format Isolation**: Switching output format (Human/JSON/Rainbow) in Run Command, Run Task, or Run Plan now clears the previous result to prevent stale output from a different format being displayed
- **Bolt Version Display**: Fixed the Orchestration Overview tab showing "unknown" for the Bolt version; the status endpoint now calls `bolt --version` directly without appending inventory flags
- **Save Notification**: Updated setting save notification to say "Go to the Services tab to restart" with clear guidance

### Bug Fixes
- **ENC Greenlet Error**: Fixed `greenlet_spawn has not been called` SQLAlchemy async error when classifying nodes -- root cause was lazy-loaded relationships on the `EncNode.groups` many-to-many; fixed by adding `lazy="selectin"` to both sides of the relationship and replacing `db.refresh(node)` with a proper re-fetch using `selectinload`
- **Bolt Version Endpoint**: `bolt --version` was routed through `run_bolt_command()` which appends `-i inventory.yaml`, causing the command to fail silently

### API Endpoints Added
- `GET /api/config/app/name` -- Public (no auth) endpoint returning the configured application name
- `POST /api/config/services/restart-puppet-stack` -- Ordered restart of PuppetDB, PuppetServer, Puppet agent

### Installer
- Version bumped to v1.0.0
- Added `openvox-gui` service restart permission to sudoers
- Added `puppetserver ca` and `openssl x509` sudoers rules
- Added `/opt/openvox-gui/config` to systemd `ReadWritePaths` for settings persistence

## [0.3.1] - 2026-02-11

### Bug Fixes
- **Fact Explorer**: Rewrote page to use dedicated REST endpoints (`/api/facts/names`, `/api/facts/values/{name}`) instead of broken PQL queries; dropdown now loads all 125+ fact names and displays certname + value table for the fleet
- **Code Deployment**: Fixed crash ("Table is not defined") caused by missing `Table` import from Mantine
- **Application Settings 500 Error**: Fixed "Read-only file system" crash when updating settings; added `/opt/openvox-gui/config` to systemd `ReadWritePaths`

### Improvements
- **Orchestration Output Format Selector**: Run Command, Run Task, and Run Plan tabs now include a segmented control to choose output format: Human (clean text), JSON (structured data), or Rainbow (full ANSI color). Rainbow output renders with proper terminal colors in the browser via `ansi-to-html`
- **Orchestration PTY Support**: Rainbow format uses `script(1)` to allocate a pseudo-TTY so Bolt emits full RGB ANSI color sequences; `--color` flag is appended automatically
- **Bolt Inventory Flag**: All Bolt commands now include `-i /etc/puppetlabs/bolt/inventory.yaml` automatically so the inventory file is always found
- **PQL Console Certname Dropdown**: Added a searchable node selector that auto-substitutes `NODENAME` placeholders in example queries with the selected certname
- **Settings Nav Rename**: Renamed "Application" sidebar link to "Settings" with a gear icon for clarity
- **PQL Console Unlimited Results**: Default query limit raised from 100 to 10,000; results pane uses viewport-height scrolling (`calc(100vh - 200px)`) instead of a fixed 500px cap

### API Endpoints Added
- `GET /api/facts/names` — List all known fact names from PuppetDB
- `GET /api/facts/values/{fact_name}` — Get certname + value for every node with the given fact

### Dependencies
- Added `ansi-to-html` npm package for ANSI escape code rendering in Orchestration results


## [0.3.0] - 2026-02-11

### Major Features
- **PQL Query Console** — Execute ad-hoc Puppet Query Language queries directly against PuppetDB with example library, auto-detected column rendering, and query history
- **Certificate Authority Management** — Sign, revoke, and clean Puppet CA certificates with detailed certificate inspection via `puppetserver ca`
- **Fact Explorer** — Search and compare any fact across the entire fleet with value distribution analysis and filtering
- **Resource Explorer** — Search Puppet resources (Package, Service, File, Class, etc.) across all nodes with regex title filtering
- **Deploy History** — Persistent deployment log tracking who deployed, when, what environment, and success/failure status

### Improvements
- **React Error Boundary** — Component crashes now show a friendly error message with stack trace and recovery options instead of a blank white page
- **Dashboard Auto-Refresh** — Configurable live polling (10s/30s/1m/5m) with "Live" indicator badge and last-updated timestamp
- **Code Splitting** — All pages are lazy-loaded via React.lazy/Suspense; initial bundle reduced significantly
- **Sidebar Navigation** — Added missing "Nodes" link; new sections for PuppetDB Explorer (PQL Console, Fact Explorer, Resource Explorer) and Infrastructure (Certificates)
- **Run Puppet Button** — Node detail page now has a "Run Puppet" button that triggers `puppet_agent::run` via Bolt
- **Version 0.3.0** — Major version bump reflecting the scope of new features

### Bug Fixes
- Fixed missing `json` import in config.py router that would crash preferences API
- Fixed sidebar missing Nodes navigation link
- Added sudoers rules for `puppetserver ca` and `openssl` commands

### API Endpoints Added
- `POST /api/pql/query` — Execute PQL queries against PuppetDB
- `GET /api/pql/examples` — PQL example query library
- `GET /api/certificates/list` — List all CA certificates (signed + pending)
- `POST /api/certificates/sign` — Sign a pending certificate
- `POST /api/certificates/revoke` — Revoke a signed certificate
- `POST /api/certificates/clean` — Clean (remove) a certificate
- `GET /api/certificates/info/{certname}` — OpenSSL certificate details
- `GET /api/deploy/history` — Persistent deployment history log


## [0.2.42] - 2026-02-09

### Added
- **Theme system**: Dual-theme support with Casual (dark mode, orange accents, animated SVG illustrations) and Formal (light mode, white background, black foreground, VoxPupuli Blue accents, no illustrations)
- **ThemeContext provider** (`frontend/src/hooks/ThemeContext.tsx`): React context managing theme state with `localStorage` + backend persistence
- **Theme selector**: SegmentedControl in Application → Application Settings tab to switch between Casual and Formal themes
- **Editable application settings**: All settings in the Application Settings tab are now editable inline — click Edit, modify the value, Save or Cancel
- **Preferences API** (`/api/config/preferences`): GET/PUT endpoint for persisting theme and future user preferences to `preferences.json`
- **Settings update API** (`PUT /api/config/app`): Endpoint to update individual `.env` settings by key/value pair

### Changed
- **AppShell**: Header, navbar, and logo dynamically adapt to active theme — white header and light gray navbar (`#f8f9fa`) in Formal mode
- **Login page**: Background gradient, logo, and sign-in button color adapt to active theme
- **MantineProvider**: Dynamically switches between dark/light color scheme and orange/blue primary palette based on theme
- **All illustration pages**: SVG cartoons (NODE-O-SCOPE 2000, BOLT-O-MATIC 4000, RobotComic, Report-O-Scope 9000, HIERA-TRON 5000, USER-O-MATIC 3000) conditionally hidden in Formal mode; layout panels expand to full width
- **Version strings**: Bumped to v0.2.42

### Fixed
- **NodeClassifier blank page**: Added missing `useAppTheme` import that caused a crash on navigation

---
## [0.2.41] - 2026-02-09

### Changed
- **Documentation**: Updated README.md with all features from v0.2.34–v0.2.40 including Hierarchical Node Classifier, Orchestration (Puppet Bolt), consolidated Application/User Manager settings
- **Installer**: Added Puppet Bolt sudoers rules for running commands, tasks, and plans as the service user; bumped installer version to v0.2.41
- **Version strings**: Bumped all version references to v0.2.41

---

## [0.2.40] - 2026-02-09

### Added
- **Orchestration page** (`/orchestration`): Full Puppet Bolt integration with 5 tabs:
  - **Overview**: Animated SVG illustration (BOLT-O-MATIC 4000) — a giant industrial machine with conveyor belt feeding servers into a processing chamber with lightning bolts, gears, and a smokestack
  - **Run Command**: Execute ad-hoc shell commands on remote nodes via `bolt command run`
  - **Run Task**: Run Puppet tasks on selected nodes via `bolt task run` — discovers tasks from installed modules
  - **Run Plan**: Execute Puppet plans via `bolt plan run` — discovers plans from installed modules
  - **Configuration**: View and manage `bolt-project.yaml` and `inventory.yaml` configuration
- **Bolt API endpoints** (`/api/bolt/`):
  - `GET /api/bolt/status` — check Bolt installation and version
  - `GET /api/bolt/tasks` — discover available Bolt tasks from modules
  - `GET /api/bolt/plans` — discover available Bolt plans from modules
  - `GET /api/bolt/inventory` — read Bolt inventory configuration
  - `GET /api/bolt/config` — read bolt-project.yaml
  - `POST /api/bolt/run/command` — execute a shell command on targets
  - `POST /api/bolt/run/task` — run a Puppet task on targets
  - `POST /api/bolt/run/plan` — run a Puppet plan on targets
- **NODE-O-SCOPE 2000**: Animated SVG illustration added to the Node Classifier Hierarchy tab — shows a complex scanning machine with rotating dishes and oscilloscopes processing server racks

### Changed
- **Navigation**: Added "Orchestration" section with Bolt icon in the sidebar

---

## [0.2.39] - 2026-02-09

### Fixed
- **Create Group blank screen crash**: Mantine v7 grouped MultiSelect requires data in `[{group, items: [{value, label}]}]` format — was incorrectly using Mantine v6 format `[{value, label, group}]` which caused the component to crash silently on render

---

## [0.2.38] - 2026-02-09

### Added
- **Available Classes API** (`GET /api/enc/available-classes`): Scans Puppet module manifests from `modules/`, `site-modules/`, and `site/` directories and returns all discovered class names organized by module
- **ClassPicker component**: Grouped MultiSelect dropdown for selecting Puppet classes — groups classes into Roles, Profiles, and Modules categories for easy browsing
- **ParamEditor component**: Key-value editor rows with Add/Remove buttons for managing Puppet class parameters — replaces raw JSON textarea

### Changed
- **Node Classifier**: All JSON textareas for classes and parameters replaced with ClassPicker dropdowns and ParamEditor key-value rows across Common, Environments, Node Groups, and Nodes tabs

---

## [0.2.37] - 2026-02-09

### Changed
- **Environments tab**: Auto-discovers environments from `/etc/puppetlabs/code/environments/` on the filesystem and creates any missing ones in the database automatically with a notification banner

---

## [0.2.36] - 2026-02-09

### Changed
- **Node Classifier**: Complete architectural redesign from flat ENC to hierarchical 4-layer deep merge model
  - **Common layer**: Global defaults applied to all nodes (lowest priority)
  - **Environment layer**: Per-environment classes and parameters
  - **Group layer**: Reusable groups of classifications
  - **Node layer**: Per-node overrides (highest priority)
  - Classification resolution uses deep merge: Common → Environment → Group → Node
- **Node Classifier page**: Redesigned from 3 separate pages into a single page with 6 tabs:
  - Hierarchy (overview with merge order visualization)
  - Common (global defaults)
  - Environments (per-environment classification)
  - Node Groups (reusable groups)
  - Nodes (per-node overrides)
  - Classification Lookup (deep-merged YAML output for any node)
- **ENC API endpoints**: New hierarchical endpoints replacing flat classification model:
  - `GET/POST /api/enc/common` — global common layer
  - `GET/POST /api/enc/environments`, `PUT/DELETE /api/enc/environments/{name}` — environment CRUD
  - `GET/POST /api/enc/groups`, `PUT/DELETE /api/enc/groups/{id}` — group CRUD
  - `GET/POST /api/enc/nodes`, `PUT/DELETE /api/enc/nodes/{certname}` — node CRUD
  - `GET /api/enc/resolve/{certname}` — deep-merged classification lookup
  - `GET /api/enc/{certname}` — Puppet ENC endpoint with deep merge
- **ENC database models**: New SQLAlchemy models: `EncCommon`, `EncEnvironment`, `EncGroup`, `EncNode`

### Removed
- Old flat ENC model (NodeGroup, Classification, ClassificationRule tables)
- Separate Node Groups, Classifications, and Rules pages

---

## [0.2.35] - 2026-02-09

### Changed
- **Node Classifier**: Consolidated three separate pages (Node Groups, Classifications, Rules) into a single tabbed page at `/enc`
- **Navigation**: Collapsed "Node Groups", "Classifications", and "Rules" sidebar links into a single "Node Classifier" link

### Removed
- Separate routes for `/enc/groups`, `/enc/classifications`, `/enc/rules` — all consolidated into `/enc`

---

## [0.2.34] - 2026-02-09

### Changed
- **Application page**: Converted to tabbed layout with "Application Settings" and "User Manager" tabs
- **User Manager**: Moved from standalone page under "Administration" nav group into the Application page as a tab — authentication panel moved to top of User Manager tab
- **Navigation**: Removed "Administration" group and "User Manager" sidebar link — user management accessible via Application → User Manager tab

### Removed
- Standalone User Manager page (`/users` route)
- "Administration" navigation group

---

---

## [0.2.19] - 2026-02-10

### Added
- **User Manager illustration**: Animated SVG "People Processing Machine" (USER-O-MATIC 3000) showing confused stick figures entering a conveyor belt machine with spinning gears, status lights, and a smokestack, then emerging as properly badged and sorted users (Admin with crown, Operator with wrench, Viewer with glasses). Caption: "unsorted humans in → properly badged users out (no humans were harmed in the making of this feature)"

---

## [0.2.18] - 2026-02-10

### Changed
- **Reports page**: Limited display to 50 reports (was 100)

---

## [0.2.17] - 2026-02-10

### Changed
- **Robot comic**: Now reactive to deployment state
  - **Idle**: Robot stands with arms lowered, amber eyes pulsing slowly, caption reads "impending doom / awaiting deployment orders..."
  - **Deploying**: Robot raises arm and fires laser at city, red eyes flash rapidly, sky turns red, explosion with smoke and debris, caption reads "r10k deployment in progress... / destroying legacy environments since 2014"
- **Output window**: Doubled in height (400px scrollable area); full scrollback preserved across multiple deployments with timestamped headers; auto-scrolls to bottom on new output; "Clear" button to reset
- **Output accumulation**: Each deploy appends to the log with a separator banner showing timestamp and environment, rather than replacing previous output

---

## [0.2.16] - 2026-02-10

### Changed
- **Code Deployment page**: Completely redesigned layout
  - "Deploy with r10k" panel moved to top-left half with environment selector and deploy button
  - Output window permanently visible below, spanning full width, with placeholder text when empty
  - Added animated SVG comic on the right half: a giant killer robot attacking a small city at night, complete with laser beam, explosions, animated eyes and reactor core, falling debris, and humorous captions

### Removed
- **Control Repository panel**: Removed from Code Deployment page
- **Module Repository panel**: Removed from Code Deployment page
- **Available Environments panel**: Removed from Code Deployment page (environments still selectable in the deploy dropdown)

---

## [0.2.15] - 2026-02-10

### Removed
- **Nodes menu item**: Removed from the navigation sidebar — nodes are accessible via the Dashboard table and clicking through to node details

---

## [0.2.14] - 2026-02-10

### Changed
- **Active Users**: Moved from Dashboard stats row to the navigation sidebar — displayed as a small text line under the version number (e.g. "2 active users"), with a hover popover showing each user's name and IP
- **Active sessions polling**: The sidebar now polls `/api/dashboard/active-sessions` every 30 seconds to keep the count current across all pages

### Removed
- **Dashboard stats cards**: Removed the Total Nodes, Unchanged, Changed, Failed, Noop, and Active Users cards — this data was redundant with the Node Status donut chart already shown below
- **StatsCard component**: No longer used, removed from Dashboard

---

## [0.2.13] - 2026-02-10

### Changed
- **Dashboard**: Added a full-width Nodes table below the Node Status donut and Report Trends chart — shows certname, status badge, environment, and last report time with clickable rows linking to node details
- **Application Configuration page**: Services panel (puppetserver, puppetdb, puppet agent status) moved here from the Dashboard

### Removed
- **Services panel from Dashboard**: Relocated to the Application Configuration page under Configuration menu

---

## [0.2.12] - 2026-02-10

### Fixed
- **Logo**: Reverted to the original unmodified OpenVox logo from [voxpupuli/logos](https://github.com/voxpupuli/logos/blob/master/images/OpenVox/Black/original_files_by_smortex/logo.svg) — both the header and login page now use the same original SVG

### Removed
- **`openvox-logo-white.svg`**: Deleted the color-swapped variant; only the original `openvox-logo.svg` is used

---

## [0.2.11] - 2026-02-10

### Changed
- **Active Users card**: Now displays a hover dropdown when moused over — shows each active user's name, IP address, and time since last seen (e.g. "3m ago"), while the card itself remains the same compact size as the other stats cards showing just the count and icon

---

## [0.2.10] - 2026-02-10

### Changed
- **Active Users**: Converted from a large panel to a compact StatsCard matching the other summary cards (Total Nodes, Unchanged, Changed, Failed, Noop), placed immediately to the right of the Noop card
- **Stats row**: Expanded from 5 to 6 columns to accommodate the Active Users card
- **Report Trends**: Moved back to the first grid row (8 columns, next to Node Status donut)
- **Services**: Now the only card in the bottom grid row

### Removed
- Large Active Users panel with user list detail (replaced by compact StatsCard showing count)

---

## [0.2.9] - 2026-02-10

### Fixed
- **Header logo/title overlap**: Set explicit `width: 36` and `display: block` on logo image, used numeric gap `16`, and `wrap="nowrap"` on the Group to prevent the title text from bleeding over the logo

### Changed
- **Dashboard layout**: Moved Active Users panel from the bottom row to the top row (spanning 8 columns next to Node Status), displaying users in a compact horizontal layout
- **Report Trends**: Moved from the top row to the bottom row (spanning 8 columns next to Services)

### Removed
- **Environments panel**: Removed from the dashboard

---

## [0.2.8] - 2026-02-10

### Changed
- **Header bar**: Removed blue (`#0D6EFD`) background — reverted to default dark theme header; title and badge styling returned to defaults

### Added
- **User Manager page** (`frontend/src/pages/UserManager.tsx`): Full user administration UI with:
  - User listing table with username, role badges (admin/operator/viewer)
  - Add User modal (username, password, role selector)
  - Change Password modal per user
  - Change Role modal per user
  - Delete user with confirmation (cannot delete yourself)
  - Toast notifications for all operations
- **User management API client** (`frontend/src/services/api.ts`): `users.list()`, `users.create()`, `users.remove()`, `users.changePassword()`, `users.changeRole()`
- **Administration nav section** in sidebar with User Manager link (`/users`)
- Route `/users` registered in `App.tsx`

---

## [0.2.7] - 2026-02-10

### Changed
- **All accent colors**: Replaced VoxPupuli Orange (`#EC8622`) with VoxPupuli Blue (`#0D6EFD`) across the entire UI — header bar, nav active states, buttons, badges, stats cards, deployment controls, report icons, login page
- **Mantine primary palette**: Renamed `vporange` back to `vpblue` with 10-shade ramp centred on `#0D6EFD`

### Removed
- All references to `#EC8622` (orange) from the frontend

---

## [0.2.6] - 2026-02-10

### Changed
- **Accent color**: Swapped all VoxPupuli Blue (`#0D6EFD`) accent colors to VoxPupuli Orange (`#EC8622`) — nav active states, buttons, badges, stats cards, deployment controls, report icons, and login page now use the orange palette
- **Mantine primary palette**: Renamed `vpblue` to `vporange` with a 10-shade ramp centred on `#EC8622`
- **Login page**: Background gradient and sign-in button changed from blue to orange

---

## [0.2.5] - 2026-02-10

### Changed
- **Header bar**: Background color changed to official VoxPupuli Orange (`#EC8622`); user badge and logout icon styled white for contrast
- **Logo/title spacing**: Increased gap between OpenVox fox-V logo and "OpenVox GUI" title text to prevent overlap; title set to `whiteSpace: nowrap` and logo to `flexShrink: 0`
- **Primary color**: Replaced Mantine `primaryColor` from `violet` to custom `vpblue` palette based on VoxPupuli Blue (`#0D6EFD`) — affects all NavLink active states, buttons, and interactive elements
- **Login page**: Background gradient changed from purple (`#667eea`/`#764ba2`) to blue (`#0D6EFD`/`#0a58ca`); sign-in button changed from violet-cyan gradient to solid blue
- **Dashboard**: "Total Nodes" stats card icon changed from violet to VoxPupuli Blue
- **Code Deployment**: Page icon, branch badges, deploy buttons, and environment select all changed from violet to VoxPupuli Blue
- **Report Detail**: Report icon and audit status badge changed from violet to blue

### Removed
- All references to `violet`, `purple`, `grape`, and `#667eea`/`#764ba2` colors throughout the frontend

---

## [0.2.4] - 2026-02-10

### Changed
- **Login Page**: Replaced placeholder `IconCategory` icon with the official OpenVox fox-V logo (black variant, from [voxpupuli/logos](https://github.com/voxpupuli/logos)) displayed at 72px height on the login card
- **AppShell Header**: Switched from black logo to white variant (`openvox-logo-white.svg`) so the fox-V mark is visible against the dark header background
- **Version strings**: Bumped to v0.2.4 in Login page and AppShell sidebar

### Added
- **`frontend/public/openvox-logo-white.svg`**: White-on-transparent variant of the official OpenVox logo for use on dark backgrounds
- **Official OpenVox Logo**: `frontend/public/openvox-logo.svg` now contains the actual OpenVox fox-V mark by Romain Tartière (CC BY-SA 4.0), replacing the placeholder hexagonal icon

---

## [0.2.3] - 2026-02-09

### Fixed
- **Duplicate logo in header**: Removed leftover `ThemeIcon` + `IconCategory` that appeared alongside the SVG logo in the AppShell header — now shows only the SVG image
- **Duplicate admin badges**: Consolidated two user badges (one colored, one grey) into a single small grey outline badge showing username and role
- **Empty report logs tab**: Updated backend `get_report_logs()` to query PuppetDB sub-endpoint `/pdb/query/v4/reports/<hash>/logs` directly instead of relying on lazy-loaded href references; changed Puppet `log_level` from `err` to `info` so non-error log entries are captured in reports

---

## [0.2.2] - 2025-02-10

### Added
- **`install.sh`**: Full installer script with 9-step process — service user creation, directory setup, file copying, Python venv, frontend build, configuration generation, systemd service, permissions/firewall/SELinux, and initial admin user setup
  - Supports interactive mode, answer-file (`-c install.conf`), and silent mode (`-y`)
  - Auto-generates secure JWT secret keys and admin passwords
  - Validates sudoers rules with `visudo -cf`
  - Includes `--uninstall` for clean removal
- **`install.conf.example`**: Answer file template with all configurable variables documented
- **`config/.env.example`**: Template environment file (secrets never committed to git)
- **Consolidated sudoers rules** (`/etc/sudoers.d/openvox-gui`): Single file covering r10k deploy, PuppetDB config reading, and Puppet service management (start/stop/restart/status for puppetserver, puppetdb, puppet)

### Changed
- **`config/openvox-gui.service`**: Updated systemd unit file with correct security settings:
  - `NoNewPrivileges=false` — required for `sudo r10k` to work from child processes
  - `PrivateTmp=false` — r10k needs real `/tmp` for module extraction during deployment
  - `ReadWritePaths` expanded to include `/opt/puppetlabs/puppet/cache` (r10k git cache), `/etc/puppetlabs/code/environments` (code deployment target), and `/tmp`
  - Removed `ReadOnlyPaths=/etc/puppetlabs` which blocked r10k code deployment
  - Added `EnvironmentFile` directive pointing to `config/.env`
  - Uses `INSTALL_DIR` placeholder for portability
- **`scripts/deploy.sh`**: Rewritten as a quick re-deploy helper (git pull, pip install, npm build, fix permissions, restart) — for fresh installs use `install.sh` instead
- **`.gitignore`**: Added `config/.env`, `config/.credentials`, and `install.conf` to prevent committing site-specific secrets

### Fixed
- **r10k deployment failure**: `ProtectSystem=strict` with `ReadOnlyPaths=/opt/puppetlabs` made the entire Puppet directory tree read-only in the systemd mount namespace — even `sudo` couldn't write. r10k failed with "Read-only file system" when trying to update `FETCH_HEAD` in its git cache or extract modules to `/tmp`
- **Missing sudoers rule for r10k**: No sudoers entry existed for the puppet user to run `r10k deploy` via sudo
- **Frontend dist/ permissions**: Directory was `750` (puppet:puppet) preventing proper file serving; installer now ensures `755` for dirs and `644` for files in dist/

---


## [0.2.1] - 2025-02-09

### Added
- **Login Page**: Branded sign-in page with OpenVox icon, gradient background, username/password form, and error handling (`frontend/src/pages/Login.tsx`)
- **Auth Context**: React context for authentication state management — handles login, logout, token persistence in localStorage, and automatic token validation on app load (`frontend/src/hooks/AuthContext.tsx`)
- **OpenVox Logo**: SVG logo file served from the `public/` directory, displayed on both the login page and the app header (`frontend/public/openvox-logo.svg`)
- **User Display in Header**: Logged-in username shown as a badge with role indicator and a sign-out button in the AppShell header
- **API Auth Headers**: All API calls now include `Authorization: Bearer <token>` header from stored JWT token (`frontend/src/services/api.ts`)
- **401 Auto-Redirect**: API client automatically clears expired tokens and reloads to show the login page on 401 responses
- **Auth Status Check**: On app load, checks `/api/auth/status` to determine if authentication is required; auto-authenticates when `AUTH_BACKEND=none`

### Changed
- `frontend/src/App.tsx` — Wrapped all routes in `<AuthProvider>`, renders `<LoginPage>` when unauthenticated instead of directly showing the dashboard
- `frontend/src/components/AppShell.tsx` — Added user badge, role display, sign-out button, and OpenVox logo to the header; uses `useAuth()` hook
- `frontend/src/services/api.ts` — Added `getAuthHeaders()` function; all `fetchJSON()` calls now include JWT auth headers; 401 responses trigger automatic logout

### Fixed
- Application was unusable with `AUTH_BACKEND=local` because no login page existed — all API calls returned 401 with no way to authenticate
- Frontend `dist/` directory permissions were too restrictive (`750`), preventing proper file serving

---

## [0.2.0] - 2025-02-09

### Added
- **Active User Sessions**: Track logged-in users with a 15-minute activity threshold, displayed on the dashboard (`backend/app/models/session.py`, `backend/app/services/auth_local.py`)
- **Report Detail Page**: Clickable report rows with full drill-down into individual Puppet runs (`frontend/src/pages/ReportDetail.tsx`)
  - Events tab: Resource-level changes with type, title, property, old/new values, file, and line number
  - Logs tab: Full Puppet agent log output with severity-level filtering
  - Metrics tab: Complete timing breakdown and resource count summary
- **Code Deployment Page**: GUI interface for triggering r10k Puppet code deployments (`frontend/src/pages/CodeDeployment.tsx`, `backend/app/routers/deploy.py`)
  - Deploy all environments or target a specific one
  - Repository discovery from r10k.yaml configuration
  - Real-time deployment output and exit codes
- **Deploy API**: `GET /api/deploy/environments`, `GET /api/deploy/repos`, `GET /api/deploy/status`, `POST /api/deploy/run`
- **Dashboard Active Sessions Widget**: `GET /api/dashboard/active-sessions` endpoint showing current active user count

### Changed
- Reports page rows are now clickable, navigating to `/reports/:hash` for detail view
- Node.js upgraded from v16 to v18 for frontend builds
- Dashboard services monitoring expanded

---

## [0.1.0] - 2025-02-08

### Added
- **Fleet Dashboard**: Real-time node status donut chart, report trend line charts, service health cards, environment overview
- **Performance Dashboard**: Run timing analysis, per-node comparisons, timing breakdown pie chart, resource count area chart, recent runs table
- **Node Management**: Node listing with status/environment filters, node detail page with facts, resources, and recent reports
- **Report Listing**: Filterable report list with status, certname, environment, and timestamp columns
- **External Node Classifier (ENC)**:
  - Node Groups with Puppet class and parameter management
  - Per-node Classifications with class picker from PuppetServer modules
  - Classification Rules with fact-based auto-classification and priority ordering
  - Available Classes browser scanning module manifests
  - ENC script (`scripts/enc.py`) for PuppetServer integration with fail-open design
- **Hiera Data Management**: Hierarchy editor, data file browser/editor with YAML validation and backup
- **Configuration Management**: PuppetServer config editor, PuppetDB config viewer, environment/module browser, service controls
- **Authentication**: Pluggable auth backends (none/local), htpasswd + bcrypt password hashing, JWT tokens, role-based access control (admin/operator/viewer)
- **User Management**: CLI tool (`scripts/manage_users.py`) and REST API for user CRUD
- **Installer**: Interactive and unattended install via `install.sh` with answer file support, systemd service, SELinux, and firewall configuration
- **API Documentation**: Auto-generated Swagger UI at `/api/docs` and ReDoc at `/api/redoc`

### Infrastructure
- FastAPI 0.104 + Uvicorn 0.24 backend (Python 3.8+)
- React 18 + TypeScript + Vite frontend
- Mantine UI v7 component library
- Recharts for data visualization
- SQLite via SQLAlchemy 2.0 + aiosqlite
- httpx 0.25 for async PuppetDB SSL communication
- Apache reverse proxy with SSL (Let's Encrypt)

---

<div align="center">

<sub>This document was created with the assistance of AI (Grok, xAI). All technical content has been reviewed and verified by human contributors.</sub>

</div>
