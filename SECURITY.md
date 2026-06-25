# Security Policy

## Supported Versions

We actively support security and operational updates for the latest stable and pre-release versions in the current major series.

| Version | Supported          |
| ------- | ------------------ |
| **3.10.x** stable (current: **3.10.2**) and newer | :white_check_mark: |
| 3.10.x pre-releases / betas (e.g. `3.10.1.b2`) while testing | :white_check_mark: (lab/test only) |
| 3.9.x | :white_check_mark: (security fixes as feasible; prefer upgrade to 3.10.2+) |
| 3.0 – 3.8.x | Limited — upgrade when you can |
| < 3.0   | :x: (end of life)  |

We recommend running the **latest stable** GitHub Release ([v3.10.2](https://github.com/cvquesty/openvox-gui/releases/tag/v3.10.2) as of this policy refresh). Use pre-release tags only on lab/test systems unless you have a deliberate beta rollout. Patch releases within a minor series receive priority security backports where feasible.

## Reporting a Vulnerability

The safety of users' Puppet/OpenVox infrastructure is paramount. We appreciate responsible disclosure.

### Preferred Method (Private)

1. Navigate to the repository's [Security Advisories](https://github.com/cvquesty/openvox-gui/security/advisories) page.
2. Click **"Report a vulnerability"**.
3. Provide a detailed report including:
   - Affected version(s) and component (backend, ovox CLI, frontend, installer, etc.).
   - Steps to reproduce.
   - Potential impact (e.g., information disclosure, privilege escalation, symlink attacks).
   - Suggested fix or mitigation if known.

This uses GitHub's private vulnerability reporting system, creating a temporary private fork for discussion between the reporter and maintainers.

### Alternative Contact

For very sensitive reports or if the GitHub form is unavailable:
- Email: questy@gmail.com
- Include "SECURITY" in the subject.
- We will respond within 48 hours (business days).

**Do not** disclose vulnerabilities publicly (e.g., via GitHub issues, social media, or blog posts) until we have had a chance to investigate, patch, and coordinate a release. We follow a standard coordinated disclosure timeline (typically 90 days or less for critical issues, adjusted for severity and complexity).

## What to Expect

- **Acknowledgment**: Within 1-2 business days.
- **Initial Assessment**: We will confirm validity, severity (using CVSS where applicable), and affected components.
- **Fix Development**: We prioritize security fixes. For dependency issues (e.g. pydantic ecosystem), we update pins and test compatibility.
- **Release**: A patch release (or pre-release tag) will be issued. The advisory will be published on GitHub once the fix is available in a tagged release.
- **Credit**: Reporters are credited in the advisory and CHANGELOG unless they request anonymity.

## Security Update Process

- **Dependencies**: We use Dependabot for automated alerts on direct dependencies. Critical security updates (e.g., GHSA advisories) are reviewed and merged promptly.
  - Example: `pydantic-settings` 2.14.1 → 2.14.2 (this release) fixes GHSA-4xgf-cpjx-pc3j.
    - **Details**: The `NestedSecretsSettingsSource` (activated via `secrets_nested_subdir=True` or related configuration in pydantic-settings) could follow symbolic links outside the configured `secrets_dir`. This allowed reading files outside the intended directory tree and potentially bypassed `secrets_dir_max_size` limits. Affected: pydantic-settings >=2.12.0 and <2.14.2.
    - **Why it matters here**: The main `Settings` class (`backend/app/config.py`) inherits from `pydantic_settings.BaseSettings` and loads from `env_file`. While we do not currently enable `secrets_dir` / nested secrets in production config paths, transitive use, future features, or user extensions could trigger the vulnerable code path. Updating eliminates the risk proactively.
    - **Operational note**: This is both a security and operational update—keeping the pydantic ecosystem current ensures compatibility with FastAPI, type validation, and settings sources used across models, routers, and CLI config.
- **Code Audits**: Historical internal security audits are documented in `docs/audits/`. All high/critical findings from prior audits have been addressed (e.g., explicit role-based auth on privileged actions).
- **Ongoing**: We monitor for issues in:
  - Core: FastAPI, Uvicorn, Pydantic (core + settings), SQLAlchemy, Cryptography, PyJWT, etc.
  - CLI (ovox): Typer, Pydantic, Rich, HTTPX.
  - Frontend: Vite, React ecosystem (npm audit).
  - System: Installer scripts, sudoers rules, service units.
- Pins in `backend/requirements.txt` and `ovox/pyproject.toml` are the source of truth. The installer and packaging use these.

## Mitigations and Best Practices for Deployments

- Run behind a reverse proxy with TLS (see `docs/INSTALLER.md`, nginx/Apache configs).
- Use strong, unique values for `OPENVOX_GUI_SECRET_KEY`, admin passwords, and `deploy_webhook_secret`.
- Restrict network access to the service port (default 4567) and Puppet ports.
- Regularly run `sudo ./scripts/update_remote.sh --yes` (or equivalent) after reviewing release notes.
- For air-gapped or high-security environments: review vendored packages and consider vendoring the entire venv.
- Avoid running with `AUTH_BACKEND=none` in production (the app emits warnings and refuses in non-debug mode).
- Keep the underlying OS, Python, and system packages updated.

## Scope

This policy covers the openvox-gui repository, including:
- Backend (FastAPI app, config loading via pydantic-settings)
- ovox CLI and TUI
- Installer and update scripts (`install.sh`, `update_*.sh`, etc.)
- Frontend build and assets
- Supporting configs (systemd, Apache/nginx, sudoers)

It does **not** cover:
- Third-party Puppet/OpenVox modules or control repos you manage with the tool.
- The underlying Puppet Server, PuppetDB, or r10k (report those to their respective projects or Vox Pupuli).

## Questions?

Open a non-security GitHub issue or discussion, or contact the maintainer.

Thank you for helping keep OpenVox GUI and the broader infrastructure management ecosystem secure.

---

*Last updated: 2026-06-22 (in conjunction with pydantic-settings security patch and SECURITY.md addition). See CHANGELOG.md for related dependency and hardening history.*