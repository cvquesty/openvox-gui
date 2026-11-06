/**
 * VM builder form: identity + network, size, vCenter placement, OpenVox bootstrap.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Badge, Button, Card, Code, Grid, Group, Modal, MultiSelect, NumberInput,
  ScrollArea, SegmentedControl, Select, Stack, Switch, TagsInput, Text, TextInput, Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconEye, IconRefresh, IconRocket } from '@tabler/icons-react';
import { ConfirmModal } from '../ConfirmModal';
import { enc, vmbuilder, type VmBuilderStatus, type VmBuildPreview } from '../../services/api';
import {
  EMPTY_BUILD_FORM, buildPayload, parsePrefix, placementOptions, prefixToNetmask, validateBuildForm,
  type FormErrors, type VmBuildForm, type VmDatacenterInventory, type VmInventoryItem,
} from '../../utils/vmbuilder';
import { InventoryBrowser, type PickField } from './InventoryBrowser';

const option = (i: VmInventoryItem, label?: string) => ({ value: i.moid, label: label || i.path || i.name });

export function BuildForm({
  status, onSubmitted,
}: {
  status: VmBuilderStatus;
  onSubmitted: (jobId: string) => void;
}) {
  const defaultDomain = status.settings.default_domain || '';
  const [form, setForm] = useState<VmBuildForm>(EMPTY_BUILD_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [datacenters, setDatacenters] = useState<VmInventoryItem[]>([]);
  const [inventory, setInventory] = useState<VmDatacenterInventory | null>(null);
  const [templates, setTemplates] = useState<VmInventoryItem[]>([]);
  const [envs, setEnvs] = useState<{ name: string }[]>([]);
  const [groups, setGroups] = useState<{ id: number; name: string; environment: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preview, setPreview] = useState<VmBuildPreview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const set = <K extends keyof VmBuildForm>(key: K, value: VmBuildForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const loadTop = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [dcs, tpls] = await Promise.all([vmbuilder.datacenters(), vmbuilder.templates()]);
      setDatacenters(dcs);
      setTemplates(tpls);
      setForm((f) => {
        if (f.datacenter) return f;
        const preferred = dcs.find((d) => d.name === status.settings.default_datacenter) || (dcs.length === 1 ? dcs[0] : null);
        return preferred ? { ...f, datacenter: preferred.name } : f;
      });
    } catch (e: any) {
      setLoadError(e.message);
    }
    setLoading(false);
  }, [status.settings.default_datacenter]);

  useEffect(() => { loadTop(); }, [loadTop]);

  useEffect(() => {
    Promise.allSettled([enc.listEnvironments(), enc.listGroups()]).then(([e, g]) => {
      if (e.status === 'fulfilled') setEnvs(e.value);
      if (g.status === 'fulfilled') setGroups(g.value);
    });
  }, []);

  useEffect(() => {
    if (!form.datacenter) { setInventory(null); return; }
    let cancelled = false;
    setInventory(null);
    vmbuilder.datacenter(form.datacenter)
      .then((inv) => { if (!cancelled) setInventory(inv); })
      .catch((e) => { if (!cancelled) setLoadError(e.message); });
    return () => { cancelled = true; };
  }, [form.datacenter]);

  const opts = useMemo(() => placementOptions(inventory, form.compute), [inventory, form.compute]);
  const prefix = parsePrefix(form.netmask);

  const changeDatacenter = (name: string | null) => {
    setForm((f) => ({
      ...f, datacenter: name || '', compute: '', resource_pool: '', folder: '',
      datastore: '', datastore_cluster: '', network: '',
    }));
  };

  const changeCompute = (moid: string | null) => {
    setForm((f) => ({ ...f, compute: moid || '', resource_pool: '', datastore: '', datastore_cluster: '', network: '' }));
    setErrors((e) => ({ ...e, compute: undefined }));
  };

  const changeTemplate = (moid: string | null) => {
    const tpl = templates.find((t) => t.moid === moid);
    setForm((f) => ({
      ...f,
      template: moid || '',
      // Clones never shrink the template disk (ovbuilder rule).
      disk_gb: tpl?.details.disk_gb ? Math.max(f.disk_gb, tpl.details.disk_gb) : f.disk_gb,
    }));
    setErrors((e) => ({ ...e, template: undefined }));
  };

  const pick = (field: PickField, moid: string) => {
    if (field === 'compute') return changeCompute(moid);
    if (field === 'template') return changeTemplate(moid);
    if (field === 'datastore' || field === 'datastore_cluster') {
      setForm((f) => ({ ...f, storage_mode: field, [field]: moid }));
      return;
    }
    set(field, moid);
  };

  const check = (): boolean => {
    const errs = validateBuildForm(form, defaultDomain);
    setErrors(errs);
    if (Object.keys(errs).length) {
      notifications.show({ color: 'red', title: 'Check the form', message: Object.values(errs)[0] });
      return false;
    }
    return true;
  };

  const doPreview = async () => {
    if (!check()) return;
    try {
      setPreview(await vmbuilder.preview(buildPayload(form)));
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Preview failed', message: e.message });
    }
  };

  const doSubmit = async () => {
    setSubmitting(true);
    try {
      const job = await vmbuilder.submit(buildPayload(form));
      notifications.show({ color: 'green', title: 'Build started', message: `${job.certname} queued` });
      setConfirming(false);
      onSubmitted(job.id);
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Build not started', message: e.message });
    }
    setSubmitting(false);
  };

  const compute = opts.compute;
  const template = templates.find((t) => t.moid === form.template);
  const certname = form.hostname.includes('.') || !defaultDomain
    ? form.hostname.trim().toLowerCase()
    : `${form.hostname.trim().toLowerCase()}.${defaultDomain}`;
  const groupOptions = groups
    .filter((g) => !form.enc_environment || g.environment === form.enc_environment)
    .map((g) => ({ value: String(g.id), label: `${g.name} (${g.environment})` }));

  return (
    <Stack gap="md">
      {loadError && (
        <Alert color="red" title="vCenter inventory unavailable">
          {loadError}
        </Alert>
      )}

      <Card withBorder padding="md">
        <Title order={4} mb="xs">1. Identity and network</Title>
        <Text size="xs" c="dimmed" mb="sm">
          DNS records and IP allocation are managed outside the GUI; enter the values IPAM assigned.
        </Text>
        <Grid gap="sm">
          <Grid.Col span={{ base: 12, md: 6 }}>
            <TextInput label="Hostname or FQDN" required placeholder={defaultDomain ? `web01 or web01.${defaultDomain}` : 'web01.example.com'}
              value={form.hostname} onChange={(e) => set('hostname', e.currentTarget.value)} error={errors.hostname}
              description={certname ? `Certname: ${certname}` : undefined} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <TextInput label="VM name in vCenter" placeholder="Defaults to the short hostname"
              value={form.vm_name} onChange={(e) => set('vm_name', e.currentTarget.value)} error={errors.vm_name} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
            <TextInput label="IP address" required placeholder="192.0.2.50"
              value={form.ip} onChange={(e) => set('ip', e.currentTarget.value)} error={errors.ip} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
            <TextInput label="Netmask or prefix" required placeholder="24 or 255.255.255.0"
              value={form.netmask} onChange={(e) => set('netmask', e.currentTarget.value)} error={errors.netmask}
              description={prefix ? `/${prefix} = ${prefixToNetmask(prefix)}` : undefined} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
            <TextInput label="Gateway" placeholder="192.0.2.1"
              value={form.gateway} onChange={(e) => set('gateway', e.currentTarget.value)} error={errors.gateway} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
            <TagsInput label="DNS servers" placeholder="Enter to add" value={form.dns_servers}
              onChange={(v) => set('dns_servers', v)} error={errors.dns_servers} maxTags={6} splitChars={[',', ' ']} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <TagsInput label="DNS search domains" placeholder={defaultDomain || 'example.com'} value={form.search_domains}
              onChange={(v) => set('search_domains', v)} error={errors.search_domains} maxTags={6} splitChars={[',', ' ']}
              description="Defaults to the host's domain" />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <TextInput label="vCenter notes" placeholder="Optional annotation"
              value={form.annotation} onChange={(e) => set('annotation', e.currentTarget.value)} />
          </Grid.Col>
        </Grid>
      </Card>

      <Card withBorder padding="md">
        <Group justify="space-between" mb="xs">
          <Title order={4}>2. vCenter placement</Title>
          <Button size="xs" variant="subtle" leftSection={<IconRefresh size={14} />} onClick={loadTop} loading={loading}>
            Reload inventory
          </Button>
        </Group>
        <Grid gap="sm">
          <Grid.Col span={{ base: 12, md: 4 }}>
            <Select label="Datacenter" required searchable data={datacenters.map((d) => ({ value: d.name, label: d.path || d.name }))}
              value={form.datacenter || null} onChange={changeDatacenter} error={errors.datacenter} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 4 }}>
            <Select label="Cluster or standalone host" required searchable disabled={!inventory}
              data={[
                { group: 'Clusters (DRS/HA)', items: (inventory?.compute || []).filter((c) => c.kind === 'cluster').map((c) => option(c)) },
                { group: 'Standalone ESXi hosts', items: (inventory?.compute || []).filter((c) => c.kind === 'host').map((c) => option(c, c.name)) },
              ].filter((g) => g.items.length)}
              value={form.compute || null} onChange={changeCompute} error={errors.compute} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 4 }}>
            <Select label="Resource pool" searchable clearable disabled={!compute}
              placeholder="Root pool of the cluster/host"
              data={opts.resourcePools.map((p) => option(p, p.path === '(root)' ? `${p.name} (root)` : p.path))}
              value={form.resource_pool || null} onChange={(v) => set('resource_pool', v || '')} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 4 }}>
            <Select label="VM folder" searchable clearable disabled={!inventory} placeholder="Datacenter root"
              data={opts.folders.map((f) => option(f))}
              value={form.folder || null} onChange={(v) => set('folder', v || '')} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 4 }}>
            <Stack gap={4}>
              <Group justify="space-between">
                <Text size="sm" fw={500}>Storage <Text span c="red">*</Text></Text>
                <SegmentedControl size="xs" value={form.storage_mode}
                  onChange={(v) => set('storage_mode', v as VmBuildForm['storage_mode'])}
                  data={[{ value: 'datastore', label: 'Datastore' }, { value: 'datastore_cluster', label: 'SDRS cluster' }]} />
              </Group>
              {form.storage_mode === 'datastore' ? (
                <Select searchable disabled={!inventory} aria-label="Datastore"
                  data={opts.datastores.map((d) => option(d, `${d.name} — ${d.details.free_gb ?? '?'} GB free`))}
                  value={form.datastore || null} onChange={(v) => set('datastore', v || '')} error={errors.datastore} />
              ) : (
                <Select searchable disabled={!inventory} aria-label="Datastore cluster"
                  data={opts.datastoreClusters.map((d) => option(d, `${d.name} — ${d.details.free_gb ?? '?'} GB free`))}
                  value={form.datastore_cluster || null} onChange={(v) => set('datastore_cluster', v || '')}
                  error={errors.datastore_cluster} />
              )}
            </Stack>
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 4 }}>
            <Select label="Network (port group)" required searchable disabled={!inventory}
              data={opts.networks.map((n) => option(n, `${n.name}${n.kind === 'dvportgroup' ? ' (distributed)' : ''}`))}
              value={form.network || null} onChange={(v) => set('network', v || '')} error={errors.network} />
          </Grid.Col>
          <Grid.Col span={12}>
            <Select label="Template" required searchable
              data={templates.map((t) => option(t, `${t.name}${t.details.guest_name ? ` — ${t.details.guest_name}` : ''}`))}
              value={form.template || null} onChange={changeTemplate} error={errors.template}
              description={status.settings.template_prefix
                ? `Only templates named ${status.settings.template_prefix}* are listed`
                : 'All vCenter templates visible to the service account are listed'} />
          </Grid.Col>
        </Grid>
        <Card withBorder mt="md" padding="xs" bg="var(--mantine-color-body)">
          <Text size="sm" fw={600} mb={4}>Inventory browser {inventory ? `— ${inventory.datacenter.name}` : ''}</Text>
          <InventoryBrowser
            inventory={inventory}
            templates={templates}
            selection={{
              compute: form.compute, resource_pool: form.resource_pool, folder: form.folder,
              datastore: form.datastore, datastore_cluster: form.datastore_cluster,
              network: form.network, template: form.template,
            }}
            onPick={pick}
          />
        </Card>
      </Card>

      <Card withBorder padding="md">
        <Title order={4} mb="xs">3. Size</Title>
        <Grid gap="sm">
          <Grid.Col span={{ base: 12, sm: 4 }}>
            <NumberInput label="vCPUs" min={1} max={128} value={form.cpus}
              onChange={(v) => set('cpus', Number(v) || 0)} error={errors.cpus} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 4 }}>
            <NumberInput label="Memory (GB)" min={1} max={2048} value={form.memory_gb}
              onChange={(v) => set('memory_gb', Number(v) || 0)} error={errors.memory_gb} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 4 }}>
            <NumberInput label="Disk (GB)" min={template?.details.disk_gb || 1} max={65536} value={form.disk_gb}
              onChange={(v) => set('disk_gb', Number(v) || 0)} error={errors.disk_gb}
              description={template?.details.disk_gb ? `Template disk is ${template.details.disk_gb} GB; clones never shrink` : undefined} />
          </Grid.Col>
        </Grid>
      </Card>

      <Card withBorder padding="md">
        <Title order={4} mb="xs">4. OpenVox agent</Title>
        <Stack gap="sm">
          <Switch checked={form.bootstrap_agent} onChange={(e) => set('bootstrap_agent', e.currentTarget.checked)}
            label="Install the OpenVox agent on first boot"
            description={status.bootstrap.error
              ? `Bootstrap target unavailable: ${status.bootstrap.error}`
              : `install.bash from ${status.bootstrap.pkg_repo_url} → server ${status.bootstrap.server}, CA ${status.bootstrap.ca_server}, OpenVox ${status.bootstrap.agent_version}`} />
          <Switch checked={form.bootstrap_agent && form.sign_certificate} disabled={!form.bootstrap_agent}
            onChange={(e) => set('sign_certificate', e.currentTarget.checked)}
            label="Sign this node's certificate request when it arrives"
            description="Only the CSR whose certname matches this build is signed. Leave off to sign it yourself on the Certificate Authority page." />
          <Grid gap="sm">
            <Grid.Col span={{ base: 12, md: 6 }}>
              <Select label="Classifier environment" clearable disabled={!form.bootstrap_agent}
                placeholder="Leave unset to classify later"
                data={envs.map((e) => e.name)} value={form.enc_environment || null}
                onChange={(v) => setForm((f) => ({ ...f, enc_environment: v || '', enc_group_ids: [] }))}
                error={errors.enc_environment}
                description="Applied after the node's first report reaches OpenVoxDB" />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 6 }}>
              <MultiSelect label="Node groups" clearable searchable disabled={!form.bootstrap_agent || !form.enc_environment}
                data={groupOptions} value={form.enc_group_ids.map(String)}
                onChange={(v) => set('enc_group_ids', v.map(Number))} />
            </Grid.Col>
          </Grid>
        </Stack>
      </Card>

      <Group justify="flex-end">
        <Button variant="default" leftSection={<IconEye size={16} />} onClick={doPreview}>Preview cloud-init</Button>
        <Button leftSection={<IconRocket size={16} />} onClick={() => check() && setConfirming(true)}>Build VM</Button>
      </Group>

      <Modal opened={!!preview} onClose={() => setPreview(null)} title="Guest first-boot configuration" size="xl">
        {preview && (
          <Stack gap="xs">
            <Group gap="xs">
              <Badge variant="light">{preview.certname}</Badge>
              <Badge variant="light" color="gray">VM {preview.vm_name}</Badge>
              <Badge variant="light" color="gray">{preview.ip}/{preview.prefix} ({preview.netmask})</Badge>
            </Group>
            {preview.agent_command && (
              <>
                <Text size="sm" fw={600}>Agent bootstrap command</Text>
                <Code block style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{preview.agent_command}</Code>
              </>
            )}
            <Text size="sm" fw={600}>cloud-init user-data (guestinfo.userdata)</Text>
            <ScrollArea.Autosize mah={420}><Code block>{preview.userdata}</Code></ScrollArea.Autosize>
          </Stack>
        )}
      </Modal>

      <ConfirmModal
        opened={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={doSubmit}
        loading={submitting}
        title="Create this VM in vCenter?"
        body={`Clone ${template?.name || 'the template'} as ${form.vm_name || certname.split('.')[0]} and power it on.`}
        details={[
          `Certname ${certname}, IP ${form.ip}`,
          `Compute ${compute?.name || form.compute}`,
          form.bootstrap_agent ? 'OpenVox agent installs on first boot' : 'No agent bootstrap',
          ...(form.bootstrap_agent && form.sign_certificate ? ['Its certificate request will be signed automatically'] : []),
          ...(form.enc_environment ? [`Classified into ${form.enc_environment} after the first report`] : []),
        ]}
        confirmLabel="Build VM"
      />
    </Stack>
  );
}
