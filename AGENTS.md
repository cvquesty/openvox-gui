# OpenVox GUI Project Instructions

## Branching Strategy
- **Default branch is `main`** — staging branch has been removed
- All development and releases go through `main`

### 3.10 Alpha Refactor Effort (2026-06 onward)
For the current major development effort implementing recommendations from the subagent evaluation reports (stored in `~/Desktop/OpenVox/`):

- Create and work on dedicated alpha branches named **`3.10.a_r_alpha.N`** (where N starts at 1 and increments for each significant milestone or batch of changes).
- **Branch purpose**: Isolate all refactor, hardening, architecture, and UI/UX work based on the 2026-06 evaluation reports (Senior Developer, Software Architect, Systems Architect, Enterprise Architect, and UI/UX designers).
- **srdev1 security train marker (2026-06-25+):** Version strings **`3.10.01.aN`** (e.g. `3.10.01.a1`) track work from `srdev1-openvox-gui-domain-security-issues-senior-developer.md` while remaining on branch **`3.10.a_r_alpha.6`** (or later alpha.N). This is **not** a merge to `main` — a deliberate massive merge + final security scan happens only when that effort is complete.
- **Testing & Validation Policy (STRICT)**:
  - All testing and validation deploys are **only** performed against the lab/test server: `openvox.questy.org` (IP `10.0.100.225`).
  - Prefer explicit SSH for lab when default `ssh` fails (keys / IPv4):  
    `rsync -e '/usr/bin/ssh -4 -F /dev/null -o IdentitiesOnly=yes -i ~/.ssh/id_ed25519 -i ~/.ssh/id_rsa' …` then remote `sudo bash …/scripts/deploy.sh`.
  - Or: `OPENVOX_DEPLOY_HOST=10.0.100.225 OPENVOX_DEPLOY_USER=jsheets scripts/update_remote.sh --yes` when SSH agent/config works.
  - **Always** wrap lab deploys with the maintenance program first when using ovox on the server:
    - `ovox maintenance enable --message "Alpha refactor validation" --eta "XXm" --yes` (or equivalent)
    - Perform the deploy
    - Verify thoroughly
    - `ovox maintenance disable --yes`
  - **Never** push or deploy these alpha branches (or changes from them) to production infrastructure (e.g., xAI fleet servers).
  - **Never** merge alpha security/refactor work into **`main`** until the scheduled massive merge + final scan. Push **only** the active alpha branch (and its tags), not `main`.
- Changes are merged back toward `main` only after validation, review, and when a stable increment is ready.
- This strategy ensures zero impact on end-users during the dev effort. All work follows the full pre-commit checklist, `/commit` skill process, and meticulous verification.

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
  - **Every meaningful push increments the pre-release counter** (via the `/commit` skill + bump script) and pairs with: update CHANGELOG.md, conventional commit (with "Assisted By: Grok AI"), **annotated tag** (`v3.9.0-dev.42`), and push (branch + tag).
  - User explicit reminder: "remember to increment versions on every single push" + "PUSH EVERY TIME so I can deploy".
  - Pre-commit checklist from global AGENTS.md applies in addition (docs, bump script for GUI if root VERSION moves, etc.).
  - The project-scoped `/commit` skill (in `.grok/skills/commit/SKILL.md`) automates dev pre-release versioning, CHANGELOG, conventional commit, annotated tag, branch+tag push, active heredoc safety, and the final deploy step.
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
- **"Tag and push only" on every commit** for development (the standing rule for pre-release trains).
  - The `/commit` skill handles pre-release SemVer tags (e.g. `v3.9.0-dev.42`) + push during active work.
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

### Real Production Server (final / official deploys at xAI)
- Hostname: `openvox.pdxc-it.twitter.biz` (user has also written it as `openvox.opdxc-it.twitter.biz`)
- Access model: **Not directly SSH-reachable** from the development laptop.
- Must traverse a bastion/jump host first:
  - `wormhole-1.atlc-it.twitter.biz` (Atlanta)
  - `wormhole-2.pdxc-it.twitter.biz` (Portland)
- Typical real-world workflow: `ssh wormhole-1...` (or wormhole-2), then from the bastion `ssh openvox.pdxc-it.twitter.biz`.
- This is the server that runs the actual xAI / Twitter-internal OpenVox fleet. When the user talks about "production" or "final deploy," this (and its bastions) is what is meant.

**Rule for this project**: The deploy scripts in this repository (`update_remote.sh`, `deploy.sh`, `update_local.sh`, etc.) have historically been exercised almost exclusively against the test lab (10.0.100.225). Any claim that "we deployed X" in the context of openvox-gui work should default to "lab" unless the user explicitly states production bastion access was used.

Add a short clarifying sentence in any summary or release notes when discussing deployment behavior.

## Using the Commit Skill

Use `/commit` (the project-scoped skill in `.grok/skills/commit/SKILL.md`) to handle version increment, CHANGELOG update, conventional commit (with "Assisted By: Grok AI"), annotated tag, and push (branch + tag). It enforces the rules in the sections above plus the global pre-commit checklist, including active heredoc safety enforcement for shell script changes and driving the final deploy step.

GitHub Releases remain a separate, deliberate, manual step performed only when a tag is clean, tested, and explicitly "ready to ship".

The goal is to keep the development cadence fast (tag+push on every change) while making releases intentional and high-signal.
