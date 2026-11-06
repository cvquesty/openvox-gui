/**
 * VM builder form helpers (pure; unit-tested in vmbuilder.test.ts).
 *
 * The backend re-validates everything. These give the operator
 * field-level errors before submit and narrow inventory pickers to what
 * the chosen compute resource can actually use.
 */

export interface VmInventoryItem {
  moid: string;
  name: string;
  kind: string;
  path: string;
  parent: string;
  details: Record<string, any>;
}

export interface VmDatacenterInventory {
  datacenter: VmInventoryItem;
  compute: VmInventoryItem[];
  resource_pools: VmInventoryItem[];
  folders: VmInventoryItem[];
  datastores: VmInventoryItem[];
  datastore_clusters: VmInventoryItem[];
  networks: VmInventoryItem[];
}

export type StorageMode = 'datastore' | 'datastore_cluster';

export interface VmBuildForm {
  hostname: string;
  ip: string;
  netmask: string;
  gateway: string;
  dns_servers: string[];
  search_domains: string[];
  vm_name: string;
  cpus: number;
  memory_gb: number;
  disk_gb: number;
  datacenter: string;
  compute: string;
  resource_pool: string;
  folder: string;
  storage_mode: StorageMode;
  datastore: string;
  datastore_cluster: string;
  network: string;
  template: string;
  annotation: string;
  bootstrap_agent: boolean;
  sign_certificate: boolean;
  enc_environment: string;
  enc_group_ids: number[];
}

export const EMPTY_BUILD_FORM: VmBuildForm = {
  hostname: '',
  ip: '',
  netmask: '24',
  gateway: '',
  dns_servers: [],
  search_domains: [],
  vm_name: '',
  cpus: 2,
  memory_gb: 4,
  disk_gb: 40,
  datacenter: '',
  compute: '',
  resource_pool: '',
  folder: '',
  storage_mode: 'datastore',
  datastore: '',
  datastore_cluster: '',
  network: '',
  template: '',
  annotation: '',
  bootstrap_agent: true,
  sign_certificate: false,
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

export type FormErrors = Partial<Record<keyof VmBuildForm, string>>;

export function validateBuildForm(form: VmBuildForm, defaultDomain = ''): FormErrors {
  const errors: FormErrors = {};
  const host = form.hostname.trim();
  if (!host) errors.hostname = 'Hostname or FQDN is required';
  else if (!isHostnameOrFqdn(host)) errors.hostname = 'Invalid hostname';
  else if (!isFqdn(host) && !defaultDomain) errors.hostname = 'Enter an FQDN (no default guest domain is set)';

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
  if (form.vm_name.trim() && !form.vm_name.trim().split('.').every((l) => LABEL_RE.test(l))) {
    errors.vm_name = 'Letters, digits, dots and hyphens only';
  }

  if (!(form.cpus >= 1 && form.cpus <= 128)) errors.cpus = '1–128';
  if (!(form.memory_gb >= 1 && form.memory_gb <= 2048)) errors.memory_gb = '1–2048 GB';
  if (!(form.disk_gb >= 1 && form.disk_gb <= 65536)) errors.disk_gb = '1–65536 GB';

  if (!form.datacenter) errors.datacenter = 'Pick a datacenter';
  if (!form.compute) errors.compute = 'Pick a cluster or host';
  if (form.storage_mode === 'datastore' && !form.datastore) errors.datastore = 'Pick a datastore';
  if (form.storage_mode === 'datastore_cluster' && !form.datastore_cluster) {
    errors.datastore_cluster = 'Pick a datastore cluster';
  }
  if (!form.network) errors.network = 'Pick a network';
  if (!form.template) errors.template = 'Pick a template';
  if (form.enc_group_ids.length && !form.enc_environment) errors.enc_environment = 'Pick an environment for the groups';
  return errors;
}

/** Inventory narrowed to what the selected compute resource can use. */
export function placementOptions(inv: VmDatacenterInventory | null, computeMoid: string) {
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

export function buildPayload(form: VmBuildForm) {
  const { storage_mode, ...rest } = form;
  return {
    ...rest,
    hostname: form.hostname.trim(),
    ip: form.ip.trim(),
    netmask: form.netmask.trim(),
    gateway: form.gateway.trim(),
    vm_name: form.vm_name.trim(),
    datastore: storage_mode === 'datastore' ? form.datastore : '',
    datastore_cluster: storage_mode === 'datastore_cluster' ? form.datastore_cluster : '',
    sign_certificate: form.bootstrap_agent && form.sign_certificate,
    enc_environment: form.bootstrap_agent ? form.enc_environment : '',
    enc_group_ids: form.bootstrap_agent ? form.enc_group_ids : [],
  };
}

export const STEP_LABELS: Record<string, string> = {
  validate: 'Validate',
  clone: 'Clone + power on',
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
      return 'yellow';
    case 'failed':
      return 'red';
    case 'running':
      return 'blue';
    default:
      return 'gray';
  }
}
