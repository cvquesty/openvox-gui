/**
 * Provisioning build form. Identity, NICs, size, OpenVox bootstrap and the
 * classifier handoff are shared; placement comes from the provider
 * component (VmwarePlacement today).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActionIcon, Alert, Badge, Button, Card, Code, Grid, Group, Modal, MultiSelect, NumberInput,
  ScrollArea, Select, Stack, Switch, TagsInput, Text, TextInput, Title, Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDeviceFloppy, IconEye, IconPlus, IconRocket, IconTrash } from '@tabler/icons-react';
import { ConfirmModal } from '../ConfirmModal';
import {
  enc, provisioning, type BootstrapProfile, type ProvisioningStatus, type ProvisionPreset, type ProvisionPreview,
} from '../../services/api';
import {
  EMPTY_BUILD_FORM, MAX_NICS, applyPreset, buildPayload, certnameFor, errorCount, firstError, parsePrefix,
  placementOptions, prefixToNetmask, presetFromForm, slugify, validateBuildForm,
  type BuildFormState, type FormErrors, type InventoryItem, type VmwareDatacenterInventory,
} from '../../utils/provisioning';
import type { PickField } from './InventoryBrowser';
import { VmwarePlacement, inventoryOption } from './VmwarePlacement';

export function BuildForm({
  status, onSubmitted,
}: {
  status: ProvisioningStatus;
  onSubmitted: (jobId: string) => void;
}) {
  const defaultDomain = status.settings.default_domain || '';
  const usable = status.connections.filter((c) => c.configured);
  const [form, setForm] = useState<BuildFormState>({ ...EMPTY_BUILD_FORM, connection: status.default_connection });
  const [errors, setErrors] = useState<FormErrors>({});
  const [scopes, setScopes] = useState<InventoryItem[]>([]);
  const [inventory, setInventory] = useState<VmwareDatacenterInventory | null>(null);
  const [images, setImages] = useState<InventoryItem[]>([]);
  const [envs, setEnvs] = useState<{ name: string }[]>([]);
  const [groups, setGroups] = useState<{ id: number; name: string; environment: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ProvisionPreview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [presetList, setPresetList] = useState<ProvisionPreset[]>([]);
  const [presetId, setPresetId] = useState<string | null>(null);
  const [presetName, setPresetName] = useState('');
  const [savingPreset, setSavingPreset] = useState(false);
  const [profiles, setProfiles] = useState<BootstrapProfile[]>([]);
  const [isos, setIsos] = useState<InventoryItem[]>([]);

  const connection = status.connections.find((c) => c.id === form.connection);

  const set = <K extends keyof BuildFormState>(key: K, value: BuildFormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const loadTop = useCallback(async () => {
    if (!form.connection) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [dcs, imgs] = await Promise.all([provisioning.scopes(form.connection), provisioning.images(form.connection)]);
      setScopes(dcs);
      setImages(imgs);
      const preferredName = connection?.options?.default_datacenter;
      setForm((f) => {
        if (f.datacenter && dcs.some((d) => d.name === f.datacenter)) return f;
        const preferred = dcs.find((d) => d.name === preferredName) || (dcs.length === 1 ? dcs[0] : null);
        return { ...f, datacenter: preferred ? preferred.name : '' };
      });
    } catch (e: any) {
      setLoadError(e.message);
    }
    setLoading(false);
  }, [form.connection, connection?.options?.default_datacenter]);

  useEffect(() => { loadTop(); }, [loadTop]);

  useEffect(() => {
    Promise.allSettled([enc.listEnvironments(), enc.listGroups(), provisioning.profiles()]).then(([e, g, p]) => {
      if (e.status === 'fulfilled') setEnvs(e.value);
      if (g.status === 'fulfilled') setGroups(g.value);
      if (p.status === 'fulfilled') setProfiles(p.value);
    });
  }, []);

  const loadPresets = useCallback(() => {
    if (!form.connection) return;
    provisioning.presets(form.connection).then(setPresetList).catch(() => setPresetList([]));
  }, [form.connection]);
  useEffect(() => { loadPresets(); }, [loadPresets]);

  const choosePreset = (id: string | null) => {
    setPresetId(id);
    const preset = presetList.find((p) => p.id === id);
    if (preset) {
      setForm((f) => applyPreset(f, preset));
      setPresetName(preset.name);
      setErrors({});
    }
  };

  const savePreset = async () => {
    const name = presetName.trim();
    if (!name) return;
    setSavingPreset(true);
    try {
      const saved = await provisioning.savePreset(presetId || slugify(name), presetFromForm(form, name));
      notifications.show({ color: 'green', title: 'Preset saved', message: saved.name });
      setPresetId(saved.id);
      loadPresets();
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Preset not saved', message: e.message });
    }
    setSavingPreset(false);
  };

  useEffect(() => {
    if (!form.connection || !form.datacenter) { setInventory(null); return; }
    let cancelled = false;
    setInventory(null);
    provisioning.inventory(form.connection, form.datacenter)
      .then((inv) => { if (!cancelled) setInventory(inv); })
      .catch((e) => { if (!cancelled) setLoadError(e.message); });
    return () => { cancelled = true; };
  }, [form.connection, form.datacenter]);

  useEffect(() => {
    if (form.mode !== 'iso' || !form.connection || !form.datacenter || !form.iso_datastore) { setIsos([]); return; }
    let cancelled = false;
    provisioning.isos(form.connection, form.datacenter, form.iso_datastore)
      .then((rows) => { if (!cancelled) setIsos(rows); })
      .catch((e) => { if (!cancelled) setLoadError(e.message); });
    return () => { cancelled = true; };
  }, [form.mode, form.connection, form.datacenter, form.iso_datastore]);

  const opts = useMemo(() => placementOptions(inventory, form.compute), [inventory, form.compute]);
  const networkOptions = opts.networks.map((n) => inventoryOption(n, `${n.name}${n.kind === 'dvportgroup' ? ' (distributed)' : ''}`));
  const prefix = parsePrefix(form.netmask);
  const certname = certnameFor(form.hostname, defaultDomain);

  const clearPlacement = (f: BuildFormState): BuildFormState => ({
    ...f, compute: '', resource_pool: '', folder: '', datastore: '', datastore_cluster: '',
    network: '', extra_nics: f.extra_nics.map((n) => ({ ...n, network: '' })),
  });

  const changeConnection = (id: string | null) => {
    setForm((f) => ({ ...clearPlacement(f), connection: id || status.default_connection, datacenter: '', image: '' }));
  };
  const changeDatacenter = (name: string | null) => {
    setForm((f) => ({ ...clearPlacement(f), datacenter: name || '' }));
  };
  const changeCompute = (moid: string | null) => {
    setForm((f) => ({
      ...f, compute: moid || '', resource_pool: '', datastore: '', datastore_cluster: '',
      network: '', extra_nics: f.extra_nics.map((n) => ({ ...n, network: '' })),
    }));
    setErrors((e) => ({ ...e, compute: undefined }));
  };
  const changeImage = (moid: string | null) => {
    const tpl = images.find((t) => t.moid === moid);
    setForm((f) => ({
      ...f,
      image: moid || '',
      // Clones never shrink the template disk (ovbuilder rule).
      disk_gb: tpl?.details.disk_gb ? Math.max(f.disk_gb, tpl.details.disk_gb) : f.disk_gb,
    }));
    setErrors((e) => ({ ...e, image: undefined }));
  };
  const pick = (field: PickField, moid: string) => {
    if (field === 'compute') return changeCompute(moid);
    if (field === 'image') return changeImage(moid);
    if (field === 'datastore' || field === 'datastore_cluster') {
      setForm((f) => ({ ...f, storage_mode: field, [field]: moid }));
      return;
    }
    set(field, moid);
  };

  const setNic = (idx: number, patch: Partial<BuildFormState['extra_nics'][number]>) => {
    setForm((f) => ({ ...f, extra_nics: f.extra_nics.map((n, i) => (i === idx ? { ...n, ...patch } : n)) }));
    setErrors((e) => ({ ...e, nics: undefined }));
  };

  const check = (): boolean => {
    const errs = validateBuildForm(form, defaultDomain);
    setErrors(errs);
    if (errorCount(errs)) {
      notifications.show({ color: 'red', title: 'Check the form', message: firstError(errs) });
      return false;
    }
    return true;
  };

  const doPreview = async () => {
    if (!check()) return;
    try {
      setPreview(await provisioning.preview(buildPayload(form)));
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Preview failed', message: e.message });
    }
  };

  const doSubmit = async () => {
    setSubmitting(true);
    try {
      const job = await provisioning.submit(buildPayload(form));
      notifications.show({ color: 'green', title: 'Build queued', message: `${job.certname} queued` });
      setConfirming(false);
      onSubmitted(job.id);
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Build not started', message: e.message });
    }
    setSubmitting(false);
  };

  const template = images.find((t) => t.moid === form.image);
  const groupOptions = groups
    .filter((g) => !form.enc_environment || g.environment === form.enc_environment)
    .map((g) => ({ value: String(g.id), label: `${g.name} (${g.environment})` }));

  return (
    <Stack gap="md">
      {loadError && <Alert color="red" title="Provider inventory unavailable">{loadError}</Alert>}

      <Card withBorder padding="sm">
        <Grid gap="sm" align="flex-end">
          {usable.length > 1 && (
            <Grid.Col span={{ base: 12, md: 4 }}>
              <Select label="Connection" data={usable.map((c) => ({ value: c.id, label: `${c.name} — ${c.provider_label} (${c.host})` }))}
                value={form.connection} onChange={changeConnection} allowDeselect={false} />
            </Grid.Col>
          )}
          <Grid.Col span={{ base: 12, md: 4 }}>
            <Select label="Preset" placeholder={presetList.length ? 'Fill placement, NICs and size' : 'No presets yet'}
              clearable data={presetList.map((p) => ({ value: p.id, label: p.name }))}
              value={presetId} onChange={choosePreset} disabled={!presetList.length} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 4 }}>
            <Group gap="xs" wrap="nowrap" align="flex-end">
              <TextInput label="Save current choices as" placeholder="Preset name" style={{ flex: 1 }}
                value={presetName} onChange={(e) => setPresetName(e.currentTarget.value)} />
              <Button variant="default" leftSection={<IconDeviceFloppy size={14} />} onClick={savePreset}
                loading={savingPreset} disabled={!presetName.trim()}>
                {presetId && presetList.find((p) => p.id === presetId)?.name === presetName.trim() ? 'Update' : 'Save'}
              </Button>
            </Group>
          </Grid.Col>
        </Grid>
      </Card>

      <Card withBorder padding="md">
        <Title order={4} mb="xs">1. Identity and network</Title>
        <Text size="xs" c="dimmed" mb="sm">
          DNS records and IP allocation are managed outside the GUI; enter the values IPAM assigned.
        </Text>
        <Grid gap="sm">
          <Grid.Col span={{ base: 12, md: 6 }}>
            <TextInput label="Hostname or FQDN" required placeholder={defaultDomain ? `web01 or web01.${defaultDomain}` : 'web01.example.com'}
              value={form.hostname} onChange={(e) => set('hostname', e.currentTarget.value)} error={errors.hostname}
              description={certname ? `Certname and vCenter VM name: ${certname}` : 'Becomes the certname and the vCenter VM name'} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <TextInput label="vCenter notes" placeholder="Optional annotation"
              value={form.annotation} onChange={(e) => set('annotation', e.currentTarget.value)} />
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
          <Grid.Col span={12}>
            <TagsInput label="DNS search domains" placeholder={defaultDomain || 'example.com'} value={form.search_domains}
              onChange={(v) => set('search_domains', v)} error={errors.search_domains} maxTags={6} splitChars={[',', ' ']}
              description="Defaults to the host's domain" />
          </Grid.Col>
        </Grid>
      </Card>

      <VmwarePlacement
        form={form} errors={errors} scopes={scopes} inventory={inventory} images={images} isos={isos}
        templatePrefix={connection?.options?.template_prefix ?? ''} loading={loading}
        onReload={loadTop} onDatacenter={changeDatacenter} onCompute={changeCompute}
        onImage={changeImage} onPick={pick} set={set}
      />

      <Card withBorder padding="md">
        <Group justify="space-between" mb="xs">
          <Title order={4}>3. Network interfaces</Title>
          <Button size="xs" variant="light" leftSection={<IconPlus size={14} />}
            disabled={form.extra_nics.length + 1 >= MAX_NICS}
            onClick={() => setForm((f) => ({ ...f, extra_nics: [...f.extra_nics, { network: '', ip: '', netmask: '' }] }))}>
            Add NIC
          </Button>
        </Group>
        <Stack gap="xs">
          <Grid gap="sm" align="flex-end">
            <Grid.Col span={{ base: 12, md: 5 }}>
              <Select label="NIC 1 network (port group)" required searchable disabled={!inventory}
                data={networkOptions} value={form.network || null}
                onChange={(v) => set('network', v || '')} error={errors.network} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 7 }}>
              <Text size="xs" c="dimmed">Uses the IP, gateway and DNS above.</Text>
            </Grid.Col>
          </Grid>
          {form.extra_nics.map((nic, idx) => (
            <Grid gap="sm" align="flex-end" key={idx}>
              <Grid.Col span={{ base: 12, md: 5 }}>
                <Select label={`NIC ${idx + 2} network`} required searchable disabled={!inventory}
                  data={networkOptions} value={nic.network || null}
                  onChange={(v) => setNic(idx, { network: v || '' })} error={errors.nics?.[idx]} />
              </Grid.Col>
              <Grid.Col span={{ base: 6, md: 3 }}>
                <TextInput label="IP address" placeholder="Blank = DHCP" value={nic.ip}
                  onChange={(e) => setNic(idx, { ip: e.currentTarget.value })} />
              </Grid.Col>
              <Grid.Col span={{ base: 5, md: 3 }}>
                <TextInput label="Netmask or prefix" placeholder="24" value={nic.netmask} disabled={!nic.ip.trim()}
                  onChange={(e) => setNic(idx, { netmask: e.currentTarget.value })} />
              </Grid.Col>
              <Grid.Col span={1}>
                <Tooltip label="Remove NIC">
                  <ActionIcon variant="subtle" color="red" aria-label={`Remove NIC ${idx + 2}`}
                    onClick={() => setForm((f) => ({ ...f, extra_nics: f.extra_nics.filter((_, i) => i !== idx) }))}>
                    <IconTrash size={16} />
                  </ActionIcon>
                </Tooltip>
              </Grid.Col>
            </Grid>
          ))}
          {form.extra_nics.length > 0 && (
            <Text size="xs" c="dimmed">Extra NICs get no gateway. NICs are matched in PCI order on the guest.</Text>
          )}
        </Stack>
      </Card>

      <Card withBorder padding="md">
        <Title order={4} mb="xs">4. Size</Title>
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
        <Title order={4} mb="xs">5. OpenVox agent</Title>
        <Stack gap="sm">
          <Switch checked={form.bootstrap_agent} onChange={(e) => set('bootstrap_agent', e.currentTarget.checked)}
            label="Install the OpenVox agent on first boot"
            description={status.bootstrap.error
              ? `Agent Install defaults unavailable: ${status.bootstrap.error}`
              : 'Runs install.bash from the bootstrap profile below with certname pinned to the FQDN'} />
          <Select label="Bootstrap profile" disabled={!form.bootstrap_agent} maw={520} allowDeselect={false}
            data={profiles.map((p) => ({ value: p.builtin ? '' : p.id, label: p.builtin ? `${p.name} (built in)` : p.name }))}
            value={form.bootstrap_profile} onChange={(v) => set('bootstrap_profile', v || '')}
            description={(() => {
              const p = profiles.find((x) => (x.builtin ? '' : x.id) === form.bootstrap_profile);
              return p && !p.error ? `server ${p.server}, CA ${p.ca_server || p.server}, mirror ${p.pkg_repo_url}` : undefined;
            })()} />
          <Switch checked={form.bootstrap_agent && form.sign_certificate} disabled={!form.bootstrap_agent}
            onChange={(e) => set('sign_certificate', e.currentTarget.checked)}
            label="Sign this node's certificate request (verified per build)"
            description="The build gives the guest a one-time challenge. Only a CSR for this certname that carries it is signed; any other CSR is rejected. Leave off to sign it yourself on the Certificate Authority page." />
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
              <Badge variant="light" color="gray">{preview.ip}/{preview.prefix} ({preview.netmask})</Badge>
              <Badge variant="light" color="gray">{preview.nics.length} NIC{preview.nics.length === 1 ? '' : 's'}</Badge>
            </Group>
            {preview.agent_command && (
              <>
                <Text size="sm" fw={600}>Agent bootstrap command</Text>
                <Code block style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{preview.agent_command}</Code>
                {form.sign_certificate && (
                  <Text size="xs" c="dimmed">The challenge shown is a placeholder; the real token is generated when the build starts and is never displayed.</Text>
                )}
              </>
            )}
            <Text size="sm" fw={600}>{form.mode === 'iso' ? 'Scripts run over SSH after the install' : 'cloud-init user-data'}</Text>
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
        body={form.mode === 'iso'
          ? `Create ${certname} booting ${form.install_media.split('] ').pop()} and power it on.`
          : `Clone ${template?.name || 'the template'} as ${certname} and power it on.`}
        details={[
          `IP ${form.ip}${form.extra_nics.length ? ` + ${form.extra_nics.length} extra NIC(s)` : ''}`,
          `Compute ${opts.compute?.name || form.compute}${connection ? ` on ${connection.name}` : ''}`,
          form.bootstrap_agent ? 'OpenVox agent installs on first boot' : 'No agent bootstrap',
          ...(form.bootstrap_agent && form.sign_certificate ? ['Its CSR is signed only if it carries this build\'s challenge'] : []),
          ...(form.enc_environment ? [`Classified into ${form.enc_environment} after the first report`] : []),
        ]}
        confirmLabel="Build VM"
      />
    </Stack>
  );
}
