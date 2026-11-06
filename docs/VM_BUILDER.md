# VM Builder (VMware)

**Status:** alpha, 3.15.0 train (`3.15.0-alpha.1`). Port of the standalone
[openvox-ovbuilder](https://github.com/cvquesty/openvox-ovbuilder) provisioner.
What is ported and what is still planned: [OVBUILDER_PLAN.md](OVBUILDER_PLAN.md).

The VM Builder page (**Infrastructure → VM Builder**, `/vmbuilder`) creates a
VMware VM from a vCenter template and joins it to this OpenVox estate:

1. You enter the hostname/FQDN, IP, netmask, gateway, DNS servers and size.
   DNS records and IP allocation stay in your IPAM; the GUI only applies them.
2. You pick placement from live vCenter inventory: datacenter, DRS cluster or
   standalone ESXi host, resource pool, VM folder, datastore or Storage DRS
   datastore cluster, port group, and template.
3. The GUI clones the template and powers it on. The clone carries a cloud-init
   payload in `guestinfo.*` that sets the hostname and static IPv4 on first boot.
4. On first boot the guest runs this console's `install.bash`, the same
   one-liner the **Agent Install** page shows (`--server`, `--ca-server`,
   `--pkg-repo-url`, `--version`), with `certname` pinned to the FQDN. The
   agent submits its CSR. If you ticked **Sign this node's certificate
   request**, the GUI signs that CSR; otherwise sign it on the Certificate
   Authority page.
5. After the node's first report reaches OpenVoxDB it appears in the Node
   Classifier. If you chose an ENC environment and groups, the GUI applies them.

The **Builds** tab shows each build's steps and log. Builds that time out at
steps 3–5 end as `partial`: the VM exists and you finish by hand.

## Who can use it

| Role | Access |
|------|--------|
| admin | Build, view builds, **Settings** tab (vCenter account, defaults) |
| operator | Build, view builds |
| certops, viewer | No access (the route shows a read-only notice; the API returns 403) |

Operators already sign CSRs and edit the ENC, which is what steps 4–5 do on
their behalf. Every build, settings change and auto-sign writes an `AUDIT:` log
line (`vmbuilder_build_submit`, `vmbuilder_settings_update`, `cert_sign` with
`detail=vmbuilder job …`, `vmbuilder_classify`).

## Requirements

- **Templates** with VMware Tools (open-vm-tools) and cloud-init with the
  VMware datasource. ovbuilder's Packer goldens (`ovbuilder-almalinux-10`,
  `ovbuilder-ubuntu-24.04`) meet this. Other templates work if cloud-init reads
  `guestinfo.metadata` / `guestinfo.userdata`.
- **pyvmomi** in the GUI virtualenv. It is in `backend/requirements.txt`, so
  `install.sh` / `update_local.sh` install it. The page reports when it is missing.
- **Network paths:** the console reaches vCenter on 443. New guests reach the
  console's `/packages` mirror (4567 by default), the compiler VIP and the CA on 8140.
- **A vCenter service account.** Typical privileges, on the template, target
  folder, resource pool / cluster, datastores and port groups:
  - Virtual machine → Provisioning → Deploy template, Clone template
  - Virtual machine → Inventory → Create from existing
  - Virtual machine → Change configuration → CPU count, Memory, Advanced
    configuration, Modify device settings, Extend virtual disk
  - Virtual machine → Interaction → Power on
  - Resource → Assign virtual machine to resource pool
  - Datastore → Allocate space (on every member datastore for Storage DRS)
  - Network → Assign network

## Settings (admin)

**VM Builder → Settings**:

| Setting | Notes |
|---------|-------|
| vCenter host, port, username | Plain settings in the app DB (`gui_kv` row `vmbuilder.settings`) |
| Password | Write-only. Fernet-encrypted `cluster_secrets` row `vmbuilder_vcenter_password` (same key as other GUI secrets, `OPENVOX_GUI_SECRET_KEY`). Never returned to the browser and never logged |
| Verify TLS / CA bundle | Verification is on by default. Turn it off only for a lab vCenter with a self-signed certificate |
| Template name prefix | e.g. `ovbuilder-`. Blank lists every template the account can see |
| Default guest domain | Lets operators type a short hostname |
| Default datacenter | Preselected on the form |
| OpenVox agent major | Blank = the installer default (newest major on the mirror) |
| SSH authorized keys | Public keys for the template's default user. Password SSH stays off; root stays locked |
| DNF groups | EL guests only, installed on first boot |
| Guest HTTP proxy | Write-only, encrypted like the password. It is written into the guest, so vCenter users who can read the VM's advanced settings can read it |

Defaults can also come from `/opt/openvox-gui/config/.env`; saved settings win:

```bash
OPENVOX_GUI_VCENTER_HOST=vcenter.example.com
OPENVOX_GUI_VCENTER_USER=svc-openvox@vsphere.local
OPENVOX_GUI_VCENTER_PASSWORD=...        # prefer the Settings tab (encrypted)
OPENVOX_GUI_VCENTER_VERIFY_SSL=true
OPENVOX_GUI_VCENTER_CA_BUNDLE=/etc/pki/tls/certs/vcenter-ca.pem
```

**Clustered consoles** share the settings through the shared Postgres
`openvox_gui` database. Both consoles need the same `OPENVOX_GUI_SECRET_KEY` to
decrypt the password (already required for VIP sessions).

## Clone details

The clone reproduces ovbuilder's Terraform module without Terraform:

- `CloneVM_Task` into the chosen folder (default: datacenter root) and
  resource pool (default: the cluster's or host's root pool). A standalone host
  is pinned with `RelocateSpec.host`.
- Storage DRS: `RecommendDatastores` then `ApplyStorageDrsRecommendation_Task`.
- The template's first NIC is moved to the chosen port group (standard,
  distributed or NSX opaque). A template without a NIC gets a vmxnet3.
- The first disk grows to the requested size; it never shrinks below the template.
- `extraConfig`: `disk.EnableUUID=TRUE`, `guestinfo.metadata`, `guestinfo.userdata`.
- No vCenter guest customization spec is used. Like ovbuilder, cloud-init's
  network renderer is disabled and a first-boot script edits the template's
  existing NIC profile (netplan on Ubuntu, nmcli on EL, `ip` as a fallback).
  `/var/log/openvox-gui-agent-bootstrap.log` on the guest has the agent step output.

**Preview cloud-init** on the form renders the exact user-data without calling vCenter.

## Certificate signing

Auto-sign is off by default and per build. When it is on, the job signs only a
CSR whose certname equals the build's FQDN, only while that build waits, and
never an estate server identity (console, compiler, CA, OpenVoxDB names). It
uses the same CA path as the Certificate Authority page (CA HTTP API, then
Bolt, then local `puppetserver ca`). There is no proof yet that the CSR came
from the new VM rather than another host claiming that name; see
[OVBUILDER_PLAN.md](OVBUILDER_PLAN.md#open-questions).

## Limits in this release

- One NIC per build. No ISO installs, no VM power/snapshot/destroy, no cancel.
- Builds run inside the uvicorn worker that accepted them. A restart stops
  them; the job shows `interrupted` after two hours without progress.
- Step timeouts: guest IP 15 min, CSR 30 min, first report 30 min.

## Development and tests

`OPENVOX_GUI_VMBUILDER_FAKE=true` serves a built-in fake vCenter (two
datacenters, a cluster, a standalone host, Storage DRS, templates) and fake
clones. The page shows a yellow banner in this mode. Never set it on a real console.

Tests: `backend/tests/test_vmbuilder_service.py` (validation, cloud-init,
pipeline against the fake vCenter), `backend/tests/test_vmbuilder_api.py`
(RBAC, write-only secrets, inventory, builds), `frontend/src/utils/vmbuilder.test.ts`.

Deployment examples in this repo target the lab console only; this feature has
not been run against a production vCenter.
