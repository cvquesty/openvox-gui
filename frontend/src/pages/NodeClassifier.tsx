import { useState } from 'react';
import {
  Title, Card, Table, Loader, Center, Alert, Stack, Group, Text, Tabs,
  Button, Modal, TextInput, Textarea, NumberInput, Badge, ActionIcon, Tooltip, Code, Switch,
} from '@mantine/core';
import { IconPlus, IconTrash, IconHierarchy2, IconTags, IconRuler } from '@tabler/icons-react';
import { useApi } from '../hooks/useApi';
import { enc } from '../services/api';

/* ────────────────────── Node Groups Tab ────────────────────── */
function NodeGroupsTab() {
  const { data: groups, loading, error, refetch } = useApi(enc.listGroups);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({
    name: '', description: '', environment: 'production', classes: '{}', parameters: '{}',
  });

  const handleCreate = async () => {
    try {
      await enc.createGroup({
        name: form.name,
        description: form.description,
        environment: form.environment,
        classes: JSON.parse(form.classes),
        parameters: JSON.parse(form.parameters),
      });
      setModalOpen(false);
      setForm({ name: '', description: '', environment: 'production', classes: '{}', parameters: '{}' });
      refetch();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleDelete = async (id: number) => {
    if (confirm('Delete this group?')) {
      await enc.deleteGroup(id);
      refetch();
    }
  };

  if (loading) return <Center h={300}><Loader size="xl" /></Center>;
  if (error) return <Alert color="red" title="Error">{error}</Alert>;

  return (
    <Stack>
      <Group justify="flex-end">
        <Button leftSection={<IconPlus size={16} />} onClick={() => setModalOpen(true)}>
          Create Group
        </Button>
      </Group>

      <Card withBorder shadow="sm">
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Description</Table.Th>
              <Table.Th>Environment</Table.Th>
              <Table.Th>Classes</Table.Th>
              <Table.Th>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {groups?.map((g: any) => (
              <Table.Tr key={g.id}>
                <Table.Td><Text fw={500}>{g.name}</Text></Table.Td>
                <Table.Td>{g.description || '\u2014'}</Table.Td>
                <Table.Td>{g.environment}</Table.Td>
                <Table.Td><Code>{Object.keys(g.classes || {}).join(', ') || 'none'}</Code></Table.Td>
                <Table.Td>
                  <Tooltip label="Delete">
                    <ActionIcon color="red" variant="subtle" onClick={() => handleDelete(g.id)}>
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Tooltip>
                </Table.Td>
              </Table.Tr>
            ))}
            {(!groups || groups.length === 0) && (
              <Table.Tr>
                <Table.Td colSpan={5}><Text c="dimmed" ta="center">No groups defined yet</Text></Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Card>

      <Modal opened={modalOpen} onClose={() => setModalOpen(false)} title="Create Node Group" size="lg">
        <Stack>
          <TextInput label="Name" required value={form.name}
            onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} />
          <Textarea label="Description" value={form.description}
            onChange={(e) => setForm({ ...form, description: e.currentTarget.value })} />
          <TextInput label="Environment" value={form.environment}
            onChange={(e) => setForm({ ...form, environment: e.currentTarget.value })} />
          <Textarea label="Classes (JSON)" value={form.classes} minRows={3} font="monospace"
            onChange={(e) => setForm({ ...form, classes: e.currentTarget.value })}
            description='Example: {"ntp": {"servers": ["pool.ntp.org"]}}' />
          <Textarea label="Parameters (JSON)" value={form.parameters} minRows={2} font="monospace"
            onChange={(e) => setForm({ ...form, parameters: e.currentTarget.value })}
            description='Example: {"role": "webserver"}' />
          <Button onClick={handleCreate}>Create</Button>
        </Stack>
      </Modal>
    </Stack>
  );
}

/* ────────────────────── Classifications Tab ────────────────────── */
function ClassificationsTab() {
  const { data: classifications, loading, error, refetch } = useApi(enc.listClassifications);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({
    certname: '', environment: 'production', classes: '{}', parameters: '{}',
  });

  const handleCreate = async () => {
    try {
      await enc.createClassification({
        certname: form.certname,
        environment: form.environment,
        classes: JSON.parse(form.classes),
        parameters: JSON.parse(form.parameters),
      });
      setModalOpen(false);
      setForm({ certname: '', environment: 'production', classes: '{}', parameters: '{}' });
      refetch();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleDelete = async (certname: string) => {
    if (confirm(`Delete classification for ${certname}?`)) {
      await enc.deleteClassification(certname);
      refetch();
    }
  };

  if (loading) return <Center h={300}><Loader size="xl" /></Center>;
  if (error) return <Alert color="red" title="Error">{error}</Alert>;

  return (
    <Stack>
      <Group justify="flex-end">
        <Button leftSection={<IconPlus size={16} />} onClick={() => setModalOpen(true)}>
          Add Classification
        </Button>
      </Group>

      <Card withBorder shadow="sm">
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Certname</Table.Th>
              <Table.Th>Environment</Table.Th>
              <Table.Th>Classes</Table.Th>
              <Table.Th>Groups</Table.Th>
              <Table.Th>Pinned</Table.Th>
              <Table.Th>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {classifications?.map((c: any) => (
              <Table.Tr key={c.certname}>
                <Table.Td><Text fw={500}>{c.certname}</Text></Table.Td>
                <Table.Td>{c.environment}</Table.Td>
                <Table.Td><Code>{Object.keys(c.classes || {}).join(', ') || 'none'}</Code></Table.Td>
                <Table.Td>
                  <Group gap={4}>
                    {c.groups?.map((g: string) => <Badge key={g} variant="light" size="sm">{g}</Badge>)}
                  </Group>
                </Table.Td>
                <Table.Td>{c.is_pinned ? <Badge color="blue">Pinned</Badge> : '\u2014'}</Table.Td>
                <Table.Td>
                  <Tooltip label="Delete">
                    <ActionIcon color="red" variant="subtle" onClick={() => handleDelete(c.certname)}>
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Tooltip>
                </Table.Td>
              </Table.Tr>
            ))}
            {(!classifications || classifications.length === 0) && (
              <Table.Tr>
                <Table.Td colSpan={6}><Text c="dimmed" ta="center">No classifications yet</Text></Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Card>

      <Modal opened={modalOpen} onClose={() => setModalOpen(false)} title="Add Node Classification" size="lg">
        <Stack>
          <TextInput label="Certname" required value={form.certname} placeholder="node1.example.com"
            onChange={(e) => setForm({ ...form, certname: e.currentTarget.value })} />
          <TextInput label="Environment" value={form.environment}
            onChange={(e) => setForm({ ...form, environment: e.currentTarget.value })} />
          <Textarea label="Classes (JSON)" value={form.classes} minRows={3}
            onChange={(e) => setForm({ ...form, classes: e.currentTarget.value })}
            description='Example: {"ntp": {}, "ssh::server": {"port": 2222}}' />
          <Textarea label="Parameters (JSON)" value={form.parameters} minRows={2}
            onChange={(e) => setForm({ ...form, parameters: e.currentTarget.value })} />
          <Button onClick={handleCreate}>Add Classification</Button>
        </Stack>
      </Modal>
    </Stack>
  );
}

/* ────────────────────── Rules Tab ────────────────────── */
function RulesTab() {
  const { data: rules, loading, error, refetch } = useApi(enc.listRules);
  const { data: groups } = useApi(enc.listGroups);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({
    name: '', description: '', priority: 0, fact_match: '{}', group_id: 0, enabled: true,
  });

  const handleCreate = async () => {
    try {
      await enc.createRule({
        name: form.name,
        description: form.description,
        priority: form.priority,
        fact_match: JSON.parse(form.fact_match),
        group_id: form.group_id,
        enabled: form.enabled,
      });
      setModalOpen(false);
      refetch();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleDelete = async (id: number) => {
    if (confirm('Delete this rule?')) {
      await enc.deleteRule(id);
      refetch();
    }
  };

  if (loading) return <Center h={300}><Loader size="xl" /></Center>;
  if (error) return <Alert color="red" title="Error">{error}</Alert>;

  return (
    <Stack>
      <Alert variant="light" color="blue" mb="sm">
        Rules automatically classify nodes based on their facts. Higher priority rules are evaluated first.
        All matching criteria use AND logic.
      </Alert>

      <Group justify="flex-end">
        <Button leftSection={<IconPlus size={16} />} onClick={() => setModalOpen(true)}>
          Create Rule
        </Button>
      </Group>

      <Card withBorder shadow="sm">
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Priority</Table.Th>
              <Table.Th>Name</Table.Th>
              <Table.Th>Fact Match</Table.Th>
              <Table.Th>Target Group</Table.Th>
              <Table.Th>Enabled</Table.Th>
              <Table.Th>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rules?.map((r: any) => (
              <Table.Tr key={r.id}>
                <Table.Td><Badge variant="outline">{r.priority}</Badge></Table.Td>
                <Table.Td><Text fw={500}>{r.name}</Text></Table.Td>
                <Table.Td><Code>{JSON.stringify(r.fact_match)}</Code></Table.Td>
                <Table.Td>{groups?.find((g: any) => g.id === r.group_id)?.name || r.group_id}</Table.Td>
                <Table.Td>{r.enabled ? <Badge color="green">Yes</Badge> : <Badge color="gray">No</Badge>}</Table.Td>
                <Table.Td>
                  <Tooltip label="Delete">
                    <ActionIcon color="red" variant="subtle" onClick={() => handleDelete(r.id)}>
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Tooltip>
                </Table.Td>
              </Table.Tr>
            ))}
            {(!rules || rules.length === 0) && (
              <Table.Tr>
                <Table.Td colSpan={6}><Text c="dimmed" ta="center">No rules defined</Text></Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Card>

      <Modal opened={modalOpen} onClose={() => setModalOpen(false)} title="Create Classification Rule" size="lg">
        <Stack>
          <TextInput label="Name" required value={form.name}
            onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} />
          <Textarea label="Description" value={form.description}
            onChange={(e) => setForm({ ...form, description: e.currentTarget.value })} />
          <NumberInput label="Priority" value={form.priority}
            onChange={(v) => setForm({ ...form, priority: Number(v) })}
            description="Higher numbers = higher priority" />
          <Textarea label="Fact Match (JSON)" value={form.fact_match} minRows={3}
            onChange={(e) => setForm({ ...form, fact_match: e.currentTarget.value })}
            description='Example: {"os.family": "RedHat", "virtual": "physical"}' />
          <TextInput label="Target Group ID" type="number"
            onChange={(e) => setForm({ ...form, group_id: parseInt(e.currentTarget.value) || 0 })}
            description={`Available groups: ${groups?.map((g: any) => `${g.id}=${g.name}`).join(', ') || 'none'}`} />
          <Switch label="Enabled" checked={form.enabled}
            onChange={(e) => setForm({ ...form, enabled: e.currentTarget.checked })} />
          <Button onClick={handleCreate}>Create Rule</Button>
        </Stack>
      </Modal>
    </Stack>
  );
}

/* ────────────────────── Main Page ────────────────────── */
export function NodeClassifierPage() {
  return (
    <Stack>
      <Title order={2}>Node Classifier</Title>
      <Tabs defaultValue="groups" variant="outline">
        <Tabs.List>
          <Tabs.Tab value="groups" leftSection={<IconHierarchy2 size={16} />}>
            Node Groups
          </Tabs.Tab>
          <Tabs.Tab value="classifications" leftSection={<IconTags size={16} />}>
            Classifications
          </Tabs.Tab>
          <Tabs.Tab value="rules" leftSection={<IconRuler size={16} />}>
            Rules
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="groups" pt="md">
          <NodeGroupsTab />
        </Tabs.Panel>

        <Tabs.Panel value="classifications" pt="md">
          <ClassificationsTab />
        </Tabs.Panel>

        <Tabs.Panel value="rules" pt="md">
          <RulesTab />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
