# OpenVox GUI Project Instructions

## Branching Strategy
- **Default branch is `main`** — staging branch has been removed
- All development and releases go through `main`

### 3.14.0 stable (current on `main` — 2026-09-21)

- **Current stable:** **3.14.0** (`v3.14.0`). Promotes the 3.13.0-rc.1–rc.32 train (no 3.13.0 GitHub Release).
- **AIO first:** most installs are all-in-one on the OpenVox Server host (SQLite OK).
- **Clustered optional:** dual console + VIP sessions, fleet exclude, ovox estate health, Bolt estate inventory, shared Postgres `openvox_gui`, `OPENVOX_GUI_PUPPET_CA_HOST`. See [docs/STATUS.md](docs/STATUS.md).
- **Next train:** after 3.14.0, daily work uses `3.14.1-dev.N` (or `3.15.0-rc.N` for a new minor). PEP 440 only. Never put `gamma` in `VERSION`.
- Pre-release counter on every meaningful push via bump + CHANGELOG + tag + **push branch and tags** + **lab deploy** to `openvox.questy.org` (`10.0.100.225`).

### Stable baseline and history

- **Current stable:** **3.14.0**. Live fleet = **`get_live_nodes()`** (active PuppetDB; DNS RR hide only; peer report merge) plus last-good VIP cache, lean PDB extract, agent-installer prune, Monitoring charts.
- **3.12.0:** prior clustered-console stable. **3.10.6:** prior AIO performance stable. **3.11.x:** historical clustered betas.
- **Prior stables:** **3.10.4**, **3.10.2**; old train markers are archaeology only.
- **Estate strategy (clustered):** build/validate the **new** multi-server estate; migrate nodes; repurpose legacy singleton as lab/dev. Do not treat in-place “upgrade production singleton to clustered” as the default path.
- **New large spike:** optional alpha branch with lab-only rules; otherwise commit on `main` with SemVer pre-releases (`3.14.1-dev.N`) via `/commit`.

**Lab / production discipline (still STRICT):**
- Primary validation deploys: lab **`openvox.questy.org`** (`10.0.100.225`) only unless the user names production bastion workflow.
- Prefer: `OPENVOX_DEPLOY_HOST=10.0.100.225 OPENVOX_DEPLOY_USER=jsheets scripts/update_remote.sh --yes` (PATH `/usr/bin` first if Homebrew SSH breaks routing).
- Maintenance wrapper on the server when using ovox: `ovox maintenance enable` → deploy → verify → `ovox maintenance disable`.
- **Never** confuse lab claims with production (`openvox.site-a.example.com` via bastion). See Infrastructure section below.

## Heredoc Safety (Important)

When writing files with heredocs in shell scripts (`install.sh`, `update_local.sh`, `deploy.sh`, etc.):

- **Default to quoted delimiters**: `cat > file << 'EOF' ... EOF`
- Only use **unquoted** heredocs (`<< EOF`) when you **explicitly** need shell variable expansion (`${VAR}`) or command substitution inside that block.
- Never put backticks (`` ` ``) or `$()` inside any heredoc content unless you deliberately want the shell to execute them at runtime.
- Add a `NOTE:` comment above every intentionally unquoted heredoc explaining why it must remain unquoted.

This rule was added after backticks in an unquoted sudoers heredoc caused installation failures on Ubuntu.

## Version Discipline (STRICT — standing order)
- **Use Semantic Versioning (SemVer) + pre-releases for all versioning.**
  - Format: `MAJOR.MINOR.PATCH` for stable releases (e.g. `3.9.0`).
  - During active development of a release train: use pre-release identifiers, e.g. `3.9.0-dev.1`, `3.9.0-dev.2`, ..., `3.9.0-beta.1`, `3.9.0-beta.2`, or `3.9.0-rc.1`.
  - ovox CLI is versioned in lockstep with the GUI (single source of truth: root `VERSION` file) as of 3.7.3. `scripts/bump-version.sh` keeps `ovox/VERSION`, `ovox/ovox/__init__.py`, `ovox/pyproject.toml`, `frontend/package.json`, and doc headers/examples in sync.
  - This applies to ovox features, bolt-plugin/openvox_enc fixes, auth changes, etc.
  - **Every meaningful change that lands on `main` increments the pre-release counter** and pairs with: update CHANGELOG.md, conventional commit (with "Assisted By: Grok AI"), and an **annotated tag on `main`** (`v3.9.0-dev.42`).
  - **Pull requests and agent branches do not bump `VERSION` and do not push tags.** The bump happens at merge time on `main`. Use `scripts/bump-version.sh next` (or an explicit version the guard accepts). Do not count upward from the `VERSION` file in a stale checkout: on 2026-10-07 a branch cut from `3.14.1-dev.1` reused `dev.2` and `dev.3`, which already existed as remote tags, so those CHANGELOG headings do not describe the tagged commits. The tags were not moved.
  - `scripts/bump-version.sh next` sets `X.Y.Z-dev.N` to one past the maximum of remote `vX.Y.Z-dev.*` tags and `origin/main`'s `VERSION`. When `origin/main` is a final `X.Y.Z`, the next patch train starts at `X.Y.(Z+1)-dev.N`. The script refuses to write a version that is not strictly greater than `origin/main` (PEP 440 order; `dev.10` is newer than `dev.9`) or whose remote tag already exists (`v<version>` or `<version>`).
  - CI (`scripts/ci-version-guard.sh`, run from `scripts/ci-quality.sh`) fails a pull request that changes `VERSION` to a value that is not strictly greater than `origin/main`, or that already has a remote tag. A pull request that does not change `VERSION` passes, including one branched from an older dev number.
  - User explicit reminder: "remember to increment versions on every single push" + "PUSH EVERY TIME so I can deploy". That increment is the merge onto `main`, not a second counter on the pull-request branch.
  - Pre-commit checklist from global AGENTS.md applies in addition (docs, bump script for GUI if root VERSION moves, etc.).
  - On `main`, the project-scoped `/commit` skill (in `.grok/skills/commit/SKILL.md`) automates the dev-number bump, CHANGELOG, conventional commit, annotated tag, push, active heredoc safety, and the final deploy step. It is not used to bump `VERSION` or push tags from a pull-request branch.
  - Use the separate project-scoped `/release` skill (in `.grok/skills/release/SKILL.md`) to promote a completed pre-release train to a clean stable SemVer version (e.g. `3.9.0`), update CHANGELOG if needed, create the final annotated tag, push the tag, and prepare for manual GitHub Release.
- As part of release process (per enterprise architect P1.9): generate and publish SBOM (e.g. using `syft` or `cyclonedx`), include provenance. Update installer to support --require-hashes where possible.

## Using the Release Skill
- Run `/release` when a dev train (series of `-dev.N` / `-beta.N` etc. commits) is ready for users.
- It will:
  - Determine the next stable SemVer (strip pre-release suffix or apply promotion rules such as incrementing minor and resetting patch).
  - Ensure CHANGELOG reflects the release.
  - Create the clean annotated tag (e.g. `v3.9.0`).
  - Push the tag.
  - Remind that GitHub Releases (`gh release create`) are a separate, deliberate, manual step only when the tag is clean/tested/"ready to ship" (typically on a schedule).
- Never auto-create GitHub Releases from the skill or commit flow.

## Release Process (Tags vs. GitHub Releases)
- **"Tag and push only" when the change lands on `main`** for development (the standing rule for pre-release trains).
  - The `/commit` skill handles pre-release SemVer tags (e.g. `v3.9.0-dev.42`) + push of `main`. Pull-request branches do not push tags.
  - **Do not create a GitHub Release** (`gh release create`, polished notes, etc.) at commit time. The `/commit` and `/release` skills explicitly exclude this.
- Use the `/release` skill to promote a completed pre-release train to a stable SemVer tag (e.g. `v3.9.0`).
- GitHub Releases are a **separate, deliberate, atomic step**.
  - Only create a GitHub Release (via `gh release create` with proper title/notes) when the stable tag is clean, tested, and explicitly "ready to ship".
  - This can (and should) happen on a pre-determined release schedule or date/time.
  - This prevents voluminous/noisy releases and gives us freedom to test/iterate on tags freely before "shipping" the official release artifact and announcement.
- **Press release / announcement document** (new regular step for official GitHub releases).
  - As part of preparing every official GitHub release, create (or update) the press release announcement document at `docs/releases/press_<version>.md` (e.g. `press_3.9.2.md`).
  - Use the established template and structure from `docs/releases/press_3.6.2.md` or (preferred for new releases) start from `docs/releases/TEMPLATE.md`. It provides ready-to-paste, platform-optimized copy for:
    - GitHub Discussions (canonical long post)
    - VoxPupuli Connect / Discourse
    - Slack
    - Reddit (r/sysadmin, r/Puppet, etc.)
    - Mastodon
    - X/Twitter thread
    - LinkedIn
    - Hacker News (optional Show HN)
  - The document leads with the headline user-facing feature(s), links to the release and relevant docs, and keeps internal dev-train / pre-release churn in the CHANGELOG only.
  - Treat press document creation as part of the "official release" preparation alongside `gh release create`. This ensures every shippable stable release gets a complete announcement kit.
- Rationale (per user): Lightweight pre-release tags are perfect for continuous testing/deployment. Full GitHub releases should only be produced when we're confident the (clean SemVer) tag represents a shippable state for users. Pairing each official release with a press document keeps community communication consistent and high-signal.

## Infrastructure & Deployment Targets (Test Lab vs Real Production)

**Critical distinction — do not confuse these in any reporting, commit messages, or future work.**

### Test-only / Isolated Lab Server (what almost all openvox-gui development deploys have targeted)
- Hostname: `openvox.questy.org`
- IP: `10.0.100.225`
- SSH: Direct (`jsheets@openvox` or `jsheets@10.0.100.225`)
- Purpose: Personal development and testing lab.
- Typical deploy command used with this repo:
  ```bash
  OPENVOX_DEPLOY_HOST=10.0.100.225 OPENVOX_DEPLOY_USER=jsheets scripts/update_remote.sh --yes
  ```
- **WARNING**: This server is **not** production. Scale, certificate volume, performance characteristics, and any deployed state here must be clearly labeled "lab" or "test server" when discussing or reporting work.

### Real Production Server (final / official production deploys)
- Hostname: `openvox.site-a.example.com`
- Access model: **Not directly SSH-reachable** from the development laptop.
- Must traverse a bastion/jump host first:
  - `bastion-east.example.com` (site B)
  - `bastion-west.example.com` (site A)
- Typical real-world workflow: `ssh bastion-east...` (or bastion-west), then from the bastion `ssh openvox.site-a.example.com`.
- This is the server that runs the official production OpenVox fleet. When the user talks about "production" or "final deploy," this (and its bastions) is what is meant.

**Rule for this project**: The deploy scripts in this repository (`update_remote.sh`, `deploy.sh`, `update_local.sh`, etc.) have historically been exercised almost exclusively against the test lab (10.0.100.225). Any claim that "we deployed X" in the context of openvox-gui work should default to "lab" unless the user explicitly states production bastion access was used.

Add a short clarifying sentence in any summary or release notes when discussing deployment behavior.

## Using the Commit Skill

On `main`, `/commit` (the project-scoped skill in `.grok/skills/commit/SKILL.md`) handles the dev-number bump, CHANGELOG update, conventional commit (with "Assisted By: Grok AI"), annotated tag, and push. Pull-request and agent branches do not bump `VERSION` or push tags. The skill also enforces the rules in the sections above plus the global pre-commit checklist, including active heredoc safety enforcement for shell script changes and driving the final deploy step.

GitHub Releases remain a separate, deliberate, manual step performed only when a tag is clean, tested, and explicitly "ready to ship".

The goal is to keep the development cadence fast (tag+push on every change) while making releases intentional and high-signal.

## Continuous Integration

- Workflow: `.github/workflows/ci.yml` (push/PR/`workflow_dispatch` on `main`).
- Jobs: backend pytest + ruff, frontend typecheck/vitest/build, shell syntax, bolt-plugin Ruby tests, VERSION lockstep / dev-version guard / leak scan.
- Security audits remain in `.github/workflows/security.yml`.
- Local equivalent: `./scripts/run-ci-local.sh`. Map: [docs/TESTING.md](docs/TESTING.md).
- A `/commit` that adds or changes tests must leave CI green on GitHub; iterate on the workflow until it is.
