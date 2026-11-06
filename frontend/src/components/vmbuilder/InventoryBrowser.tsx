/**
 * Tabbed vCenter inventory tables for the selected datacenter
 * (ovbuilder's numbered inventory menus, as clickable tables).
 * "Use" fills the matching placement field on the build form.
 */
import type { ReactNode } from 'react';
import { Badge, Button, Group, ScrollArea, Table, Tabs, Text } from '@mantine/core';
import type { VmDatacenterInventory, VmInventoryItem } from '../../utils/vmbuilder';

export type PickField =
  'compute' | 'resource_pool' | 'folder' | 'datastore' | 'datastore_cluster' | 'network' | 'template';

interface Column {
  label: string;
  render: (item: VmInventoryItem) => ReactNode;
}

const kindBadge = (kind: string) => {
  const labels: Record<string, string> = {
    cluster: 'DRS/HA cluster',
    host: 'standalone host',
    dvportgroup: 'distributed',
    network: 'standard',
    opaque: 'NSX',
    vapp: 'vApp',
    resource_pool: 'pool',
  };
  return <Badge size="xs" variant="light">{labels[kind] || kind}</Badge>;
};

const gb = (v: unknown) => (typeof v === 'number' ? `${v.toLocaleString()} GB` : '—');

function ItemTable({
  items, columns, selected, onUse,
}: {
  items: VmInventoryItem[];
  columns: Column[];
  selected: string;
  onUse?: (moid: string) => void;
}) {
  if (!items.length) {
    return <Text size="sm" c="dimmed" p="sm">Nothing visible to this vCenter account.</Text>;
  }
  return (
    <ScrollArea.Autosize mah={320}>
      <Table striped highlightOnHover verticalSpacing={4} fz="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Name</Table.Th>
            {columns.map((c) => <Table.Th key={c.label}>{c.label}</Table.Th>)}
            {onUse && <Table.Th />}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {items.map((item) => (
            <Table.Tr key={item.moid} bg={item.moid === selected ? 'var(--mantine-primary-color-light)' : undefined}>
              <Table.Td>
                <Text size="sm" fw={500}>{item.path && item.path !== '(root)' ? item.path : item.name}</Text>
                <Text size="xs" c="dimmed">{item.moid}</Text>
              </Table.Td>
              {columns.map((c) => <Table.Td key={c.label}>{c.render(item)}</Table.Td>)}
              {onUse && (
                <Table.Td>
                  <Button size="compact-xs" variant={item.moid === selected ? 'filled' : 'light'}
                    onClick={() => onUse(item.moid)}>
                    {item.moid === selected ? 'Selected' : 'Use'}
                  </Button>
                </Table.Td>
              )}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </ScrollArea.Autosize>
  );
}

export function InventoryBrowser({
  inventory, templates, selection, onPick,
}: {
  inventory: VmDatacenterInventory | null;
  templates: VmInventoryItem[];
  selection: Record<PickField, string>;
  onPick: (field: PickField, moid: string) => void;
}) {
  const pools = inventory?.resource_pools.filter((p) => !selection.compute || p.parent === selection.compute) || [];
  const computeName = (moid: string) => inventory?.compute.find((c) => c.moid === moid)?.name || moid;
  return (
    <Tabs defaultValue="compute" keepMounted={false}>
      <Tabs.List>
        <Tabs.Tab value="compute">Compute ({inventory?.compute.length ?? 0})</Tabs.Tab>
        <Tabs.Tab value="pools">Resource pools ({pools.length})</Tabs.Tab>
        <Tabs.Tab value="folders">Folders ({inventory?.folders.length ?? 0})</Tabs.Tab>
        <Tabs.Tab value="storage">
          Storage ({(inventory?.datastores.length ?? 0) + (inventory?.datastore_clusters.length ?? 0)})
        </Tabs.Tab>
        <Tabs.Tab value="networks">Networks ({inventory?.networks.length ?? 0})</Tabs.Tab>
        <Tabs.Tab value="templates">Templates ({templates.length})</Tabs.Tab>
      </Tabs.List>

      <Tabs.Panel value="compute" pt="xs">
        <ItemTable
          items={inventory?.compute || []}
          selected={selection.compute}
          onUse={(m) => onPick('compute', m)}
          columns={[
            { label: 'Type', render: (i) => kindBadge(i.kind) },
            { label: 'Hosts', render: (i) => i.details.hosts ?? '—' },
            { label: 'Memory', render: (i) => (i.details.memory_mb ? `${Math.round(i.details.memory_mb / 1024)} GB` : '—') },
          ]}
        />
      </Tabs.Panel>
      <Tabs.Panel value="pools" pt="xs">
        {!selection.compute && <Text size="xs" c="dimmed" mb={4}>Showing all pools; pick compute to narrow.</Text>}
        <ItemTable
          items={selection.compute ? pools : inventory?.resource_pools || []}
          selected={selection.resource_pool}
          onUse={selection.compute ? (m) => onPick('resource_pool', m) : undefined}
          columns={[
            { label: 'Type', render: (i) => kindBadge(i.kind) },
            { label: 'Owner', render: (i) => computeName(i.parent) },
          ]}
        />
      </Tabs.Panel>
      <Tabs.Panel value="folders" pt="xs">
        <ItemTable items={inventory?.folders || []} selected={selection.folder}
          onUse={(m) => onPick('folder', m)} columns={[]} />
      </Tabs.Panel>
      <Tabs.Panel value="storage" pt="xs">
        <Text size="xs" fw={600} mb={4}>Datastore clusters (Storage DRS picks the LUN)</Text>
        <ItemTable
          items={inventory?.datastore_clusters || []}
          selected={selection.datastore_cluster}
          onUse={(m) => onPick('datastore_cluster', m)}
          columns={[
            { label: 'Free', render: (i) => gb(i.details.free_gb) },
            { label: 'Capacity', render: (i) => gb(i.details.capacity_gb) },
          ]}
        />
        <Text size="xs" fw={600} mt="sm" mb={4}>Datastores</Text>
        <ItemTable
          items={inventory?.datastores || []}
          selected={selection.datastore}
          onUse={(m) => onPick('datastore', m)}
          columns={[
            { label: 'Type', render: (i) => i.details.type || '—' },
            { label: 'Free', render: (i) => gb(i.details.free_gb) },
            { label: 'Capacity', render: (i) => gb(i.details.capacity_gb) },
            {
              label: 'State',
              render: (i) => (i.details.accessible === false
                ? <Badge size="xs" color="red">inaccessible</Badge>
                : <Badge size="xs" color="green" variant="light">ok</Badge>),
            },
          ]}
        />
      </Tabs.Panel>
      <Tabs.Panel value="networks" pt="xs">
        <ItemTable items={inventory?.networks || []} selected={selection.network}
          onUse={(m) => onPick('network', m)} columns={[{ label: 'Type', render: (i) => kindBadge(i.kind) }]} />
      </Tabs.Panel>
      <Tabs.Panel value="templates" pt="xs">
        <ItemTable
          items={templates}
          selected={selection.template}
          onUse={(m) => onPick('template', m)}
          columns={[
            { label: 'Guest OS', render: (i) => i.details.guest_name || i.details.guest_id || '—' },
            {
              label: 'Size',
              render: (i) => (
                <Group gap={4} wrap="nowrap">
                  <Text size="xs">{i.details.cpus} vCPU</Text>
                  <Text size="xs">· {Math.round((i.details.memory_mb || 0) / 1024)} GB</Text>
                  <Text size="xs">· {i.details.disk_gb} GB disk</Text>
                </Group>
              ),
            },
            { label: 'Datacenter', render: (i) => i.details.datacenter || '—' },
          ]}
        />
      </Tabs.Panel>
    </Tabs>
  );
}
