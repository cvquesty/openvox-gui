import { useState, useCallback, useEffect } from 'react';
import {
  Title, Card, Table, Loader, Center, Alert, Stack, Group, Text, Tabs,
  Button, Modal, TextInput, Textarea, Badge, ActionIcon, Tooltip, Code,
  Select, MultiSelect, Grid, ThemeIcon, Box, Divider, Paper,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconPlus, IconTrash, IconPencil, IconHierarchy2, IconTags,
  IconServer, IconWorld, IconSearch, IconLayersLinked, IconArrowDown,
} from '@tabler/icons-react';
import { enc, nodes as nodesApi, config } from '../services/api';

/* ═══════════════════════════════════════════════════════════════
   UTILITY: Format JSON for display
   ═══════════════════════════════════════════════════════════════ */
function JsonBadges({ data, color = 'blue' }: { data: Record<string, any>; color?: string }) {
  const keys = Object.keys(data || {});
  if (keys.length === 0) return <Text c="dimmed" size="sm">—</Text>;
  return (
    <Group gap={4} wrap="wrap">
      {keys.map((k) => (
        <Tooltip key={k} label={JSON.stringify(data[k], null, 2)} multiline maw={400}>
          <Badge variant="light" color={color} size="sm" style={{ cursor: 'help' }}>{k}</Badge>
        </Tooltip>
      ))}
    </Group>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TAB 1: HIERARCHY OVERVIEW
   ═══════════════════════════════════════════════════════════════ */
function HierarchyTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const h = await enc.getHierarchy();
      setData(h);
    } catch (e) { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Center h={300}><Loader size="xl" /></Center>;
  if (!data) return <Alert color="red">Failed to load hierarchy</Alert>;

  const layers = [
    {
      level: 4, label: 'Node', icon: IconServer, color: 'red',
      desc: 'Per-node overrides (highest priority)',
      count: data.nodes?.length || 0,
    },
    {
      level: 3, label: 'Group', icon: IconTags, color: 'orange',
      desc: 'Logical groupings — webservers, databases, etc.',
      count: data.groups?.length || 0,
    },
    {
      level: 2, label: 'Environment', icon: IconWorld, color: 'blue',
      desc: 'Environment-wide defaults — production, staging, dev',
      count: data.environments?.length || 0,
    },
    {
      level: 1, label: 'Common', icon: IconLayersLinked, color: 'green',
      desc: 'Global defaults applied to every node',
      count: Object.keys(data.common?.classes || {}).length +
             Object.keys(data.common?.parameters || {}).length > 0 ? 1 : 0,
    },
  ];

  return (
    <Stack>
      <Alert variant="light" color="blue" mb="xs">
        Classification is resolved by deep-merging four layers. Higher layers override
        lower ones. Classes and parameters accumulate upward — a node inherits from
        Common → its Environment → its Groups → its own overrides.
      </Alert>

      <Grid>
        <Grid.Col span={{ base: 12, md: 5 }}>
          <Stack gap="xs">
            {layers.map((layer, idx) => (
              <div key={layer.level}>
                <Card withBorder shadow="sm" padding="md">
                  <Group gap="sm">
                    <ThemeIcon size="lg" variant="light" color={layer.color} radius="md">
                      <layer.icon size={20} />
                    </ThemeIcon>
                    <div style={{ flex: 1 }}>
                      <Group justify="space-between">
                        <Text fw={700} size="sm">Layer {layer.level}: {layer.label}</Text>
                        <Badge size="sm" variant="outline" color={layer.color}>
                          {layer.count} {layer.count === 1 ? 'entry' : 'entries'}
                        </Badge>
                      </Group>
                      <Text size="xs" c="dimmed">{layer.desc}</Text>
                    </div>
                  </Group>
                </Card>
                {idx < layers.length - 1 && (
                  <Center my={4}>
                    <IconArrowDown size={16} color="var(--mantine-color-dimmed)" />
                  </Center>
                )}
              </div>
            ))}
          </Stack>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 7 }}>
          <Card withBorder shadow="sm" padding="md">
            <Text fw={700} mb="sm">Current Configuration Summary</Text>

            <Text fw={600} size="sm" mt="md" mb={4}>Common Defaults</Text>
            <Group gap="md" mb="sm">
              <div>
                <Text size="xs" c="dimmed">Classes</Text>
                <JsonBadges data={data.common?.classes || {}} color="green" />
              </div>
              <div>
                <Text size="xs" c="dimmed">Parameters</Text>
                <JsonBadges data={data.common?.parameters || {}} color="green" />
              </div>
            </Group>

            <Divider my="sm" />

            <Text fw={600} size="sm" mb={4}>Environments ({data.environments?.length || 0})</Text>
            {(data.environments || []).map((e: any) => (
              <Paper key={e.name} p="xs" mb={4} withBorder>
                <Group justify="space-between">
                  <Badge color="blue">{e.name}</Badge>
                  <Group gap="xs">
                    <JsonBadges data={e.classes || {}} color="blue" />
                  </Group>
                </Group>
              </Paper>
            ))}
            {(data.environments || []).length === 0 && (
              <Text size="sm" c="dimmed">No environments defined yet</Text>
            )}

            <Divider my="sm" />

            <Text fw={600} size="sm" mb={4}>Groups ({data.groups?.length || 0})</Text>
            {(data.groups || []).map((g: any) => (
              <Paper key={g.id} p="xs" mb={4} withBorder>
                <Group justify="space-between">
                  <Group gap="xs">
                    <Badge color="orange">{g.name}</Badge>
                    <Badge variant="outline" size="xs">{g.environment}</Badge>
                  </Group>
                  <JsonBadges data={g.classes || {}} color="orange" />
                </Group>
              </Paper>
            ))}
            {(data.groups || []).length === 0 && (
              <Text size="sm" c="dimmed">No groups defined yet</Text>
            )}

            <Divider my="sm" />

            <Text fw={600} size="sm" mb={4}>Classified Nodes ({data.nodes?.length || 0})</Text>
            {(data.nodes || []).map((n: any) => (
              <Paper key={n.certname} p="xs" mb={4} withBorder>
                <Group justify="space-between">
                  <Group gap="xs">
                    <Text size="sm" fw={500}>{n.certname}</Text>
                    <Badge variant="outline" size="xs">{n.environment}</Badge>
                    {(n.groups || []).map((g: string) => (
                      <Badge key={g} variant="light" color="orange" size="xs">{g}</Badge>
                    ))}
                  </Group>
                  <JsonBadges data={n.classes || {}} color="red" />
                </Group>
              </Paper>
            ))}
            {(data.nodes || []).length === 0 && (
              <Text size="sm" c="dimmed">No nodes classified yet</Text>
            )}
          </Card>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TAB 2: ENVIRONMENTS
   ═══════════════════════════════════════════════════════════════ */
function EnvironmentsTab() {
  const [envs, setEnvs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ name: '', description: '', classes: '{}', parameters: '{}' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch ENC environments and Puppet filesystem environments in parallel
      const [encEnvs, puppetEnvsResp] = await Promise.all([
        enc.listEnvironments(),
        config.getEnvironments().catch(() => ({ environments: [] })),
      ]);
      const puppetEnvNames: string[] = puppetEnvsResp.environments || [];
      const encNames = new Set(encEnvs.map((e: any) => e.name));

      // Auto-create any Puppet environments not yet in the ENC
      const missing = puppetEnvNames.filter((name: string) => !encNames.has(name));
      for (const name of missing) {
        await enc.createEnvironment({ name, description: `Puppet environment (auto-discovered)`, classes: {}, parameters: {} });
      }

      // Re-fetch if we created any
      if (missing.length > 0) {
        setEnvs(await enc.listEnvironments());
        if (missing.length > 0) {
          notifications.show({
            title: 'Environments Synced',
            message: `Added ${missing.length} environment${missing.length > 1 ? 's' : ''} from Puppet: ${missing.join(', ')}`,
            color: 'blue',
          });
        }
      } else {
        setEnvs(encEnvs);
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', description: '', classes: '{}', parameters: '{}' });
    setModalOpen(true);
  };

  const openEdit = (e: any) => {
    setEditing(e);
    setForm({
      name: e.name,
      description: e.description || '',
      classes: JSON.stringify(e.classes || {}, null, 2),
      parameters: JSON.stringify(e.parameters || {}, null, 2),
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const payload = {
        name: form.name,
        description: form.description,
        classes: JSON.parse(form.classes),
        parameters: JSON.parse(form.parameters),
      };
      if (editing) {
        await enc.updateEnvironment(editing.name, payload);
        notifications.show({ title: 'Updated', message: `Environment '${form.name}' updated`, color: 'green' });
      } else {
        await enc.createEnvironment(payload);
        notifications.show({ title: 'Created', message: `Environment '${form.name}' created`, color: 'green' });
      }
      setModalOpen(false);
      load();
    } catch (e: any) {
      notifications.show({ title: 'Error', message: e.message, color: 'red' });
    }
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`Delete environment '${name}'?`)) return;
    try {
      await enc.deleteEnvironment(name);
      notifications.show({ title: 'Deleted', message: `Environment '${name}' removed`, color: 'green' });
      load();
    } catch (e: any) {
      notifications.show({ title: 'Error', message: e.message, color: 'red' });
    }
  };

  if (loading) return <Center h={300}><Loader size="xl" /></Center>;

  return (
    <Stack>
      <Group justify="flex-end">
        <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>Add Environment</Button>
      </Group>

      <Alert variant="light" color="blue" mb="xs">
        Environments are auto-discovered from <Code>/etc/puppetlabs/code/environments/</Code> on
        the Puppet server. Classes and parameters set here apply to every node assigned
        to this environment.
      </Alert>

      <Card withBorder shadow="sm">
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Environment</Table.Th>
              <Table.Th>Description</Table.Th>
              <Table.Th>Classes</Table.Th>
              <Table.Th>Parameters</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {envs.map((e) => (
              <Table.Tr key={e.name}>
                <Table.Td><Badge color="blue" size="lg">{e.name}</Badge></Table.Td>
                <Table.Td><Text size="sm">{e.description || '\u2014'}</Text></Table.Td>
                <Table.Td><JsonBadges data={e.classes} color="blue" /></Table.Td>
                <Table.Td><JsonBadges data={e.parameters} color="cyan" /></Table.Td>
                <Table.Td>
                  <Group gap="xs" justify="flex-end">
                    <Tooltip label="Edit">
                      <ActionIcon variant="subtle" color="blue" onClick={() => openEdit(e)}>
                        <IconPencil size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Delete">
                      <ActionIcon variant="subtle" color="red" onClick={() => handleDelete(e.name)}>
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
            {envs.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={5}><Text c="dimmed" ta="center" py="lg">No environments defined. Add one to get started.</Text></Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Card>

      <Modal opened={modalOpen} onClose={() => setModalOpen(false)}
             title={editing ? `Edit Environment — ${editing.name}` : 'Add Environment'} size="lg">
        <Stack>
          <TextInput label="Name" required value={form.name} disabled={!!editing}
            onChange={(e) => setForm({ ...form, name: e.currentTarget.value })}
            placeholder="e.g. production, staging, development" />
          <TextInput label="Description" value={form.description}
            onChange={(e) => setForm({ ...form, description: e.currentTarget.value })} />
          <Textarea label="Classes (JSON)" value={form.classes} minRows={3}
            styles={{ input: { fontFamily: 'monospace' } }}
            onChange={(e) => setForm({ ...form, classes: e.currentTarget.value })}
            description='Classes applied to all nodes in this environment' />
          <Textarea label="Parameters (JSON)" value={form.parameters} minRows={2}
            styles={{ input: { fontFamily: 'monospace' } }}
            onChange={(e) => setForm({ ...form, parameters: e.currentTarget.value })}
            description='Parameters applied to all nodes in this environment' />
          <Button onClick={handleSave}>{editing ? 'Update' : 'Create'}</Button>
        </Stack>
      </Modal>
    </Stack>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TAB 3: NODE GROUPS
   ═══════════════════════════════════════════════════════════════ */
function GroupsTab() {
  const [groups, setGroups] = useState<any[]>([]);
  const [envs, setEnvs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ name: '', environment: '', description: '', classes: '{}', parameters: '{}' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [g, e] = await Promise.all([enc.listGroups(), enc.listEnvironments()]);
      setGroups(g);
      setEnvs(e);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', environment: envs[0]?.name || 'production', description: '', classes: '{}', parameters: '{}' });
    setModalOpen(true);
  };

  const openEdit = (g: any) => {
    setEditing(g);
    setForm({
      name: g.name,
      environment: g.environment,
      description: g.description || '',
      classes: JSON.stringify(g.classes || {}, null, 2),
      parameters: JSON.stringify(g.parameters || {}, null, 2),
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const payload = {
        name: form.name,
        environment: form.environment,
        description: form.description,
        classes: JSON.parse(form.classes),
        parameters: JSON.parse(form.parameters),
      };
      if (editing) {
        await enc.updateGroup(editing.id, payload);
        notifications.show({ title: 'Updated', message: `Group '${form.name}' updated`, color: 'green' });
      } else {
        await enc.createGroup(payload);
        notifications.show({ title: 'Created', message: `Group '${form.name}' created`, color: 'green' });
      }
      setModalOpen(false);
      load();
    } catch (e: any) {
      notifications.show({ title: 'Error', message: e.message, color: 'red' });
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Delete group '${name}'?`)) return;
    try {
      await enc.deleteGroup(id);
      notifications.show({ title: 'Deleted', message: `Group '${name}' removed`, color: 'green' });
      load();
    } catch (e: any) {
      notifications.show({ title: 'Error', message: e.message, color: 'red' });
    }
  };

  if (loading) return <Center h={300}><Loader size="xl" /></Center>;

  return (
    <Stack>
      <Group justify="flex-end">
        <Button leftSection={<IconPlus size={16} />} onClick={openCreate}
          disabled={envs.length === 0}>
          Create Group
        </Button>
      </Group>

      {envs.length === 0 && (
        <Alert color="yellow">Create at least one environment before adding groups.</Alert>
      )}

      <Alert variant="light" color="blue" mb="xs">
        Groups are logical collections of nodes (webservers, databases, etc.) within an environment.
        Classes and parameters set here apply to every node in the group.
      </Alert>

      <Card withBorder shadow="sm">
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Group</Table.Th>
              <Table.Th>Environment</Table.Th>
              <Table.Th>Description</Table.Th>
              <Table.Th>Classes</Table.Th>
              <Table.Th>Parameters</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {groups.map((g) => (
              <Table.Tr key={g.id}>
                <Table.Td><Text fw={500}>{g.name}</Text></Table.Td>
                <Table.Td><Badge variant="outline" size="sm">{g.environment}</Badge></Table.Td>
                <Table.Td><Text size="sm">{g.description || '\u2014'}</Text></Table.Td>
                <Table.Td><JsonBadges data={g.classes} color="orange" /></Table.Td>
                <Table.Td><JsonBadges data={g.parameters} color="yellow" /></Table.Td>
                <Table.Td>
                  <Group gap="xs" justify="flex-end">
                    <Tooltip label="Edit">
                      <ActionIcon variant="subtle" color="blue" onClick={() => openEdit(g)}>
                        <IconPencil size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Delete">
                      <ActionIcon variant="subtle" color="red" onClick={() => handleDelete(g.id, g.name)}>
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
            {groups.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={6}><Text c="dimmed" ta="center" py="lg">No groups defined yet</Text></Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Card>

      <Modal opened={modalOpen} onClose={() => setModalOpen(false)}
             title={editing ? `Edit Group — ${editing.name}` : 'Create Group'} size="lg">
        <Stack>
          <TextInput label="Name" required value={form.name}
            onChange={(e) => setForm({ ...form, name: e.currentTarget.value })}
            placeholder="e.g. webservers, databases, monitoring" />
          <Select label="Environment" required
            data={envs.map((e) => ({ value: e.name, label: e.name }))}
            value={form.environment}
            onChange={(v) => setForm({ ...form, environment: v || '' })} />
          <TextInput label="Description" value={form.description}
            onChange={(e) => setForm({ ...form, description: e.currentTarget.value })} />
          <Textarea label="Classes (JSON)" value={form.classes} minRows={3}
            styles={{ input: { fontFamily: 'monospace' } }}
            onChange={(e) => setForm({ ...form, classes: e.currentTarget.value })}
            description='e.g. {"apache": {"port": 80}, "firewall": {}}' />
          <Textarea label="Parameters (JSON)" value={form.parameters} minRows={2}
            styles={{ input: { fontFamily: 'monospace' } }}
            onChange={(e) => setForm({ ...form, parameters: e.currentTarget.value })}
            description='e.g. {"role": "web", "tier": "frontend"}' />
          <Button onClick={handleSave}>{editing ? 'Update' : 'Create'}</Button>
        </Stack>
      </Modal>
    </Stack>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TAB 4: NODES
   ═══════════════════════════════════════════════════════════════ */
function NodesTab() {
  const [classified, setClassified] = useState<any[]>([]);
  const [envs, setEnvs] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [puppetNodes, setPuppetNodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({
    certname: '', environment: '', classes: '{}', parameters: '{}', group_ids: [] as string[],
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [n, e, g] = await Promise.all([
        enc.listNodes(), enc.listEnvironments(), enc.listGroups(),
      ]);
      setClassified(n);
      setEnvs(e);
      setGroups(g);
      // Also fetch known nodes from PuppetDB
      try {
        const pn = await nodesApi.list();
        setPuppetNodes(pn.map((x: any) => x.certname));
      } catch { setPuppetNodes([]); }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({
      certname: '', environment: envs[0]?.name || 'production',
      classes: '{}', parameters: '{}', group_ids: [],
    });
    setModalOpen(true);
  };

  const openEdit = (n: any) => {
    setEditing(n);
    const nodeGroupIds = groups
      .filter((g) => (n.groups || []).includes(g.name))
      .map((g) => String(g.id));
    setForm({
      certname: n.certname,
      environment: n.environment,
      classes: JSON.stringify(n.classes || {}, null, 2),
      parameters: JSON.stringify(n.parameters || {}, null, 2),
      group_ids: nodeGroupIds,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const payload = {
        certname: form.certname,
        environment: form.environment,
        classes: JSON.parse(form.classes),
        parameters: JSON.parse(form.parameters),
        group_ids: form.group_ids.map(Number),
      };
      if (editing) {
        await enc.updateNode(editing.certname, payload);
        notifications.show({ title: 'Updated', message: `Node '${form.certname}' updated`, color: 'green' });
      } else {
        await enc.createNode(payload);
        notifications.show({ title: 'Created', message: `Node '${form.certname}' classified`, color: 'green' });
      }
      setModalOpen(false);
      load();
    } catch (e: any) {
      notifications.show({ title: 'Error', message: e.message, color: 'red' });
    }
  };

  const handleDelete = async (certname: string) => {
    if (!confirm(`Remove classification for '${certname}'?`)) return;
    try {
      await enc.deleteNode(certname);
      notifications.show({ title: 'Removed', message: `Node '${certname}' classification removed`, color: 'green' });
      load();
    } catch (e: any) {
      notifications.show({ title: 'Error', message: e.message, color: 'red' });
    }
  };

  // Nodes known to PuppetDB but not yet classified
  const classifiedNames = new Set(classified.map((n) => n.certname));
  const unclassified = puppetNodes.filter((cn) => !classifiedNames.has(cn));

  if (loading) return <Center h={300}><Loader size="xl" /></Center>;

  // Filter groups by selected environment for the modal
  const envGroups = groups.filter((g) => g.environment === form.environment);

  return (
    <Stack>
      <Group justify="flex-end">
        <Button leftSection={<IconPlus size={16} />} onClick={openCreate}
          disabled={envs.length === 0}>
          Classify Node
        </Button>
      </Group>

      {envs.length === 0 && (
        <Alert color="yellow">Create at least one environment before classifying nodes.</Alert>
      )}

      <Alert variant="light" color="blue" mb="xs">
        Each node is a "container" that inherits classification from Common → Environment → Groups,
        with its own overrides at the highest priority. Assign nodes to an environment and one or
        more groups.
      </Alert>

      <Card withBorder shadow="sm">
        <Text fw={700} mb="sm">Classified Nodes</Text>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Certname</Table.Th>
              <Table.Th>Environment</Table.Th>
              <Table.Th>Groups</Table.Th>
              <Table.Th>Node Classes</Table.Th>
              <Table.Th>Node Params</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {classified.map((n) => (
              <Table.Tr key={n.certname}>
                <Table.Td><Text fw={500} size="sm">{n.certname}</Text></Table.Td>
                <Table.Td><Badge variant="outline" size="sm">{n.environment}</Badge></Table.Td>
                <Table.Td>
                  <Group gap={4}>
                    {(n.groups || []).map((g: string) => (
                      <Badge key={g} variant="light" color="orange" size="sm">{g}</Badge>
                    ))}
                    {(!n.groups || n.groups.length === 0) && <Text size="sm" c="dimmed">—</Text>}
                  </Group>
                </Table.Td>
                <Table.Td><JsonBadges data={n.classes} color="red" /></Table.Td>
                <Table.Td><JsonBadges data={n.parameters} color="pink" /></Table.Td>
                <Table.Td>
                  <Group gap="xs" justify="flex-end">
                    <Tooltip label="Edit">
                      <ActionIcon variant="subtle" color="blue" onClick={() => openEdit(n)}>
                        <IconPencil size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Remove">
                      <ActionIcon variant="subtle" color="red" onClick={() => handleDelete(n.certname)}>
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
            {classified.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={6}><Text c="dimmed" ta="center" py="lg">No nodes classified yet</Text></Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Card>

      {unclassified.length > 0 && (
        <Card withBorder shadow="sm">
          <Text fw={700} mb="sm">Unclassified Nodes ({unclassified.length})</Text>
          <Text size="xs" c="dimmed" mb="sm">
            These nodes are known to PuppetDB but have no ENC classification. They will use
            Puppet defaults until classified.
          </Text>
          <Group gap="xs" wrap="wrap">
            {unclassified.map((cn) => (
              <Badge key={cn} variant="outline" color="gray" size="sm" style={{ cursor: 'pointer' }}
                onClick={() => {
                  setEditing(null);
                  setForm({
                    certname: cn, environment: envs[0]?.name || 'production',
                    classes: '{}', parameters: '{}', group_ids: [],
                  });
                  setModalOpen(true);
                }}>
                {cn}
              </Badge>
            ))}
          </Group>
        </Card>
      )}

      <Modal opened={modalOpen} onClose={() => setModalOpen(false)}
             title={editing ? `Edit Node — ${editing.certname}` : 'Classify Node'} size="lg">
        <Stack>
          {!editing ? (
            <Select label="Certname" required searchable
              data={puppetNodes.map((cn) => ({ value: cn, label: cn }))}
              value={form.certname}
              onChange={(v) => setForm({ ...form, certname: v || '' })}
              placeholder="Select or type a node certname"
              creatable
              getCreateLabel={(q) => `+ Add "${q}"`}
              onCreate={(q) => { setPuppetNodes([...puppetNodes, q]); return q; }}
            />
          ) : (
            <TextInput label="Certname" value={form.certname} disabled />
          )}
          <Select label="Environment" required
            data={envs.map((e) => ({ value: e.name, label: e.name }))}
            value={form.environment}
            onChange={(v) => setForm({ ...form, environment: v || '', group_ids: [] })} />
          <MultiSelect label="Groups" clearable searchable
            data={envGroups.map((g) => ({ value: String(g.id), label: `${g.name}` }))}
            value={form.group_ids}
            onChange={(v) => setForm({ ...form, group_ids: v })}
            description="Groups in the selected environment. A node inherits classes/params from all its groups."
            placeholder={envGroups.length === 0 ? 'No groups in this environment' : 'Select groups'} />
          <Textarea label="Node-specific Classes (JSON)" value={form.classes} minRows={3}
            styles={{ input: { fontFamily: 'monospace' } }}
            onChange={(e) => setForm({ ...form, classes: e.currentTarget.value })}
            description="Override or add classes at the node level (highest priority)" />
          <Textarea label="Node-specific Parameters (JSON)" value={form.parameters} minRows={2}
            styles={{ input: { fontFamily: 'monospace' } }}
            onChange={(e) => setForm({ ...form, parameters: e.currentTarget.value })}
            description="Override or add parameters at the node level (highest priority)" />
          <Button onClick={handleSave}>{editing ? 'Update' : 'Classify'}</Button>
        </Stack>
      </Modal>
    </Stack>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TAB 5: CLASSIFICATION LOOKUP
   ═══════════════════════════════════════════════════════════════ */
function LookupTab() {
  const [certname, setCertname] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [puppetNodes, setPuppetNodes] = useState<string[]>([]);

  useEffect(() => {
    nodesApi.list().then((ns: any[]) => setPuppetNodes(ns.map((n) => n.certname))).catch(() => {});
  }, []);

  const handleLookup = async () => {
    if (!certname) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const r = await enc.classify(certname);
      setResult(r);
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  };

  return (
    <Stack>
      <Alert variant="light" color="blue" mb="xs">
        Preview the final merged classification for any node. This shows exactly what Puppet
        receives when it calls the ENC endpoint — the deep-merged result of
        Common → Environment → Groups → Node overrides.
      </Alert>

      <Card withBorder shadow="sm">
        <Group align="flex-end">
          <Select label="Node Certname" searchable clearable
            data={puppetNodes.map((cn) => ({ value: cn, label: cn }))}
            value={certname}
            onChange={(v) => { setCertname(v || ''); setResult(null); }}
            placeholder="Select a node"
            style={{ flex: 1 }}
            creatable
            getCreateLabel={(q) => `Lookup "${q}"`}
            onCreate={(q) => { setPuppetNodes([...puppetNodes, q]); return q; }}
          />
          <Button onClick={handleLookup} loading={loading}
            leftSection={<IconSearch size={16} />} disabled={!certname}>
            Resolve
          </Button>
        </Group>
      </Card>

      {error && <Alert color="red" title="Error">{error}</Alert>}

      {result && (
        <Card withBorder shadow="sm">
          <Text fw={700} mb="sm">Resolved Classification for <Code>{certname}</Code></Text>

          <Grid>
            <Grid.Col span={{ base: 12, md: 4 }}>
              <Paper p="md" withBorder>
                <Text fw={600} size="sm" mb="xs">Environment</Text>
                <Badge size="lg" color="blue">{result.environment}</Badge>
              </Paper>
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 4 }}>
              <Paper p="md" withBorder>
                <Text fw={600} size="sm" mb="xs">Classes ({Object.keys(result.classes || {}).length})</Text>
                <Stack gap={4}>
                  {Object.entries(result.classes || {}).map(([cls, params]: [string, any]) => (
                    <div key={cls}>
                      <Badge color="grape" variant="light">{cls}</Badge>
                      {params && Object.keys(params).length > 0 && (
                        <Code block mt={2} style={{ fontSize: 11 }}>
                          {JSON.stringify(params, null, 2)}
                        </Code>
                      )}
                    </div>
                  ))}
                  {Object.keys(result.classes || {}).length === 0 && (
                    <Text size="sm" c="dimmed">No classes</Text>
                  )}
                </Stack>
              </Paper>
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 4 }}>
              <Paper p="md" withBorder>
                <Text fw={600} size="sm" mb="xs">Parameters ({Object.keys(result.parameters || {}).length})</Text>
                {Object.keys(result.parameters || {}).length > 0 ? (
                  <Code block style={{ fontSize: 11 }}>
                    {JSON.stringify(result.parameters, null, 2)}
                  </Code>
                ) : (
                  <Text size="sm" c="dimmed">No parameters</Text>
                )}
              </Paper>
            </Grid.Col>
          </Grid>

          <Divider my="md" />
          <Text fw={600} size="sm" mb="xs">YAML Output (Puppet ENC format)</Text>
          <Code block style={{ fontSize: 12 }}>
            {`---\nenvironment: "${result.environment}"\nclasses:\n${Object.entries(result.classes || {}).map(([cls, params]: [string, any]) =>
              params && Object.keys(params).length > 0
                ? `  ${cls}:\n${Object.entries(params).map(([k, v]) => `    ${k}: ${JSON.stringify(v)}`).join('\n')}`
                : `  ${cls}: {}`
            ).join('\n') || '  {}'}\nparameters:\n${Object.entries(result.parameters || {}).map(([k, v]) =>
              `  ${k}: ${JSON.stringify(v)}`
            ).join('\n') || '  {}'}`}
          </Code>
        </Card>
      )}
    </Stack>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TAB: COMMON DEFAULTS
   ═══════════════════════════════════════════════════════════════ */
function CommonTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [classes, setClasses] = useState('{}');
  const [parameters, setParameters] = useState('{}');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const c = await enc.getCommon();
      setData(c);
      setClasses(JSON.stringify(c.classes || {}, null, 2));
      setParameters(JSON.stringify(c.parameters || {}, null, 2));
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await enc.saveCommon({ classes: JSON.parse(classes), parameters: JSON.parse(parameters) });
      notifications.show({ title: 'Saved', message: 'Common defaults updated', color: 'green' });
      setEditing(false);
      load();
    } catch (e: any) {
      notifications.show({ title: 'Error', message: e.message, color: 'red' });
    }
    setSaving(false);
  };

  if (loading) return <Center h={300}><Loader size="xl" /></Center>;

  return (
    <Stack>
      <Alert variant="light" color="blue" mb="xs">
        Common defaults are the foundation layer (Layer 1). Classes and parameters defined
        here apply to <strong>every node</strong> in the system. Higher layers
        (Environment, Group, Node) can override these values.
      </Alert>

      <Card withBorder shadow="sm">
        <Group justify="space-between" mb="md">
          <Text fw={700}>Global Common Defaults</Text>
          {!editing ? (
            <Button variant="light" size="xs" leftSection={<IconPencil size={14} />}
              onClick={() => setEditing(true)}>Edit</Button>
          ) : (
            <Group gap="xs">
              <Button variant="light" size="xs" color="gray" onClick={() => { setEditing(false); load(); }}>
                Cancel
              </Button>
              <Button size="xs" onClick={handleSave} loading={saving}>Save</Button>
            </Group>
          )}
        </Group>

        {!editing ? (
          <Grid>
            <Grid.Col span={6}>
              <Text fw={600} size="sm" mb="xs">Classes</Text>
              {Object.keys(data?.classes || {}).length > 0 ? (
                <Code block style={{ fontSize: 12 }}>{JSON.stringify(data.classes, null, 2)}</Code>
              ) : (
                <Text size="sm" c="dimmed">No common classes defined</Text>
              )}
            </Grid.Col>
            <Grid.Col span={6}>
              <Text fw={600} size="sm" mb="xs">Parameters</Text>
              {Object.keys(data?.parameters || {}).length > 0 ? (
                <Code block style={{ fontSize: 12 }}>{JSON.stringify(data.parameters, null, 2)}</Code>
              ) : (
                <Text size="sm" c="dimmed">No common parameters defined</Text>
              )}
            </Grid.Col>
          </Grid>
        ) : (
          <Stack>
            <Textarea label="Classes (JSON)" value={classes} minRows={5}
              styles={{ input: { fontFamily: 'monospace' } }}
              onChange={(e) => setClasses(e.currentTarget.value)}
              description='Classes applied to every node. e.g. {"ntp": {"servers": ["pool.ntp.org"]}}' />
            <Textarea label="Parameters (JSON)" value={parameters} minRows={3}
              styles={{ input: { fontFamily: 'monospace' } }}
              onChange={(e) => setParameters(e.currentTarget.value)}
              description='Parameters applied to every node. e.g. {"admin_email": "ops@example.com"}' />
          </Stack>
        )}
      </Card>
    </Stack>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════════════════════ */
export function NodeClassifierPage() {
  return (
    <Stack>
      <Title order={2}>Node Classifier</Title>
      <Tabs defaultValue="hierarchy" variant="outline">
        <Tabs.List>
          <Tabs.Tab value="hierarchy" leftSection={<IconLayersLinked size={16} />}>
            Hierarchy
          </Tabs.Tab>
          <Tabs.Tab value="common" leftSection={<IconWorld size={16} />}>
            Common
          </Tabs.Tab>
          <Tabs.Tab value="environments" leftSection={<IconWorld size={16} />}>
            Environments
          </Tabs.Tab>
          <Tabs.Tab value="groups" leftSection={<IconTags size={16} />}>
            Node Groups
          </Tabs.Tab>
          <Tabs.Tab value="nodes" leftSection={<IconServer size={16} />}>
            Nodes
          </Tabs.Tab>
          <Tabs.Tab value="lookup" leftSection={<IconSearch size={16} />}>
            Classification Lookup
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="hierarchy" pt="md">
          <HierarchyTab />
        </Tabs.Panel>

        <Tabs.Panel value="common" pt="md">
          <CommonTab />
        </Tabs.Panel>

        <Tabs.Panel value="environments" pt="md">
          <EnvironmentsTab />
        </Tabs.Panel>

        <Tabs.Panel value="groups" pt="md">
          <GroupsTab />
        </Tabs.Panel>

        <Tabs.Panel value="nodes" pt="md">
          <NodesTab />
        </Tabs.Panel>

        <Tabs.Panel value="lookup" pt="md">
          <LookupTab />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
