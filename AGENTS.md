# OpenVox GUI Project Instructions

## Branching Strategy
- **Default branch is `main`** — staging branch has been removed
- All development and releases go through `main`

## Version Discipline (STRICT — standing order)
- **Increment version on EVERY meaningful push.**
  - ovox CLI has independent versioning via `ovox/VERSION` (also `__init__.py` + `pyproject.toml`).
  - Pattern: within a prerelease train use suffixes (e.g. `3.7.1-beta1` → `3.7.1-beta1-1`, `-2`, ...).
  - This applies to ovox features, bolt-plugin/openvox_enc fixes, auth changes, etc.
  - Always pair with: update CHANGELOG.md, conventional commit, push, then deploy.
  - User explicit reminder: "remember to increment versions on every single push" + "PUSH EVERY TIME so I can deploy".
  - Pre-commit checklist from global AGENTS.md applies in addition (docs, bump script for GUI if root VERSION moves, etc.).
