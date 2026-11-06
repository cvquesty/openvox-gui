/**
 * VMware provider placement: datacenter, compute, pool, folder, storage,
 * template, plus the inventory browser. The rest of the build form is shared
 * across providers.
 */
import {
  Button, Card, Grid, Group, SegmentedControl, Select, Stack, Text, Title,
} from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';
import type {
  BuildFormState, FormErrors, InventoryItem, VmwareDatacenterInventory,
} from '../../utils/provisioning';
import { ISO_GUEST_OS, placementOptions } from '../../utils/provisioning';
import { InventoryBrowser, type PickField } from './InventoryBrowser';

export const inventoryOption = (i: InventoryItem, label?: string) => ({ value: i.moid, label: label || i.path || i.name });

export function VmwarePlacement({
  form, errors, scopes, inventory, images, isos, templatePrefix, loading,
  onReload, onDatacenter, onCompute, onImage, onPick, set,
}: {
  form: BuildFormState;
  errors: FormErrors;
  scopes: InventoryItem[];
  inventory: VmwareDatacenterInventory | null;
  images: InventoryItem[];
  isos: InventoryItem[];
  templatePrefix: string;
  loading: boolean;
  onReload: () => void;
  onDatacenter: (name: string | null) => void;
  onCompute: (moid: string | null) => void;
  onImage: (moid: string | null) => void;
  onPick: (field: PickField, moid: string) => void;
  set: <K extends keyof BuildFormState>(key: K, value: BuildFormState[K]) => void;
}) {
  const opts = placementOptions(inventory, form.compute);
  return (
    <Card withBorder padding="md">
      <Group justify="space-between" mb="xs">
        <Group gap="sm">
          <Title order={4}>2. vCenter placement</Title>
          <SegmentedControl size="xs" value={form.mode}
            onChange={(v) => {
              set('mode', v as BuildFormState['mode']);
              if (v === 'iso') set('storage_mode', 'datastore');
            }}
            data={[{ value: 'clone', label: 'Template clone' }, { value: 'iso', label: 'ISO install' }]} />
        </Group>
        <Button size="xs" variant="subtle" leftSection={<IconRefresh size={14} />} onClick={onReload} loading={loading}>
          Reload inventory
        </Button>
      </Group>
      <Grid gap="sm">
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Select label="Datacenter" required searchable data={scopes.map((d) => ({ value: d.name, label: d.path || d.name }))}
            value={form.datacenter || null} onChange={onDatacenter} error={errors.datacenter} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Select label="Cluster or standalone host" required searchable disabled={!inventory}
            data={[
              { group: 'Clusters (DRS/HA)', items: (inventory?.compute || []).filter((c) => c.kind === 'cluster').map((c) => inventoryOption(c)) },
              { group: 'Standalone ESXi hosts', items: (inventory?.compute || []).filter((c) => c.kind === 'host').map((c) => inventoryOption(c, c.name)) },
            ].filter((g) => g.items.length)}
            value={form.compute || null} onChange={onCompute} error={errors.compute} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Select label="Resource pool" searchable clearable disabled={!opts.compute}
            placeholder="Root pool of the cluster/host"
            data={opts.resourcePools.map((p) => inventoryOption(p, p.path === '(root)' ? `${p.name} (root)` : p.path))}
            value={form.resource_pool || null} onChange={(v) => set('resource_pool', v || '')} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Select label="VM folder" searchable clearable disabled={!inventory} placeholder="Datacenter root"
            data={opts.folders.map((f) => inventoryOption(f))}
            value={form.folder || null} onChange={(v) => set('folder', v || '')} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Stack gap={4}>
            <Group justify="space-between">
              <Text size="sm" fw={500}>Storage <Text span c="red">*</Text></Text>
              <SegmentedControl size="xs" value={form.storage_mode} disabled={form.mode === 'iso'}
                onChange={(v) => set('storage_mode', v as BuildFormState['storage_mode'])}
                data={[{ value: 'datastore', label: 'Datastore' }, { value: 'datastore_cluster', label: 'SDRS cluster' }]} />
            </Group>
            {form.storage_mode === 'datastore' ? (
              <Select searchable disabled={!inventory} aria-label="Datastore"
                data={opts.datastores.map((d) => inventoryOption(d, `${d.name} — ${d.details.free_gb ?? '?'} GB free`))}
                value={form.datastore || null} onChange={(v) => set('datastore', v || '')} error={errors.datastore} />
            ) : (
              <Select searchable disabled={!inventory} aria-label="Datastore cluster"
                data={opts.datastoreClusters.map((d) => inventoryOption(d, `${d.name} — ${d.details.free_gb ?? '?'} GB free`))}
                value={form.datastore_cluster || null} onChange={(v) => set('datastore_cluster', v || '')}
                error={errors.datastore_cluster} />
            )}
          </Stack>
        </Grid.Col>
        {form.mode === 'iso' ? (
          <>
            <Grid.Col span={{ base: 12, md: 4 }}>
              <Select label="ISO library datastore" searchable disabled={!inventory}
                data={(inventory?.datastores || []).map((d) => inventoryOption(d, d.name))}
                value={form.iso_datastore || null}
                onChange={(v) => { set('iso_datastore', v || ''); set('install_media', ''); }} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 5 }}>
              <Select label="Install ISO" required searchable disabled={!form.iso_datastore}
                placeholder={form.iso_datastore && !isos.length ? 'No ISOs found on this datastore' : undefined}
                data={isos.map((i) => ({ value: i.moid, label: i.name }))}
                value={form.install_media || null} onChange={(v) => set('install_media', v || '')}
                error={errors.install_media} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 3 }}>
              <Select label="Guest OS type" data={ISO_GUEST_OS} value={form.guest_os}
                onChange={(v) => set('guest_os', v || 'otherLinux64Guest')} allowDeselect={false} />
            </Grid.Col>
            <Grid.Col span={12}>
              <Text size="xs" c="dimmed">
                Creates an empty VM booting the ISO. Install the OS from the vCenter console, then press Continue on
                the Builds tab with a login the GUI can use over SSH; it detaches the ISO and bootstraps the agent.
              </Text>
            </Grid.Col>
          </>
        ) : (
        <Grid.Col span={12}>
          <Select label="Template" required searchable
            data={images.map((t) => inventoryOption(t, `${t.name}${t.details.guest_name ? ` — ${t.details.guest_name}` : ''}`))}
            value={form.image || null} onChange={onImage} error={errors.image}
            description={templatePrefix
              ? `Only templates named ${templatePrefix}* are listed`
              : 'All vCenter templates visible to the service account are listed'} />
        </Grid.Col>
        )}
      </Grid>
      <Card withBorder mt="md" padding="xs" bg="var(--mantine-color-body)">
        <Text size="sm" fw={600} mb={4}>Inventory browser {inventory ? `— ${inventory.datacenter.name}` : ''}</Text>
        <InventoryBrowser
          inventory={inventory}
          templates={images}
          selection={{
            compute: form.compute, resource_pool: form.resource_pool, folder: form.folder,
            datastore: form.datastore, datastore_cluster: form.datastore_cluster,
            network: form.network, image: form.image,
          }}
          onPick={onPick}
        />
      </Card>
    </Card>
  );
}
