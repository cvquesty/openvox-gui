# ovbuilder → openvox-gui port plan

**Owner:** Jerald · **Train:** 3.15.0 alphas on `feature/ovbuilder` ([#172](https://github.com/cvquesty/openvox-gui/pull/172))
**Source studied:** [openvox-ovbuilder](https://github.com/cvquesty/openvox-ovbuilder)
`0.97-beta33` (CLI `ovbuilder/`, web `web/`, `terraform/modules/vm`, `packer/`).
Operator guide for what shipped: [PROVISIONING.md](PROVISIONING.md).

## Decisions (Jerald, 2026-11-06)

| # | Question | Decision | Where it landed |
|---|----------|----------|-----------------|
| 1 | Credential storage | One shared vCenter service account, password encrypted in the app DB | Connection password in `cluster_secrets` (Fernet), write-only API |
| 2 | Cert signing | Per-build security: a CSR challenge verified at sign time, not certname + timing | `csr.py`: random token → `challengePassword` via guestinfo; only sha256 stored; CSR fetched from the CA and checked before `sign`; mismatch rejected and audited; guestinfo userdata scrubbed afterwards |
| 3 | Bootstrap routing | VLAN routes to the console on 4567 and to compilers/CA on 8140 are confirmed | Documented as a prerequisite in PROVISIONING.md |
| 4 | Template prefix | `ovbuilder-` is the default | VMware connection option `template_prefix`, default `ovbuilder-` |
| 5 | Who may build | admin and operator | Unchanged RBAC |
| 6 | VM name | The FQDN | VM name = certname; the separate VM-name field is gone |
| 7 | Several vCenters | One works now; model and API ready for more | `provision_connections` entity with id + default flag; jobs, inventory and builds reference a connection id |
| — | Bare metal ([#173](https://github.com/cvquesty/openvox-gui/issues/173)) | Not built now; keep the builder provider-agnostic | Provider interface below |
| — | Navigation | Lives on **Infrastructure → Provisioning** for the alpha/beta cycle | Renamed now (below) |

## Architecture: shared core + providers

Bare-metal provisioning is backlog ([#173](https://github.com/cvquesty/openvox-gui/issues/173))
and is **not** implemented. The builder is structured so it can plug in
without a rewrite:

```
backend/app/services/provisioning/
  netspec.py      shared  hostname / IPv4 / prefix / DNS validation
  cloudinit.py    shared  first-boot payload (network, proxy, DNF, SSH keys, agent)
  csr.py          shared  per-build CSR challenge + verification
  provision.py    shared  request validation + pipeline (validate → provision → guest → certificate → classify)
  jobs.py         shared  provision_jobs rows, CA / OpenVoxDB / ENC hooks, runner
  config_store.py shared  provision_connections + guest defaults, encrypted secrets
  providers/
    base.py       Provider / ProviderSession interface, ConnectionInfo, ProvisionSpec, NicSpec, GuestPayload
    __init__.py   registry (PROVIDERS = {"vmware": ...})
    vmware/       vCenter: pyVmomi client, fake, guestinfo delivery, placement checks
```

**Provider interface** (`providers/base.py`):

| Concern | Method |
|---------|--------|
| Connection | `Provider.normalize_options()`, `Provider.open(connection, secret)` / `open_fake()` |
| Inventory | `ProviderSession.scopes()`, `inventory(scope)`, `images()` |
| Placement | `Provider.normalize_placement()` (static), `ProviderSession.check_placement(spec)` (live) |
| Provision | `name_in_use()`, `provision(ProvisionSpec)` → `ProvisionResult`, `instance_state()` |
| Payload delivery | VMware: guestinfo in `provision()`; `scrub_payload()` after the CSR |
| Power / lifecycle | `power()`, `snapshot()`, `destroy()`; `InstanceNotFound` when the machine is gone |

**Shared, not per provider:** the build form's base fields (identity, NICs'
addressing, size), the cloud-init payload, the OpenVox bootstrap and CSR-token
flow, job tracking, CA signing, and the classifier handoff. Placement is an
opaque `Dict[str, str]` the shared code never reads; NIC networks are provider
ids. A bare-metal provider would add `providers/baremetal/` (e.g. Redfish:
inventory = BMCs/hosts, image = install media or PXE profile, payload =
NoCloud seed, power via BMC), register it, and add a placement component to
the UI next to `VmwarePlacement.tsx`. Its connection is another
`provision_connections` row with a different `provider`.

## Navigation and naming

Jerald's direction: the builder lives on **Infrastructure → Provisioning** for
its alpha/beta cycle, matching the multi-provider design.

**Renamed now** (alpha.2), because nothing had shipped yet and this increment
already reworked every layer for the provider interface:

| Layer | Before (alpha.1) | Now |
|-------|------------------|-----|
| Nav label / page title | VM Builder | **Provisioning** |
| Route | `/vmbuilder` | `/provisioning` (`/vmbuilder` redirects) |
| Command palette | VM Builder | Provisioning (keywords keep "vm builder", "vmware", "bare metal") |
| API | `/api/vmbuilder/*` | `/api/provisioning/*` |
| Backend package / router | `services/vmbuilder`, `routers/vmbuilder.py` | `services/provisioning`, `routers/provisioning.py` |
| Tables | `vm_build_jobs` | `provision_jobs`, `provision_connections` (alembic `006_provisioning`) |
| Dev flag | `OPENVOX_GUI_VMBUILDER_FAKE` | `OPENVOX_GUI_PROVISIONING_FAKE` |
| Operator doc | `docs/VM_BUILDER.md` | `docs/PROVISIONING.md` |

VMware-specific names stay VMware: `providers/vmware/`, `PyVmomiClient`,
`FakeVCenterClient`, `VmwarePlacement.tsx`, "vCenter placement", "Build VM".
Once a second provider exists, the Build tab gets a provider/connection picker
first and loads that provider's placement component; tabs stay
Build / Builds / Settings (+ Machines for lifecycle).

## How ovbuilder works (what was reused)

| Concern | ovbuilder | openvox-gui |
|---------|-----------|-------------|
| vCenter library / session | pyVmomi `SmartConnect`, one session per operation, `Disconnect` in `finally` | Same (`providers/vmware/pyvmomi_client.py`), one session per API call or build step, in a worker thread |
| Credentials | Prompted or env / `secrets.env`; web stores the password on the job row | Connection password Fernet-encrypted in `cluster_secrets`, never on the job row, never returned or logged |
| TLS | `ignore_ssl=True` by default | Verify by default; per-connection toggle + CA bundle |
| Inventory | Datacenters, DRS clusters, standalone hosts, datastores, Storage DRS pods, networks, `ovbuilder-*` templates | Same, plus resource pools and VM folders; picks carry managed object ids |
| Fail before create | `require_template`, `classify_compute` | `check_against_inventory`: compute, pool owner, folder, datastore mounted, networks attached, template allowed, name free |
| Clone | Terraform `vsphere_virtual_machine` | `CloneVM_Task` / Storage DRS with the same semantics; NICs re-backed / added; disk `max(requested, template)`; `disk.EnableUUID` |
| Guest identity | cloud-init guestinfo; network renderer disabled; `ovbuilder-net.sh` edits the existing NIC | Same design, multi-NIC, DNS search domains, gateway must be on-link |
| Agent install | cloud-init `runcmd` runs GUI `install.bash` with a hard-coded site table | Same, with the Agent Install page's live values, `main:certname=<fqdn>`, per-build challenge |
| Cert signing | Manual | Challenge-verified auto-sign, else manual |
| Classification | None | Wait for first report, then optional ENC environment + groups |
| Job runner | Celery + Redis + Postgres, caps, cancel, webhook | `provision_jobs` queue + `openvox-gui-provisioner` service (atomic claim), caps, cancel |

## Feature parity and status

| ovbuilder capability | Status |
|----------------------|--------|
| Golden template clone, inventory pickers, pre-flight checks | Done (alpha.1) |
| Static IPv4 / netmask / gateway / DNS, FQDN identity | Done (alpha.1) |
| Sizing, disk never shrinks | Done (alpha.1) |
| SSH keys, HTTP proxy, DNF groups | Done (alpha.1) |
| Multiple networks / NICs | Done (alpha.2) |
| Several vCenters | Model + API (alpha.2); one used per build |
| Cross-datacenter template clone | Listed; lab validation pending |
| Opt-in password SSH (golden password) | Not ported on purpose |
| Site → compiler VIP / CA mapping | Done (alpha.3): bootstrap profiles |
| Environment → datastore-cluster mapping | Done (alpha.3): placement presets |
| Build caps, cancel | Done (alpha.4); notifications later |
| VM lifecycle (`vmops.py`) | Done (alpha.5): Machines tab |
| CLI | Done (alpha.6): `ovox vm` |
| ISO mode + media detach, SSH bootstrap | Increment 6 (separate PR on `feature/ovbuilder` if large) |
| Packer golden builds | Out of scope; stays in ovbuilder |

## Remaining increments

Each lands as the next `3.15.0-alpha.N` on `feature/ovbuilder`. Real-vCenter
lab validation is Jerald's (not possible from CI).

1. **alpha.2 — decisions** (this increment): CSR challenge, `ovbuilder-`
   default, FQDN VM name, connection entity, provider interface, multi-NIC,
   Provisioning rename.
2. **alpha.3 — placement presets and bootstrap profiles** (done). Saved presets per connection
   (datacenter, compute, pool, folder, storage, NIC networks, template) and
   bootstrap profiles (server, CA, mirror URL, agent major) for consoles that
   serve several compiler VIPs; the default profile stays the Agent Install values.
3. **alpha.4 — queue caps, cancel, out-of-worker runner** (done). Per-user and global active-build
   caps; cancel (before provisioning: clean stop; after: VM kept, step says so);
   a separate `openvox-gui-provisioner` process claims queued jobs so builds
   survive uvicorn restarts.
4. **alpha.5 — lifecycle** (done). Machines tab for builder-created VMs: power on/off, reboot,
   snapshot (admin/operator); destroy (admin) that also cleans the CA cert,
   deactivates the node in OpenVoxDB and deletes the ENC node. Added to the
   provider interface.
5. **alpha.6 — `ovox vm` CLI** (done). Thin client over `/api/provisioning`: list connections,
   inventory, build, status, power, destroy.
6. **ISO mode + SSH bootstrap.** Datastore ISO browser, empty-disk create with
   CD attached, operator console install, media detach, then bootstrap over SSH
   with a one-time key. Separate PR if large.

## Open questions

None outstanding from the first round. New ones raised by later increments
will be added here.
