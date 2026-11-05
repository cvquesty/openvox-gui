# OpenVox GUI Backup & Restore (design, 3.15.0-a.1 train)

Status: design, approved by Jerald 2026-11-04. Branch: `feature/backup_system`.
Merges to `main` once, when the feature is complete and the merge is clean.

## Goals

- An admin can `ovox login`, run one command, and get a complete, encrypted,
  versioned backup of OpenVox GUI and its config.
- Restore brings a dead console back to a usable state after a catastrophic failure.
- Everything is scriptable (`--json`, real exit codes) and automatable (systemd timer).
- Tier 2 extends the same mechanism to the whole OpenVox estate (AIO or clustered).
  A restored estate must be usable even if PuppetDB history is lost.

## Decisions (locked)

| Topic | Decision |
|-------|----------|
| Encryption | Always on. Passphrase in `config/backup.conf` (0600, service user). Never inside the archive. |
| Storage | Local disk only. Retention: last 5. |
| App DB | Included: SQLite online `.backup` (AIO) or `pg_dump -Fc` of `openvox_gui` (clustered). |
| PuppetDB | Rebuildable. No `puppetdb` dump. Node data refills as agents check in. CA + certs are kept. |
| Bolt creds | `id_bolt` and `.bolt_token` included (archive is encrypted). |
| TLS keys | GUI TLS key and Puppet client key included. |
| `config/.credentials` | Excluded (installer tells admins to delete it). |
| Version | `3.15.0-a.1`, then `-a.N`. |

## Architecture

One backend backup service. `ovox backup` and **Settings → Backup** are thin clients
of the same API, so the CLI and UI cannot drift.

```text
ovox backup ...  ─┐
                  ├─► FastAPI /api/v1/backups ─► backup service ─► collectors
Settings → Backup ┘                                   │              ├─ gui (Tier 1)
                                                      │              └─ estate (Tier 2, Bolt)
                                                      ▼
                                   /opt/openvox-gui/data/backups/system/<id>.ovbk
```

`data/backups/` already exists (infra tuning). This feature uses its own
subdirectory `data/backups/system/` so the two never collide.

## Archive format

`<UTC timestamp>-<scope>-<host>.ovbk` = encrypted (age, passphrase mode) `tar.zst`.

```text
manifest.json
db/openvox_gui.sqlite | db/openvox_gui.pgdump
files/<absolute path mirrored>...
```

`manifest.json`: format version, GUI `VERSION`, alembic revision, scope
(`gui`|`estate`), mode (`single`|`clustered`), hostname, created_at (UTC),
created_by, label, and a sha256 + mode + owner for every entry.

## Tier 1 inventory (GUI)

Paths from `install.sh` and `backend/app/config.py` on `main`.

| Path | Notes |
|------|-------|
| `/opt/openvox-gui/config/.env` | `OPENVOX_GUI_SECRET_KEY`, `OPENVOX_GUI_DATABASE_URL`, SSL paths, all settings |
| `/opt/openvox-gui/data/openvox_gui.db` | AIO default DB; taken via SQLite `.backup`, never a file copy |
| Postgres `openvox_gui` | Clustered; `pg_dump -Fc` once per cluster against the shared DB |
| `/opt/openvox-gui/data/cluster_config.json` | Topology, VIPs (lives in `data/`, not `config/`) |
| `/opt/openvox-gui/data/reports/`, `data/host_metrics/` | App data |
| systemd: `openvox-gui.service`, fleet-health and repo-sync `.service`/`.timer` | Plus `openvox-pkgs-webserver.conf` |
| `/etc/puppetlabs/bolt/` | `inventory.yaml`, `bolt-project.yaml`, `openvox-gui-estate.yaml`, `modules/openvox_enc`, `id_bolt`, `.bolt_token` |
| GUI TLS cert/key | `ssl_cert_path`/`ssl_key_path` from `.env`; `/etc/letsencrypt/live/<host>` if LE |
| Puppet client cert/key | `/etc/puppetlabs/puppet/ssl/{certs,private_keys}/localhost.pem` (default) |

**Excluded:** `config/backup.conf` (passphrase), `config/.credentials`, the package
mirror (rebuildable, large), `venv/`, `frontend/dist/`, `logs/`, `data/maintenance.*`,
`data/backups/`.

## Tier 2 inventory (estate, ships second)

`ovox backup create --scope estate` runs a Bolt plan per role from
`cluster_config.json` (or localhost on AIO). Each node encrypts before transfer.

| Role | Collected |
|------|-----------|
| CA | `puppetserver ca` dir (crown jewels: CA key, signed certs, CRL, inventory) |
| Server / compilers | `puppet.conf`, `auth.conf`, `hiera.yaml`, `custom_trusted_oid_mapping.yaml`, r10k config, puppetserver conf.d |
| PuppetDB | Config only (`puppetdb` data is rebuildable) |
| Code | Control repo git ref per environment only (restored by r10k) |

Restore order: CA → databases → servers/compilers → GUI.

## CLI

```text
ovox backup create [--scope gui|estate] [--label TEXT]
ovox backup list | show <id> | download <id> [--output PATH]
ovox backup verify <id|file>
ovox backup prune [--keep 5]
ovox restore <id|file> [--dry-run] [--yes]
```

All take `--json`. Exit codes: 0 ok, 1 failure, 2 verify failed, 3 version/mode mismatch.

## API (admin only, `/api/v1/backups`)

`POST /` create (scope, label) → job id · `GET /` list · `GET /{id}` manifest ·
`GET /{id}/download` · `POST /{id}/verify` · `POST /{id}/restore` (`dry_run`;
a real restore needs the confirm token issued by a dry run) · `DELETE /{id}` ·
`PUT /policy` (retention, schedule).

## Restore safety

1. Raise the maintenance flag (existing maintenance program).
2. Decrypt; wrong passphrase fails with no writes.
3. Verify every sha256; reject `../`, absolute paths, and symlinks.
4. Refuse a newer schema or the other mode (AIO vs clustered).
5. Take an automatic pre-restore backup of current state.
6. Write files, restore DB, run `alembic upgrade head`, restart, clear the flag.

**Clustered restore:** exactly one console holds the maintenance lock and performs
the restore against the shared `openvox_gui` DB; every other console stays stopped
until it finishes, then starts with the same `SECRET_KEY` and DSN.

**Verify test-decrypts:** `ovox backup verify` (and every scheduled create) decrypts
and checksums the archive, so a wrong or lost passphrase fails at backup time,
not during a disaster.

## Security

- Admin role only; restore and download require fresh re-auth; every call audited.
- Passphrase never stored in the app DB, archive, or logs. **Escrow it off the box**:
  if the host dies, the passphrase dies with it.
- Download over TLS only, archive already encrypted.
- No real backup content in tests, fixtures, or docs; obvious fakes only.

## Automation

```bash
ovox token generate --user backup --name "Nightly backup" --expires 0
```

Ship `openvox-gui-backup.service` + `.timer` (nightly), running
`ovox backup create --json && ovox backup prune --keep 5`.

## Required tests (review gate)

- Wrong passphrase: non-zero exit, no partial writes, state untouched.
- Tampered archive fails checksum.
- Newer schema or other-mode archive rejected.
- `../` paths or symlinks rejected.
- Retention keeps exactly the last 5.
- Passphrase never appears in the archive or logs.
- Backup, wipe, restore round trip on SQLite and Postgres in CI.

## Slices (PRs into `feature/backup_system`)

1. Version bump to `3.15.0-a.1` + this doc.
2. Backend service + API + `ovox backup`/`ovox restore` (Tier 1).
3. Settings → Backup page.
4. Tier 2 estate collectors (Bolt).
