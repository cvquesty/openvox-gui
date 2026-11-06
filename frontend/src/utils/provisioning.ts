/**
 * Provisioning form helpers (pure; unit-tested in provisioning.test.ts).
 *
 * The backend re-validates everything. These give the operator
 * field-level errors before submit and narrow VMware inventory pickers to
 * what the chosen compute resource can actually use. The base fields
 * (identity, NICs, size, bootstrap) are provider-agnostic; ``placement``
 * is provider-specific (VMware today; bare metal is issue #173).
 */

export interface InventoryItem {
  moid: string;
  name: string;
  kind: string;
  path: string;
  parent: string;
  details: Record<string, any>;
}

export interface VmwareDatacenterInventory {
  datacenter: InventoryItem;
  compute: InventoryItem[];
  resource_pools: InventoryItem[];
  folders: InventoryItem[];
  datastores: InventoryItem[];
  datastore_clusters: InventoryItem[];
  networks: InventoryItem[];
}

export type StorageMode = 'datastore' | 'datastore_cluster';
export type BuildMode = 'clone' | 'iso';

/** vSphere guest OS ids offered for ISO installs (the agent bootstrap is Linux over SSH). */
export const ISO_GUEST_OS: { value: string; label: string }[] = [
  { value: 'rhel9_64Guest', label: 'RHEL / AlmaLinux / Rocky 9+' },
  { value: 'rhel8_64Guest', label: 'RHEL / AlmaLinux / Rocky 8' },
  { value: 'ubuntu64Guest', label: 'Ubuntu (64-bit)' },
  { value: 'debian12_64Guest', label: 'Debian 12' },
  { value: 'other5xLinux64Guest', label: 'Other Linux 5.x+ (64-bit)' },
  { value: 'otherLinux64Guest', label: 'Other Linux (64-bit)' },
];

export interface ExtraNic {
  network: string;
  ip: string;
  netmask: string;
}

export interface BuildFormState {
  mode: BuildMode;
  install_media: string;
  iso_datastore: string;
  guest_os: string;
  connection: string;
  hostname: string;
  ip: string;
  netmask: string;
  gateway: string;
  dns_servers: string[];
  search_domains: string[];
  network: string;
  extra_nics: ExtraNic[];
  cpus: number;
  memory_gb: number;
  disk_gb: number;
  image: string;
  datacenter: string;
  compute: string;
  resource_pool: string;
  folder: string;
  storage_mode: StorageMode;
  datastore: string;
  datastore_cluster: string;
  annotation: string;
  bootstrap_agent: boolean;
  bootstrap_profile: string;
  sign_certificate: boolean;
  enc_environment: string;
  enc_group_ids: number[];
}

export const MAX_NICS = 8;

export const EMPTY_BUILD_FORM: BuildFormState = {
  mode: 'clone',
  install_media: '',
  iso_datastore: '',
  guest_os: 'rhel9_64Guest',
  connection: '',
  hostname: '',
  ip: '',
  netmask: '24',
  gateway: '',
  dns_servers: [],
  search_domains: [],
  network: '',
  extra_nics: [],
  cpus: 2,
  memory_gb: 4,
  disk_gb: 40,
  image: '',
  datacenter: '',
  compute: '',
  resource_pool: '',
  folder: '',
  storage_mode: 'datastore',
  datastore: '',
  datastore_cluster: '',
  annotation: '',
  bootstrap_agent: true,
  bootstrap_profile: '',
  sign_certificate: true,
  enc_environment: '',
  enc_group_ids: [],
};

const LABEL_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

export function isIpv4(value: string): boolean {
  return IPV4_RE.test((value || '').trim());
}

export function isFqdn(value: string): boolean {
  const text = (value || '').trim().replace(/\.$/, '');
  if (!text || text.length > 253) return false;
  const labels = text.split('.');
  return labels.length >= 2 && labels.every((l) => LABEL_RE.test(l));
}

export function isHostnameOrFqdn(value: string): boolean {
  const text = (value || '').trim().replace(/\.$/, '');
  return LABEL_RE.test(text) || isFqdn(text);
}

/** Certname / machine name the backend will use (lowercase FQDN). */
export function certnameFor(hostname: string, defaultDomain: string): string {
  const host = (hostname || '').trim().replace(/\.$/, '').toLowerCase();
  if (!host) return '';
  return host.includes('.') || !defaultDomain ? host : `${host}.${defaultDomain.toLowerCase()}`;
}

/** Prefix 1–32 from "24", "/24", "10.0.0.0/24" or "255.255.255.0"; null when invalid. */
export function parsePrefix(raw: string): number | null {
  const text = (raw || '').trim();
  if (!text) return null;
  if (isIpv4(text)) {
    const bits = text.split('.').map(Number).map((o) => o.toString(2).padStart(8, '0')).join('');
    if (!/^1*0*$/.test(bits)) return null;
    const prefix = bits.indexOf('0') === -1 ? 32 : bits.indexOf('0');
    return prefix >= 1 ? prefix : null;
  }
  const tail = text.includes('/') ? text.slice(text.lastIndexOf('/') + 1) : text;
  if (!/^\d{1,2}$/.test(tail)) return null;
  const n = Number(tail);
  return n >= 1 && n <= 32 ? n : null;
}

export function prefixToNetmask(prefix: number): string {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return [24, 16, 8, 0].map((s) => (mask >>> s) & 0xff).join('.');
}

function ipToInt(ip: string): number {
  return ip.split('.').reduce((acc, o) => ((acc << 8) | Number(o)) >>> 0, 0);
}

export function sameSubnet(ip: string, other: string, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return ((ipToInt(ip) & mask) >>> 0) === ((ipToInt(other) & mask) >>> 0);
}

export type FormErrors = Partial<Record<keyof BuildFormState, string>> & { nics?: Record<number, string> };

export function validateBuildForm(form: BuildFormState, defaultDomain = ''): FormErrors {
  const errors: FormErrors = {};
  const host = form.hostname.trim();
  if (!host) errors.hostname = 'Hostname or FQDN is required';
  else if (!isHostnameOrFqdn(host)) errors.hostname = 'Invalid hostname';
  else if (!isFqdn(host) && !defaultDomain) errors.hostname = 'Enter an FQDN (no default guest domain is set)';
  else if (certnameFor(host, defaultDomain).length > 80) errors.hostname = 'FQDN is the VM name; vCenter allows 80 characters';

  if (!isIpv4(form.ip)) errors.ip = 'Enter an IPv4 address';
  const prefix = parsePrefix(form.netmask);
  if (prefix === null) errors.netmask = 'Use 1–32, /N or a dotted netmask';
  if (form.gateway.trim()) {
    if (!isIpv4(form.gateway)) errors.gateway = 'Enter an IPv4 address';
    else if (prefix !== null && isIpv4(form.ip)) {
      if (form.gateway.trim() === form.ip.trim()) errors.gateway = 'Gateway must differ from the VM IP';
      else if (!sameSubnet(form.ip.trim(), form.gateway.trim(), prefix)) {
        errors.gateway = 'Gateway is outside the VM subnet';
      }
    }
  }
  const badDns = form.dns_servers.find((d) => !isIpv4(d));
  if (badDns) errors.dns_servers = `Not an IPv4 address: ${badDns}`;
  const badSearch = form.search_domains.find((d) => !isFqdn(d) && !LABEL_RE.test(d));
  if (badSearch) errors.search_domains = `Invalid domain: ${badSearch}`;
  if (!form.network) errors.network = 'Pick a network';

  const nicErrors: Record<number, string> = {};
  const used = new Set([form.ip.trim()]);
  form.extra_nics.forEach((nic, i) => {
    if (!nic.network) nicErrors[i] = 'Pick a network';
    else if (nic.ip.trim()) {
      if (!isIpv4(nic.ip)) nicErrors[i] = 'Enter an IPv4 address or leave blank for DHCP';
      else if (parsePrefix(nic.netmask) === null) nicErrors[i] = 'Netmask is required with a static IP';
      else if (used.has(nic.ip.trim())) nicErrors[i] = 'IP already used by another NIC';
      used.add(nic.ip.trim());
    }
  });
  if (Object.keys(nicErrors).length) errors.nics = nicErrors;
  if (form.extra_nics.length + 1 > MAX_NICS) errors.network = `At most ${MAX_NICS} NICs`;

  if (!(form.cpus >= 1 && form.cpus <= 128)) errors.cpus = '1–128';
  if (!(form.memory_gb >= 1 && form.memory_gb <= 2048)) errors.memory_gb = '1–2048 GB';
  if (!(form.disk_gb >= 1 && form.disk_gb <= 65536)) errors.disk_gb = '1–65536 GB';

  if (!form.datacenter) errors.datacenter = 'Pick a datacenter';
  if (!form.compute) errors.compute = 'Pick a cluster or host';
  if (form.storage_mode === 'datastore' && !form.datastore) errors.datastore = 'Pick a datastore';
  if (form.storage_mode === 'datastore_cluster' && !form.datastore_cluster) {
    errors.datastore_cluster = 'Pick a datastore cluster';
  }
  if (form.mode === 'clone' && !form.image) errors.image = 'Pick a template';
  if (form.mode === 'iso') {
    if (!form.install_media) errors.install_media = 'Pick an ISO';
    if (form.storage_mode !== 'datastore') errors.datastore_cluster = 'ISO installs need a single datastore';
  }
  if (form.enc_group_ids.length && !form.enc_environment) errors.enc_environment = 'Pick an environment for the groups';
  return errors;
}

export function errorCount(errors: FormErrors): number {
  const { nics, ...rest } = errors;
  return Object.values(rest).filter(Boolean).length + Object.keys(nics || {}).length;
}

export function firstError(errors: FormErrors): string {
  const { nics, ...rest } = errors;
  const field = Object.values(rest).find(Boolean);
  if (field) return field;
  const [idx, msg] = Object.entries(nics || {})[0] || [];
  return msg ? `NIC ${Number(idx) + 2}: ${msg}` : '';
}

/** VMware inventory narrowed to what the selected compute resource can use. */
export function placementOptions(inv: VmwareDatacenterInventory | null, computeMoid: string) {
  if (!inv) {
    return { compute: undefined, resourcePools: [], datastores: [], datastoreClusters: [], networks: [], folders: [] };
  }
  const compute = inv.compute.find((c) => c.moid === computeMoid);
  const attachedDs: string[] = compute?.details?.datastores || [];
  const attachedNets: string[] = compute?.details?.networks || [];
  const datastores = inv.datastores.filter(
    (d) => d.details?.accessible !== false && (!compute || !attachedDs.length || attachedDs.includes(d.moid)),
  );
  const podIds = new Set(datastores.map((d) => d.parent).filter(Boolean));
  return {
    compute,
    resourcePools: compute ? inv.resource_pools.filter((p) => !p.parent || p.parent === compute.moid) : [],
    datastores,
    datastoreClusters: compute && attachedDs.length
      ? inv.datastore_clusters.filter((p) => podIds.has(p.moid))
      : inv.datastore_clusters,
    networks: inv.networks.filter(
      (n) => !compute || !attachedNets.length || attachedNets.includes(n.moid),
    ),
    folders: inv.folders,
  };
}

export function buildPayload(form: BuildFormState) {
  return {
    connection: form.connection,
    hostname: form.hostname.trim(),
    ip: form.ip.trim(),
    netmask: form.netmask.trim(),
    gateway: form.gateway.trim(),
    dns_servers: form.dns_servers,
    search_domains: form.search_domains,
    network: form.network,
    extra_nics: form.extra_nics.map((n) => ({
      network: n.network,
      ip: n.ip.trim(),
      netmask: n.ip.trim() ? n.netmask.trim() : '',
    })),
    mode: form.mode,
    image: form.mode === 'clone' ? form.image : '',
    install_media: form.mode === 'iso' ? form.install_media : '',
    guest_os: form.mode === 'iso' ? form.guest_os : '',
    placement: {
      datacenter: form.datacenter,
      compute: form.compute,
      resource_pool: form.resource_pool,
      folder: form.folder,
      datastore: form.storage_mode === 'datastore' ? form.datastore : '',
      datastore_cluster: form.storage_mode === 'datastore_cluster' ? form.datastore_cluster : '',
    },
    cpus: form.cpus,
    memory_gb: form.memory_gb,
    disk_gb: form.disk_gb,
    annotation: form.annotation,
    bootstrap_agent: form.bootstrap_agent,
    bootstrap_profile: form.bootstrap_agent ? form.bootstrap_profile : '',
    sign_certificate: form.bootstrap_agent && form.sign_certificate,
    enc_environment: form.bootstrap_agent ? form.enc_environment : '',
    enc_group_ids: form.bootstrap_agent ? form.enc_group_ids : [],
  };
}

export interface PresetShape {
  placement: Record<string, string>;
  networks: string[];
  image: string;
  cpus?: number;
  memory_gb?: number;
  disk_gb?: number;
  bootstrap_profile: string;
}

/** Fill the form from a preset. Identity fields (hostname, IPs) are never touched. */
export function applyPreset(form: BuildFormState, preset: PresetShape): BuildFormState {
  const p = preset.placement || {};
  const [first = '', ...rest] = preset.networks || [];
  return {
    ...form,
    datacenter: p.datacenter ?? form.datacenter,
    compute: p.compute ?? '',
    resource_pool: p.resource_pool ?? '',
    folder: p.folder ?? '',
    storage_mode: p.datastore_cluster ? 'datastore_cluster' : 'datastore',
    datastore: p.datastore ?? '',
    datastore_cluster: p.datastore_cluster ?? '',
    network: first,
    extra_nics: rest.map((network, i) => ({ network, ip: form.extra_nics[i]?.ip || '', netmask: form.extra_nics[i]?.netmask || '' })),
    image: preset.image || form.image,
    cpus: preset.cpus ?? form.cpus,
    memory_gb: preset.memory_gb ?? form.memory_gb,
    disk_gb: preset.disk_gb ?? form.disk_gb,
    bootstrap_profile: preset.bootstrap_profile || '',
  };
}

/** Preset body from the current form (placement, networks, image, size, bootstrap profile). */
export function presetFromForm(form: BuildFormState, name: string) {
  const payload = buildPayload(form);
  return {
    name,
    connection: form.connection,
    placement: payload.placement,
    networks: [form.network, ...form.extra_nics.map((n) => n.network)].filter(Boolean),
    image: form.image,
    cpus: form.cpus,
    memory_gb: form.memory_gb,
    disk_gb: form.disk_gb,
    bootstrap_profile: form.bootstrap_profile,
  };
}

export function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
}

export const STEP_LABELS: Record<string, string> = {
  validate: 'Validate',
  provision: 'Create + power on',
  install: 'OS install (console)',
  media: 'Install media',
  bootstrap: 'SSH bootstrap',
  guest: 'Guest network',
  certificate: 'Certificate',
  classify: 'Classifier',
};

export function statusColor(status: string): string {
  switch (status) {
    case 'succeeded':
    case 'done':
      return 'green';
    case 'partial':
    case 'timeout':
    case 'interrupted':
    case 'cancelled':
    case 'cancelling':
      return 'yellow';
    case 'failed':
    case 'rejected':
      return 'red';
    case 'running':
      return 'blue';
    default:
      return 'gray';
  }
}
