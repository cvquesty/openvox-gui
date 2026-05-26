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
  - Always pair with: update CHANGELOG.md, conventional commit, push, then deploy.
  - User explicit reminder: "remember to increment versions on every single push" + "PUSH EVERY TIME so I can deploy".
  - Pre-commit checklist from global AGENTS.md applies in addition (docs, bump script for GUI if root VERSION moves, etc.).
