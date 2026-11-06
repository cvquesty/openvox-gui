import { describe, expect, it } from 'vitest';
import {
  EMPTY_BUILD_FORM,
  buildPayload,
  isFqdn,
  parsePrefix,
  placementOptions,
  prefixToNetmask,
  validateBuildForm,
  type VmBuildForm,
  type VmDatacenterInventory,
} from './vmbuilder';

const item = (moid: string, name: string, kind: string, extra: Partial<any> = {}) => ({
  moid, name, kind, path: '', parent: '', details: {}, ...extra,
});

const INV: VmDatacenterInventory = {
  datacenter: item('datacenter-1', 'DC-East', 'datacenter'),
  compute: [
    item('domain-c10', 'Prod', 'cluster', { details: { datastores: ['ds-1', 'ds-2'], networks: ['net-1'] } }),
    item('domain-s30', 'esx1.example.com', 'host', { details: { datastores: ['ds-3'], networks: ['net-2'] } }),
  ],
  resource_pools: [
    item('rp-1', 'Resources', 'resource_pool', { parent: 'domain-c10' }),
    item('rp-2', 'Linux', 'resource_pool', { parent: 'domain-c10' }),
    item('rp-3', 'Resources', 'resource_pool', { parent: 'domain-s30' }),
  ],
  folders: [item('group-v1', 'vm', 'folder', { path: '/' })],
  datastores: [
    item('ds-1', 'vsan', 'datastore', { parent: 'pod-1', details: { accessible: true } }),
    item('ds-2', 'nfs', 'datastore', { details: { accessible: false } }),
    item('ds-3', 'local', 'datastore', { details: { accessible: true } }),
  ],
  datastore_clusters: [item('pod-1', 'SDRS', 'datastore_cluster'), item('pod-2', 'Other', 'datastore_cluster')],
  networks: [item('net-1', 'VM Network', 'network'), item('net-2', 'Host Net', 'network')],
};

const VALID: VmBuildForm = {
  ...EMPTY_BUILD_FORM,
  hostname: 'web01.example.com',
  ip: '192.0.2.50',
  netmask: '255.255.255.0',
  gateway: '192.0.2.1',
  dns_servers: ['192.0.2.10'],
  datacenter: 'DC-East',
  compute: 'domain-c10',
  datastore: 'ds-1',
  network: 'net-1',
  template: 'vm-100',
};

describe('vmbuilder prefix helpers', () => {
  it('parses every netmask form the backend accepts', () => {
    expect(parsePrefix('24')).toBe(24);
    expect(parsePrefix('/19')).toBe(19);
    expect(parsePrefix('10.0.0.0/22')).toBe(22);
    expect(parsePrefix('255.255.224.0')).toBe(19);
    expect(parsePrefix('255.255.255.255')).toBe(32);
    expect(parsePrefix('255.0.255.0')).toBeNull();
    expect(parsePrefix('0')).toBeNull();
    expect(parsePrefix('33')).toBeNull();
    expect(prefixToNetmask(19)).toBe('255.255.224.0');
    expect(prefixToNetmask(32)).toBe('255.255.255.255');
  });

  it('recognises FQDNs', () => {
    expect(isFqdn('web01.example.com')).toBe(true);
    expect(isFqdn('web01')).toBe(false);
    expect(isFqdn('web_01.example.com')).toBe(false);
  });
});

describe('validateBuildForm', () => {
  it('accepts a complete form', () => {
    expect(validateBuildForm(VALID)).toEqual({});
  });

  it('flags network identity mistakes', () => {
    const errors = validateBuildForm({
      ...VALID, hostname: 'web01', ip: '999.1.1.1', netmask: 'x', dns_servers: ['dns.example.com'],
    });
    expect(Object.keys(errors).sort()).toEqual(['dns_servers', 'hostname', 'ip', 'netmask']);
    expect(validateBuildForm({ ...VALID, hostname: 'web01' }, 'example.com').hostname).toBeUndefined();
    expect(validateBuildForm({ ...VALID, gateway: '198.51.100.1' }).gateway).toMatch(/outside/);
    expect(validateBuildForm({ ...VALID, gateway: VALID.ip }).gateway).toMatch(/differ/);
  });

  it('requires the storage pick that matches the mode', () => {
    expect(validateBuildForm({ ...VALID, storage_mode: 'datastore_cluster' }).datastore_cluster).toBeTruthy();
    expect(validateBuildForm({ ...VALID, datastore: '' }).datastore).toBeTruthy();
    expect(validateBuildForm({ ...VALID, enc_group_ids: [2] }).enc_environment).toBeTruthy();
  });
});

describe('placementOptions', () => {
  it('narrows pools, datastores, pods and networks to the compute resource', () => {
    const opts = placementOptions(INV, 'domain-c10');
    expect(opts.resourcePools.map((p) => p.moid)).toEqual(['rp-1', 'rp-2']);
    expect(opts.datastores.map((d) => d.moid)).toEqual(['ds-1']);
    expect(opts.datastoreClusters.map((d) => d.moid)).toEqual(['pod-1']);
    expect(opts.networks.map((n) => n.moid)).toEqual(['net-1']);
    expect(placementOptions(INV, 'domain-s30').datastores.map((d) => d.moid)).toEqual(['ds-3']);
    expect(placementOptions(null, '').datastores).toEqual([]);
  });
});

describe('buildPayload', () => {
  it('sends only the storage field for the selected mode and drops bootstrap extras when off', () => {
    const p = buildPayload({
      ...VALID, datastore_cluster: 'pod-1', bootstrap_agent: false,
      sign_certificate: true, enc_environment: 'production', enc_group_ids: [1],
    });
    expect(p).not.toHaveProperty('storage_mode');
    expect(p.datastore).toBe('ds-1');
    expect(p.datastore_cluster).toBe('');
    expect(p.sign_certificate).toBe(false);
    expect(p.enc_environment).toBe('');
    expect(p.enc_group_ids).toEqual([]);
  });
});
