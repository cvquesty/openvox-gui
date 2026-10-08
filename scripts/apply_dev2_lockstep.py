#!/usr/bin/env python3
"""Apply remaining 3.14.1-dev.2 lockstep + Mantine 9 API edits. Idempotent."""
from pathlib import Path

def sub_file(path: str, old: str, new: str, count: int = 1) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if old not in text:
        print(f"skip (already applied or missing): {path}")
        return
    p.write_text(text.replace(old, new, count), encoding="utf-8")
    print(f"updated {path}")

sub_file("README.md", "version-3.14.1--dev.1-orange", "version-3.14.1--dev.2-orange", 1)

for doc in ("INSTALL.md", "UPDATE.md", "TROUBLESHOOTING.md"):
    sub_file(doc, "**OpenVox GUI Version 3.14.0**", "**OpenVox GUI Version 3.14.1-dev.2**", 1)

replacements = [
    ("frontend/src/pages/Installer.tsx", '<Grid gutter="md">', '<Grid gap="md">'),
    ("frontend/src/pages/Installer.tsx", '<Grid gutter="xs">', '<Grid gap="xs">'),
    ("frontend/src/pages/ConfigApp.tsx", '<Grid gutter="md">', '<Grid gap="md">'),
    ("frontend/src/pages/FactExplorer.tsx", '<Grid gutter="xs">', '<Grid gap="xs">'),
    ("frontend/src/pages/Nodes.tsx", "<Collapse in={isExpanded}>", "<Collapse expanded={isExpanded}>"),
    ("frontend/src/pages/CertAudit.tsx", "<Collapse in={showHealthy}>", "<Collapse expanded={showHealthy}>"),
    ("frontend/src/pages/MetricsCompliance.tsx", "<Collapse in={open}>", "<Collapse expanded={open}>"),
    ("frontend/src/pages/Reports.tsx", "<Collapse in={isExpanded}>", "<Collapse expanded={isExpanded}>"),
    ("frontend/src/pages/ConfigApp.tsx", "<Collapse in={form.use_ssl || form.use_starttls}>", "<Collapse expanded={form.use_ssl || form.use_starttls}>"),
    ("frontend/src/pages/ConfigApp.tsx", "<Collapse in={form.use_ad_upn}>", "<Collapse expanded={form.use_ad_upn}>"),
    ("frontend/src/pages/ConfigApp.tsx", "<Collapse in={newAuthSource === 'local'}>", "<Collapse expanded={newAuthSource === 'local'}>"),
]
for path, old, new in replacements:
    sub_file(path, old, new, 1)

cl = Path("CHANGELOG.md")
text = cl.read_text(encoding="utf-8")
if "## [3.14.1-dev.2]" not in text:
    insert = """## [3.14.1-dev.2] - 2026-09-22 (dev — latest packaging that works together)

Policy this snapshot: take current releases that install together and have no published advisories. Train breakage is OK if we can fix forward. Follows 3.14.1-dev.1.

### Changed
- **Backend:** `python-json-logger` 3.2.1 → 4.2.0 (leaves CVE-2025-27607 / GHSA-wmxh-pxcx-9w24). `cryptography` 50.0.0 → 50.0.1. `matplotlib` `>=3.8` → `>=3.10,<3.11` (3.8/3.9 EOL; keep Python 3.10 wheels). Did **not** take #93 `>=3.11.2`.
- **Frontend suite:** Mantine `core`/`hooks`/`notifications`/`dropzone` 7.17.8 → **9.6.2**. Recharts 2.15 → **3.10.1** + `react-is` ^19.2.8. `postcss-preset-mantine` 1.12.0 → 1.18.0.
- **Mantine 9 API:** `Grid gutter` → `gap`; `Collapse in` → `expanded`.
- **CI:** `.github/workflows/regen-lockfile.yml` regenerates `frontend/package-lock.json` on Node 22. No laptop `npm install` handshake.

### Not in this snapshot
- Dropping the Python 3.10 floor
- #79 offline/container bundle (docs only)

## [3.14.1-dev.1] - 2026-09-22 (dev — compatible pins + air-gap docs)

Opened the 3.14.1 patch train after **3.14.0**. Compatible pins from Dependabot #90–#99; Dependabot lockfiles not merged.

### Changed
- `#97` `@vitejs/plugin-react` 6.1.0 → 6.1.1
- `#94` `@xyflow/react` 12.11.3 → 12.11.6
- `#96` `certifi` 2026.5.20 → 2026.7.22
- `#92` `typer` ≥ 0.12.0 → ≥ 0.27.2
- `#90` `pytest-cov` ≥ 5.0,<7 → ≥ 7.1.0,<8 (CI only)

### Not applied this snapshot (later taken in 3.14.1-dev.2 unless noted)
- `#93` matplotlib ≥ 3.11.2 (Python 3.10 floor — still declined)
- `#91` / `#99` Mantine 7 → 9
- `#98` Recharts 2 → 3
- `#95` python-json-logger 3 → 4

### Docs
- Air-gapped GUI install (#79) is not supported this train; use proxy + allowlisted endpoints in INSTALL.md.

"""
    needle = "## [3.14.0] - 2026-09-21 (stable — clustered ops, lean PDB, agent installer)"
    if needle not in text:
        raise SystemExit("CHANGELOG needle missing")
    cl.write_text(text.replace(needle, insert + needle, 1), encoding="utf-8")
    print("CHANGELOG inserted")
else:
    print("CHANGELOG already has 3.14.1-dev.2")

print("apply_dev2_lockstep: done")
