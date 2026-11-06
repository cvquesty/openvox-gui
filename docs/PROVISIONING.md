# Provisioning (VM builder)

**Status:** alpha, 3.15.0 train. Port of the standalone
[openvox-ovbuilder](https://github.com/cvquesty/openvox-ovbuilder) provisioner.
VMware vCenter is the first provider; bare metal is planned
([#173](https://github.com/cvquesty/openvox-gui/issues/173)).
Port map, decisions and remaining work: [OVBUILDER_PLAN.md](OVBUILDER_PLAN.md).

**Infrastructure → Provisioning** (`/provisioning`; the old `/vmbuilder`
link redirects) creates a VMware VM from a vCenter template and joins it to
this OpenVox estate:

1. You enter the hostname/FQDN, IP, netmask, gateway, DNS servers and size,
   and optionally more NICs. DNS records and IP allocation stay in your IPAM;
   the GUI only applies them.
2. You pick placement from live vCenter inventory: datacenter, DRS cluster or
   standalone ESXi host, resource pool, VM folder, datastore or Storage DRS
   datastore cluster, a port group per NIC, and the template.
3. The GUI clones the template as a VM **named after the FQDN** and powers it
   on. The clone carries a cloud-init payload in `guestinfo.*` that sets the
   hostname and the static addressing on first boot.
4. On first boot the guest runs this console's `install.bash`, the same
   one-liner the **Agent Install** page shows (`--server`, `--ca-server`,
   `--pkg-repo-url`, `--version`), with `certname` pinned to the FQDN. The
   agent submits its CSR. With **Sign this node's certificate request** on (the
   default), the GUI signs it only after verifying the per-build challenge
   (below). Otherwise sign it on the Certificate Authority page.
5. After the node's first report reaches OpenVoxDB it appears in the Node
   Classifier. If you chose an ENC environment and groups, the GUI applies them.

The **Builds** tab shows each build's steps and log. Builds that time out or
stop at steps 3–5 end as `partial`: the VM exists and you finish by hand.

## Prerequisites

- **Network routes (confirmed for this estate).** Every VLAN a new VM lands
  on must reach, from first boot:
  - this console on **4567/tcp** (`/packages`: `install.bash` and the package mirror);
  - the compiler VIP and the CA on **8140/tcp** (CSR, catalogs).
  The console itself reaches vCenter on 443.
- **Templates** with VMware Tools (open-vm-tools) and cloud-init with the
  VMware datasource. ovbuilder's Packer goldens (`ovbuilder-almalinux-10`,
  `ovbuilder-ubuntu-24.04`) meet this, and `ovbuilder-` is the default
  template name prefix.
- **pyvmomi** in the GUI virtualenv. It is in `backend/requirements.txt`, so
  `install.sh` / `update_local.sh` install it. The page reports when it is missing.
- **One vCenter service account** (decision: shared account, password
  encrypted in the GUI database). Typical privileges on the template, target
  folder, resource pool / cluster, datastores and port groups:
  - Virtual machine → Provisioning → Deploy template, Clone template
  - Virtual machine → Inventory → Create from existing
  - Virtual machine → Change configuration → CPU count, Memory, Advanced
    configuration, Modify device settings, Add new disk / device, Extend virtual disk
  - Virtual machine → Interaction → Power on
  - Resource → Assign virtual machine to resource pool
  - Datastore → Allocate space (on every member datastore for Storage DRS)
  - Network → Assign network

## Who can use it

| Role | Access |
|------|--------|
| admin | Build, view builds, **Settings** tab (connections, guest defaults) |
| operator | Build, view builds |
| certops, viewer | No access (the route shows a read-only notice; the API returns 403) |

Every build, settings or connection change, CSR sign and CSR rejection writes
an `AUDIT:` log line (`provisioning_build_submit`, `provisioning_settings_update`,
`provisioning_connection_update`, `cert_sign` with `detail=provisioning job …`,
`provisioning_csr_rejected`, `provisioning_classify`).

## Settings (admin)

### Provider connections

A connection is one provider endpoint with an id (e.g. `default`, `site-b`).
Today the only provider is **VMware vCenter**. Exactly one connection is the
default; the build form preselects it and shows a picker only when there is
more than one. Builds record the connection they used.

| Field | Notes |
|-------|-------|
| Id, provider | Fixed after creation |
| Host, port, username | `provision_connections` row |
| Password | Write-only. Fernet-encrypted `cluster_secrets` row `provisioning_connection_password:<id>` (key from `OPENVOX_GUI_SECRET_KEY`). Never returned to the browser and never logged |
| Verify TLS / CA bundle | Verification is on by default. Turn it off only for a lab vCenter with a self-signed certificate |
| Template name prefix | Default `ovbuilder-`. Blank lists every template the account can see |
| Default datacenter | Preselected on the form |

Until a connection is saved, `/opt/openvox-gui/config/.env` can seed one
with id `default`:

```bash
OPENVOX_GUI_VCENTER_HOST=vcenter.example.com
OPENVOX_GUI_VCENTER_USER=svc-openvox@vsphere.local
OPENVOX_GUI_VCENTER_PASSWORD=...        # prefer the Settings tab (encrypted)
OPENVOX_GUI_VCENTER_VERIFY_SSL=true
OPENVOX_GUI_VCENTER_CA_BUNDLE=/etc/pki/tls/certs/vcenter-ca.pem
```

### Bootstrap profiles (admin)

A bootstrap profile says where new agents point: compile server (compiler
VIP), CA server, package mirror URL and agent major. The built-in
**Agent Install defaults** profile always uses the Agent Install page's
values. Add a profile when this console provisions nodes for another
compiler VIP or mirror; the build form picks one per build (default: built in).
Profiles are admin-only because they decide which servers a new node trusts.
Stored in `provision_bootstrap_profiles`.

### Placement presets (admin and operator)

On the Build tab, **Save current choices as** stores the connection's
placement, NIC networks, template, size and bootstrap profile under a name;
**Preset** fills them back in. Identity (hostname, IPs) is never part of a
preset, and every value is re-checked against live inventory when the build
runs. Settings lists and deletes presets. Stored in `provision_presets`.

### Guest defaults (all providers)

| Setting | Notes |
|---------|-------|
| Default guest domain | Lets operators type a short hostname |
| OpenVox agent major | Blank = the installer default (newest major on the mirror) |
| SSH authorized keys | Public keys for the image's default user. Password SSH stays off; root stays locked |
| DNF groups | EL guests only, installed on first boot |
| Guest HTTP proxy | Write-only, encrypted like the password (`provisioning_http_proxy`) |

**Clustered consoles** share all of this through the shared Postgres
`openvox_gui` database. Both consoles need the same `OPENVOX_GUI_SECRET_KEY`
(already required for VIP sessions).

## Certificate signing (per-build challenge)

Auto-sign never trusts the certname alone:

1. When the build starts, the GUI generates a random 192-bit token. It is
   written into the guest payload only, as
   `custom_attributes:challengePassword=<token>` on the `install.bash` line.
   Puppet puts it in `csr_attributes.yaml` and the CSR's PKCS#9
   challengePassword attribute. Attributes are not copied into the signed
   certificate, so the token never becomes a trusted fact.
2. The job row stores only `sha256(token)`. The token is not logged, not in
   the job's API response, and not in the cloud-init preview (which shows a
   placeholder).
3. When a CSR for the certname appears, the GUI fetches it from the CA
   (`GET /puppet-ca/v1/certificate_request/<certname>` on each CA member, then
   the local cadir). It signs only if the CSR is well-formed, its CN is the
   build's certname, and its challengePassword hashes to the stored value.
   A missing, wrong, or unreadable challenge means **not signed**: the step is
   `rejected` (or `failed` if the CSR could not be read), the build ends
   `partial`, and `provisioning_csr_rejected` is audited.
4. Estate server identities (console, compiler, CA, OpenVoxDB names) are never signed.
5. Once the CSR has been handled, the GUI blanks `guestinfo.userdata` on the
   VM so the token and proxy URL no longer sit in vCenter advanced settings.
   `guestinfo.metadata` stays, so cloud-init does not treat the next boot as a
   new instance. The token remains in the guest's root-only
   `csr_attributes.yaml` and cloud-init cache; it is single-use and worthless
   once that build has signed.

## Clone details (VMware provider)

The clone reproduces ovbuilder's Terraform module without Terraform:

- `CloneVM_Task` into the chosen folder (default: datacenter root) and
  resource pool (default: the cluster's or host's root pool). A standalone host
  is pinned with `RelocateSpec.host`.
- Storage DRS: `RecommendDatastores` then `ApplyStorageDrsRecommendation_Task`.
- NICs: the template's NICs are moved, in order, to the chosen port groups
  (standard, distributed or NSX opaque); extra NICs are added as vmxnet3.
- The first disk grows to the requested size; it never shrinks below the template.
- `extraConfig`: `disk.EnableUUID=TRUE`, `guestinfo.metadata`, `guestinfo.userdata`.
- VM name = FQDN (vCenter limit 80 characters).
- No vCenter guest customization spec is used. Like ovbuilder, cloud-init's
  network renderer is disabled and a first-boot script edits the template's
  existing NIC profiles (netplan on Ubuntu, nmcli on EL, `ip` as a fallback).
  NICs are matched in PCI order. NIC 1 gets the gateway and DNS; extra NICs get
  a static address without a gateway, or DHCP when no address is given.
  `/var/log/openvox-gui-agent-bootstrap.log` on the guest has the agent step output.

**Preview cloud-init** on the form renders the user-data without calling vCenter.

## Limits in this release

- Builds run inside the uvicorn worker that accepted them. A restart stops
  them; the job shows `interrupted` after two hours without progress.
- No cancel, queue caps, power/snapshot/destroy, CLI, ISO installs or SSH
  bootstrap yet ([OVBUILDER_PLAN.md](OVBUILDER_PLAN.md)).
- Step timeouts: guest IP 15 min, CSR 30 min, first report 30 min.

## Development and tests

`OPENVOX_GUI_PROVISIONING_FAKE=true` serves a built-in fake vCenter (two
datacenters, a cluster, a standalone host, Storage DRS, templates) and fake
clones. The page shows a yellow banner in this mode. Never set it on a real console.

Tests: `backend/tests/test_provisioning_service.py` (validation, cloud-init,
CSR challenge, VMware provider, pipeline against the fake vCenter),
`backend/tests/test_provisioning_api.py` (RBAC, connections, write-only
secrets, inventory, builds, CSR accept/reject), `frontend/src/utils/provisioning.test.ts`.

Deployment examples in this repo target the lab console only; this feature has
not been run against a production vCenter.
