/**
 * Machines this GUI built: live power state, power / snapshot (admin,
 * operator) and destroy with OpenVoxDB / CA / ENC cleanup (admin).
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Badge, Button, Card, Checkbox, Group, Menu, Modal, ScrollArea, Stack, Table, Text, TextInput, Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconCamera, IconChevronDown, IconPlayerPlay, IconPower, IconRefresh, IconRotateClockwise, IconTrash,
} from '@tabler/icons-react';
import { provisioning, type DestroyResult, type ProvisionMachine } from '../../services/api';
import { timeAgo } from '../../utils/timeAgo';

const powerColor = (s?: string) =>
  s === 'poweredOn' ? 'green' : s === 'poweredOff' ? 'gray' : s === 'missing' ? 'red' : 'yellow';

export function MachinesPanel({ isAdmin }: { isAdmin: boolean }) {
  const [rows, setRows] = useState<ProvisionMachine[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [snapFor, setSnapFor] = useState<ProvisionMachine | null>(null);
  const [snapName, setSnapName] = useState('');
  const [destroyFor, setDestroyFor] = useState<ProvisionMachine | null>(null);
  const [confirm, setConfirm] = useState('');
  const [cleanup, setCleanup] = useState({ deactivate: true, clean_cert: true, remove_enc: true });
  const [destroyResult, setDestroyResult] = useState<DestroyResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await provisioning.machines(true));
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (m: ProvisionMachine, action: 'on' | 'off' | 'shutdown' | 'reboot') => {
    setBusy(m.job_id);
    try {
      const r = await provisioning.power(m.job_id, action);
      notifications.show({ color: 'green', title: `Power ${action}`, message: `${m.certname}: ${r.power_state}` });
      await load();
    } catch (e: any) {
      notifications.show({ color: 'red', title: `Power ${action} failed`, message: e.message });
    }
    setBusy(null);
  };

  const takeSnapshot = async () => {
    if (!snapFor) return;
    setBusy(snapFor.job_id);
    try {
      await provisioning.snapshot(snapFor.job_id, snapName.trim());
      notifications.show({ color: 'green', title: 'Snapshot taken', message: `${snapFor.certname}: ${snapName}` });
      setSnapFor(null);
      setSnapName('');
      await load();
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Snapshot failed', message: e.message });
    }
    setBusy(null);
  };

  const doDestroy = async () => {
    if (!destroyFor) return;
    setBusy(destroyFor.job_id);
    try {
      setDestroyResult(await provisioning.destroy(destroyFor.job_id, { confirm, ...cleanup }));
      setDestroyFor(null);
      setConfirm('');
      await load();
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Destroy failed', message: e.message });
    }
    setBusy(null);
  };

  return (
    <Card withBorder padding="sm">
      <Group justify="space-between" mb="xs">
        <div>
          <Title order={4}>Machines</Title>
          <Text size="xs" c="dimmed">VMs this GUI built. Other VMs in vCenter are never shown or changed here.</Text>
        </div>
        <Button size="xs" variant="subtle" leftSection={<IconRefresh size={14} />} onClick={load} loading={loading}>Refresh</Button>
      </Group>
      {error && <Alert color="red" mb="xs">{error}</Alert>}
      {!rows.length ? <Text size="sm" c="dimmed">No machines yet.</Text> : (
        <ScrollArea>
          <Table highlightOnHover fz="sm" verticalSpacing={6} miw={820}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Machine</Table.Th><Table.Th>Power</Table.Th><Table.Th>IP</Table.Th>
                <Table.Th>Connection</Table.Th><Table.Th>Built</Table.Th><Table.Th>Snapshots</Table.Th><Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((m) => (
                <Table.Tr key={m.job_id}>
                  <Table.Td><Text size="sm" fw={500}>{m.certname}</Text><Text size="xs" c="dimmed">{m.instance_id}</Text></Table.Td>
                  <Table.Td>
                    {m.live?.error
                      ? <Text size="xs" c="red">{m.live.error}</Text>
                      : <Badge size="sm" tt="none" color={powerColor(m.live?.power_state)} style={{ minWidth: 'max-content' }}>
                          {m.live?.power_state || 'unknown'}</Badge>}
                  </Table.Td>
                  <Table.Td>{m.live?.ip_address || m.guest_ip || '—'}</Table.Td>
                  <Table.Td>{m.connection_id}</Table.Td>
                  <Table.Td>{m.created_at ? timeAgo(m.created_at) : '—'} · {m.requested_by}</Table.Td>
                  <Table.Td>{m.snapshots.length || '—'}</Table.Td>
                  <Table.Td>
                    <Group gap={4} wrap="nowrap" justify="flex-end">
                      <Menu shadow="md" position="bottom-end">
                        <Menu.Target>
                          <Button size="compact-xs" variant="light" rightSection={<IconChevronDown size={12} />}
                            loading={busy === m.job_id} disabled={m.live?.power_state === 'missing'}>Actions</Button>
                        </Menu.Target>
                        <Menu.Dropdown>
                          <Menu.Item leftSection={<IconPlayerPlay size={14} />} onClick={() => act(m, 'on')}>Power on</Menu.Item>
                          <Menu.Item leftSection={<IconPower size={14} />} onClick={() => act(m, 'shutdown')}>Shut down guest</Menu.Item>
                          <Menu.Item leftSection={<IconPower size={14} />} onClick={() => act(m, 'off')}>Power off</Menu.Item>
                          <Menu.Item leftSection={<IconRotateClockwise size={14} />} onClick={() => act(m, 'reboot')}>Reboot</Menu.Item>
                          <Menu.Item leftSection={<IconCamera size={14} />} onClick={() => { setSnapFor(m); setSnapName(''); }}>Snapshot…</Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                      {isAdmin && (
                        <Button size="compact-xs" variant="subtle" color="red" leftSection={<IconTrash size={12} />}
                          onClick={() => { setDestroyFor(m); setConfirm(''); }}>Destroy</Button>
                      )}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}

      <Modal opened={!!snapFor} onClose={() => setSnapFor(null)} title={`Snapshot ${snapFor?.certname ?? ''}`}>
        <Stack gap="sm">
          <TextInput label="Snapshot name" placeholder="before-patching" value={snapName}
            onChange={(e) => setSnapName(e.currentTarget.value)} data-autofocus />
          <Text size="xs" c="dimmed">Memory is not included; the guest is not quiesced.</Text>
          <Group justify="flex-end">
            <Button onClick={takeSnapshot} disabled={!snapName.trim()} loading={busy === snapFor?.job_id}>Take snapshot</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={!!destroyFor} onClose={() => setDestroyFor(null)} title={`Destroy ${destroyFor?.certname ?? ''}?`}>
        <Stack gap="sm">
          <Alert color="red">This powers the VM off and deletes it and its disks from vCenter. It cannot be undone.</Alert>
          <Checkbox label="Deactivate the node in OpenVoxDB" checked={cleanup.deactivate}
            onChange={(e) => setCleanup((c) => ({ ...c, deactivate: e.currentTarget.checked }))} />
          <Checkbox label="Clean its certificate on the CA" checked={cleanup.clean_cert}
            onChange={(e) => setCleanup((c) => ({ ...c, clean_cert: e.currentTarget.checked }))} />
          <Checkbox label="Remove its Node Classifier entry" checked={cleanup.remove_enc}
            onChange={(e) => setCleanup((c) => ({ ...c, remove_enc: e.currentTarget.checked }))} />
          <TextInput label={`Type ${destroyFor?.certname ?? ''} to confirm`} value={confirm}
            onChange={(e) => setConfirm(e.currentTarget.value)} />
          <Group justify="flex-end">
            <Button color="red" onClick={doDestroy} loading={busy === destroyFor?.job_id}
              disabled={confirm.trim().toLowerCase() !== destroyFor?.certname}>Destroy</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={!!destroyResult} onClose={() => setDestroyResult(null)} title={`Destroyed ${destroyResult?.certname ?? ''}`}>
        <Stack gap={6}>
          {destroyResult && Object.entries(destroyResult.steps).map(([k, v]) => (
            <Group key={k} gap="xs" wrap="nowrap">
              <Badge size="sm" color={v.ok ? 'green' : 'red'}>{k}</Badge>
              <Text size="sm">{v.message}</Text>
            </Group>
          ))}
        </Stack>
      </Modal>
    </Card>
  );
}
