# ovbuilder → openvox-gui port plan

**Owner:** Jerald · **Train:** 3.15.0 (`3.15.0-alpha.1` on `feature/ovbuilder`)
**Source studied:** [openvox-ovbuilder](https://github.com/cvquesty/openvox-ovbuilder)
`0.97-beta33` (CLI `ovbuilder/`, web `web/`, `terraform/modules/vm`, `packer/`).
Operator guide for what shipped: [VM_BUILDER.md](VM_BUILDER.md).

## How ovbuilder works (what was reused)

| Concern | ovbuilder | openvox-gui |
|---------|-----------|-------------|
| vCenter library / session | pyVmomi `SmartConnect`, one session per operation, `Disconnect` in `finally` | Same (`services/vmbuilder/pyvmomi_client.py`), one session per API call or build step, run in a worker thread |
| Credentials | Prompted or env / `secrets.env`; web stores the password on the job row | Admin settings; password Fernet-encrypted in `cluster_secrets`, never on the job row, never returned or logged |
| TLS | `ignore_ssl=True` by default | Verify by default; per-console toggle + CA bundle |
| Inventory | Datacenters, DRS clusters, standalone hosts (`classify_compute`), datastores, Storage DRS pods, networks, `ovbuilder-*` templates across DCs | Same, plus resource pools and VM folders; picks carry managed object ids; template prefix configurable |
| Fail before create | `require_template`, `classify_compute` | `check_against_inventory`: compute, pool owner, folder, datastore mounted and accessible, network attached, template allowed, VM name free |
| Clone | Terraform `vsphere_virtual_machine` (clone block) | `CloneVM_Task` / Storage DRS `RecommendDatastores` with the same semantics: pool or host placement, datastore or SDRS, vmxnet3 on chosen network, disk `max(requested, template)`, `disk.EnableUUID`, `extra_config` guestinfo |
| Guest identity | cloud-init `guestinfo.metadata` / `userdata`; network renderer disabled; `ovbuilder-net.sh` edits the existing NIC (netplan / nmcli / iproute2) | Same design (`guestinfo.py`), scripts renamed `openvox-gui-*.sh`; DNS search domains added; gateway must be on-link |
| Network customization spec | Not used | Not used (cloud-init covers EL and Ubuntu goldens) |
| Agent install | cloud-init `runcmd` runs the GUI `install.bash` with `--server` / `--ca-server` / `--pkg-repo-url` from a hard-coded site table; optional SSH bootstrap (paramiko) | cloud-init `runcmd` with the Agent Install page's live values, `--version`, `main:certname=<fqdn>`, 5 retries; no SSH |
| Cert signing | Manual (`puppetserver ca sign`) | Optional per-build sign of that certname via `certificates_service.run_ca_command`, else wait for an operator |
| Classification | None | Wait for first report in the live fleet, then optional ENC environment + groups (existing classes/parameters kept) |
| Job runner | Celery + Redis + Postgres, per-user and global caps, cancel, webhook notify | asyncio task in the GUI worker, `vm_build_jobs` table, per-step progress |

## Feature parity

| ovbuilder capability | Increment 1 (this PR) | Plan |
|----------------------|-----------------------|------|
| Golden template clone (default mode) | Done | — |
| Datacenter / cluster / standalone host / datastore / SDRS / network pickers | Done | — |
| Cross-datacenter template clone (template in another DC of the same vCenter) | Templates from every DC are listed; `CloneVM_Task` relocates into the target pool/datastore | Validate in the lab vCenter (2) |
| Static IPv4, prefix or dotted netmask, gateway, DNS | Done | — |
| Hostname / FQDN identity, certname | Done | — |
| CPU / memory / disk sizing, disk never shrinks | Done | — |
| Multiple networks (`--network` repeated) | One NIC | Extra NICs as DHCP or unconfigured (2) |
| SSH authorized keys injection | Done (settings) | Per-build keys (3) |
| Opt-in password SSH (golden password) | Not ported on purpose | Only if Jerald needs it; would need a write-only secret like the vCenter password |
| HTTP proxy for guests + `no_proxy` | Done (encrypted secret) | — |
| EL DNF groups at first boot | Done (settings) | Per-build skip toggle (`--skip-dnf-groups`) (2) |
| Site / location → compiler VIP + CA (`openvox_site.py`) | Uses this console's installer target (one estate) | Per-site bootstrap profiles if one console serves several compiler VIPs (2) |
| Environment → datastore-cluster mapping (`placement.py`, web dev/prod) | Operator picks storage directly | Saved placement presets (datacenter, compute, pool, folder, storage, network, template) (2) |
| VM lifecycle: list, power on/off, reboot, snapshot, destroy (`vmops.py`, web `/vms`) | Not yet | VMs tab limited to builder-created VMs; destroy admin-only with CA clean + PuppetDB deactivate + ENC delete (3) |
| Legacy ISO mode + `disconnect_install_media` | Not yet | ISO picker from datastore browser, empty-disk create, media detach, SSH or console bootstrap (4) |
| SSH post-install bootstrap (paramiko) | Not ported | Only for ISO mode (4) |
| Build queue caps, cancel, webhook notifications (web) | Not yet | Per-user/global caps and cancel (2); notifications through existing executive-report email or a webhook (3) |
| Packer golden image builds | Out of scope for the GUI | Keep in the ovbuilder repo; GUI consumes the templates |
| CLI (`ovbuilder build`) | — | `ovox vm build` / `ovox vm list` thin client over `/api/vmbuilder` (3) |

## Remaining steps

Numbers in the table above refer to these increments. Each lands as
`3.15.0-alpha.N` on this branch or a follow-up, with lab-only validation.

### Increment 2: lab validation and hardening

- Run against the lab vCenter with both goldens: standard and distributed port
  groups, DRS cluster and standalone host, single datastore and Storage DRS,
  cross-DC template. Record results in this doc.
- CSR provenance check (see open questions) before auto-sign is recommended.
- Queue caps (per user and global) and a cancel button; cancel before clone
  aborts cleanly, after clone leaves the VM and says so.
- Placement presets and per-site bootstrap profiles.
- Extra NICs; per-build DNF skip.
- Move builds out of the uvicorn worker if restarts during long builds are a
  problem (systemd-run worker or a small dedicated process reading `vm_build_jobs`).
- Touches `services/vmbuilder/{provision,jobs,config_store}.py`, router, BuildForm.

### Increment 3: lifecycle and CLI

- VMs tab (port `vmops.py`): power, reboot, snapshot for VMs this GUI built;
  admin destroy that also cleans the CA cert, deactivates in OpenVoxDB and
  deletes the ENC node (reuse the Nodes purge path).
- `ovox vm` commands.
- Build notifications.

### Increment 4: ISO mode (only if still needed)

- Datastore ISO browser, empty-disk create with CD attached, operator console
  install, `disconnect_install_media`, then SSH bootstrap with a one-time key.

## Open questions

1. **Credential storage.** This PR keeps the vCenter password in the shared
   app DB, encrypted with the key derived from `OPENVOX_GUI_SECRET_KEY` (the
   existing `cluster_secrets` pattern). Is that acceptable, or should it come
   from a file or vault on the console only? Should each operator use their own
   vCenter login instead of one service account?
2. **Cert signing.** Auto-sign trusts the certname plus timing. Options:
   (a) leave it opt-in as is; (b) put a per-build random token in
   `csr_attributes` (`extension_requests:pp_preshared_key`) and verify it before
   signing, which needs a CA read of the CSR extensions; (c) a Puppet
   `autosign` policy executable that checks a token the GUI issued. Which one
   matches the estate's signing policy?
3. **Where the bootstrap runs.** It runs inside the guest from cloud-init, so the
   new VM needs routes to the console mirror (4567), compilers and CA (8140) on
   first boot. Is that true for every VLAN, or do some need the SSH path from
   the console?
4. **Templates.** Are the ovbuilder Packer goldens the only templates, so the
   `ovbuilder-` prefix should be the default?
5. **Who may build.** Operators can build today. Should building be admin-only,
   or a new role?
6. **VM naming.** VM name defaults to the short hostname (ovbuilder behaviour).
   Should it be the FQDN?
7. **Several vCenters.** One vCenter per console in this PR. Do sites have
   separate vCenters?
