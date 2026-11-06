/**
 * Provisioning jobs: list + per-step progress for the selected job.
 * Polls while the selected job is queued or running.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Alert, Badge, Button, Card, Code, Grid, Group, NumberInput, PasswordInput, ScrollArea, Stack, Table, Text,
  Textarea, TextInput, Timeline, Title,
} from '@mantine/core';
import { IconPlayerStop, IconRefresh } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { provisioning, type ProvisionJob } from '../../services/api';
import { STEP_LABELS, statusColor } from '../../utils/provisioning';
import { timeAgo } from '../../utils/timeAgo';

const ACTIVE = new Set(['queued', 'running', 'cancelling']);

export function BuildJobs({
  selectedId, onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<ProvisionJob[]>([]);
  const [job, setJob] = useState<ProvisionJob | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    try {
      setJobs(await provisioning.builds());
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  useEffect(() => {
    if (!selectedId) { setJob(null); return; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const tick = async () => {
      try {
        const j = await provisioning.build(selectedId);
        if (cancelled) return;
        setJob(j);
        if (ACTIVE.has(j.status)) timer = setTimeout(tick, 5000);
        else loadList();
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      }
    };
    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [selectedId, loadList]);

  const activeStep = job ? job.steps.findIndex((s) => s.state === 'pending' || s.state === 'running') : -1;

  const [ssh, setSsh] = useState({ ssh_host: '', ssh_port: 22, username: '', password: '', private_key: '' });
  const [continuing, setContinuing] = useState(false);
  const continueBuild = async () => {
    if (!job) return;
    setContinuing(true);
    try {
      const needsSsh = job.request.bootstrap_agent !== false;
      setJob(await provisioning.continueBuild(job.id, needsSsh ? { ...ssh, ssh_host: ssh.ssh_host || job.request.ip } : {}));
      setSsh({ ssh_host: '', ssh_port: 22, username: '', password: '', private_key: '' });
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Not continued', message: e.message });
    }
    setContinuing(false);
  };

  const cancel = async () => {
    if (!job) return;
    try {
      setJob(await provisioning.cancel(job.id));
      loadList();
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Not cancelled', message: e.message });
    }
  };

  return (
    <Grid gap="md">
      <Grid.Col span={{ base: 12, lg: 5 }}>
        <Card withBorder padding="sm">
          <Group justify="space-between" mb="xs">
            <Title order={4}>Builds</Title>
            <Button size="xs" variant="subtle" leftSection={<IconRefresh size={14} />} onClick={loadList}>Refresh</Button>
          </Group>
          {error && <Alert color="red" mb="xs">{error}</Alert>}
          {!jobs.length ? (
            <Text size="sm" c="dimmed">No VM builds yet.</Text>
          ) : (
            <ScrollArea.Autosize mah={560}>
              <Table highlightOnHover verticalSpacing={6} fz="sm">
                <Table.Thead>
                  <Table.Tr><Table.Th>Certname</Table.Th><Table.Th>Status</Table.Th><Table.Th>By</Table.Th><Table.Th>Started</Table.Th></Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {jobs.map((j) => (
                    <Table.Tr key={j.id} onClick={() => onSelect(j.id)} style={{ cursor: 'pointer' }}
                      bg={j.id === selectedId ? 'var(--mantine-primary-color-light)' : undefined}>
                      <Table.Td><Text size="sm" fw={500}>{j.certname}</Text></Table.Td>
                      <Table.Td>
                        <Badge size="sm" tt="none" color={statusColor(j.status)} style={{ minWidth: 'max-content' }}>{j.status}</Badge>
                      </Table.Td>
                      <Table.Td>{j.requested_by}</Table.Td>
                      <Table.Td>{j.created_at ? timeAgo(j.created_at) : '—'}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea.Autosize>
          )}
        </Card>
      </Grid.Col>
      <Grid.Col span={{ base: 12, lg: 7 }}>
        <Card withBorder padding="sm">
          {!job ? (
            <Text size="sm" c="dimmed">Select a build to see its progress.</Text>
          ) : (
            <Stack gap="sm">
              <Group justify="space-between">
                <div>
                  <Title order={4}>{job.certname}</Title>
                  <Text size="xs" c="dimmed">VM {job.vm_name} · {job.connection_id} · job {job.id}</Text>
                </div>
                <Group gap="xs">
                  {job.csr_verified && <Badge size="lg" variant="light" color="teal">CSR challenge</Badge>}
                  <Badge size="lg" color={statusColor(job.status)}>{job.status}</Badge>
                </Group>
              </Group>
              {job.error && <Alert color="red" title="Build failed">{job.error}</Alert>}
              {job.awaiting_install && (
                <Card withBorder padding="sm" bg="var(--mantine-color-body)">
                  <Text size="sm" fw={600} mb={4}>Finish the OS install in the vCenter console</Text>
                  <Text size="xs" c="dimmed" mb="sm">
                    {job.request.bootstrap_agent === false
                      ? 'Press Continue when the install is done; the GUI disconnects the ISO.'
                      : 'Then give a login the GUI can use once over SSH (sudo, or root). It is encrypted, used for the bootstrap, and deleted.'}
                  </Text>
                  {job.request.bootstrap_agent !== false && (
                    <Grid gap="xs">
                      <Grid.Col span={{ base: 12, md: 6 }}>
                        <TextInput label="SSH host" placeholder={job.request.ip} value={ssh.ssh_host}
                          onChange={(e) => { const v = e.currentTarget.value; setSsh((s) => ({ ...s, ssh_host: v })); }} />
                      </Grid.Col>
                      <Grid.Col span={{ base: 4, md: 2 }}>
                        <NumberInput label="Port" min={1} max={65535} value={ssh.ssh_port}
                          onChange={(v) => setSsh((s) => ({ ...s, ssh_port: Number(v) || 22 }))} />
                      </Grid.Col>
                      <Grid.Col span={{ base: 8, md: 4 }}>
                        <TextInput label="Username" value={ssh.username} autoComplete="off"
                          onChange={(e) => { const v = e.currentTarget.value; setSsh((s) => ({ ...s, username: v })); }} />
                      </Grid.Col>
                      <Grid.Col span={12}>
                        <PasswordInput label="Password (also used for sudo)" autoComplete="new-password" value={ssh.password}
                          onChange={(e) => { const v = e.currentTarget.value; setSsh((s) => ({ ...s, password: v })); }} />
                      </Grid.Col>
                      <Grid.Col span={12}>
                        <Textarea label="…or a private key (passwordless sudo)" autosize minRows={2} maxRows={6}
                          placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" value={ssh.private_key}
                          onChange={(e) => { const v = e.currentTarget.value; setSsh((s) => ({ ...s, private_key: v })); }} />
                      </Grid.Col>
                    </Grid>
                  )}
                  <Group justify="flex-end" mt="sm">
                    <Button size="xs" onClick={continueBuild} loading={continuing}
                      disabled={job.request.bootstrap_agent !== false && (!ssh.username.trim() || (!ssh.password && !ssh.private_key.trim()))}>
                      Continue
                    </Button>
                  </Group>
                </Card>
              )}
              <Timeline active={activeStep === -1 ? job.steps.length : activeStep - 1} bulletSize={18} lineWidth={2}>
                {job.steps.map((s) => (
                  <Timeline.Item key={s.name} color={statusColor(s.state)}
                    title={<Group gap="xs"><Text size="sm" fw={600}>{STEP_LABELS[s.name] || s.name}</Text>
                      <Badge size="xs" variant="light" color={statusColor(s.state)}>{s.state}</Badge></Group>}>
                    {s.message && <Text size="xs" c="dimmed">{s.message}</Text>}
                  </Timeline.Item>
                ))}
              </Timeline>
              <Group gap="xs">
                {(job.status === 'queued' || job.status === 'running') && (
                  <Button size="xs" variant="light" color="red" leftSection={<IconPlayerStop size={14} />} onClick={cancel}>
                    {job.status === 'queued' ? 'Cancel build' : 'Stop after current step'}
                  </Button>
                )}
                {job.status === 'succeeded' || job.steps.find((s) => s.name === 'classify')?.state === 'done' ? (
                  <Button size="xs" variant="light" onClick={() => navigate('/enc')}>Open Node Classifier</Button>
                ) : null}
                {['timeout', 'rejected', 'failed'].includes(job.steps.find((s) => s.name === 'certificate')?.state || '') && (
                  <Button size="xs" variant="light" onClick={() => navigate('/certificates')}>Open Certificate Authority</Button>
                )}
              </Group>
              <Text size="sm" fw={600}>Log</Text>
              <ScrollArea.Autosize mah={260}><Code block>{job.log || '(empty)'}</Code></ScrollArea.Autosize>
            </Stack>
          )}
        </Card>
      </Grid.Col>
    </Grid>
  );
}
