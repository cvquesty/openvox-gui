# OpenVox GUI Project Instructions

## Branching Strategy
- **Default branch is `main`** — staging branch has been removed
- All development and releases go through `main`

## Heredoc Safety (Important)

When writing files with heredocs in shell scripts (`install.sh`, `update_local.sh`, `deploy.sh`, etc.):

- **Default to quoted delimiters**: `cat > file << 'EOF' ... EOF`
- Only use **unquoted** heredocs (`<< EOF`) when you **explicitly** need shell variable expansion (`${VAR}`) or command substitution inside that block.
- Never put backticks (`` ` ``) or `$()` inside any heredoc content unless you deliberately want the shell to execute them at runtime.
- Add a `NOTE:` comment above every intentionally unquoted heredoc explaining why it must remain unquoted.

This rule was added after backticks in an unquoted sudoers heredoc caused installation failures on Ubuntu.

## Version Discipline (STRICT — standing order)
- **Increment version on EVERY meaningful push.**
  - ovox CLI has independent versioning via `ovox/VERSION` (also `__init__.py` + `pyproject.toml`).
  - Pattern: within a prerelease train use suffixes (e.g. `3.7.1-beta1` → `3.7.1-beta1-1`, `-2`, ...).
  - This applies to ovox features, bolt-plugin/openvox_enc fixes, auth changes, etc.
  - Always pair with: update CHANGELOG.md, conventional commit, **tag the commit**, and push (both branch and the new tag).
  - User explicit reminder: "remember to increment versions on every single push" + "PUSH EVERY TIME so I can deploy".
  - Pre-commit checklist from global AGENTS.md applies in addition (docs, bump script for GUI if root VERSION moves, etc.).

## Release Process (Tags vs. GitHub Releases)
- **"Tag and push only" on every commit** (the new standing rule).
  - After updating CHANGELOG, bumping version(s), and making a conventional commit:
    - Create an annotated tag: `git tag -a vX.Y.Z-N -m "..."` (following the hyphenated prerelease pattern).
    - `git push origin main && git push origin vX.Y.Z-N`
  - **Do not create a GitHub Release** (`gh release create`, polished notes, etc.) at this stage.
- GitHub Releases are a **separate, deliberate, atomic step**.
  - Only create a GitHub Release when the tag is clean, tested, and "ready to ship".
  - This can (and should) happen on a pre-determined release schedule or date/time.
  - Use `gh release create` (with proper title and notes) only at release time.
  - This prevents voluminous/noisy releases and gives us freedom to test/iterate on tags freely before "shipping" the official release artifact and announcement.
- Rationale (per user): Tags are lightweight and perfect for continuous testing/deployment. Full GitHub releases should only be produced when we're confident the tag represents a shippable state.

The goal is to keep the development cadence fast (tag+push on every change) while making releases intentional and high-signal.
