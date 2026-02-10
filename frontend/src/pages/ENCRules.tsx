import { useState } from 'react';
import {
  Title, Card, Table, Loader, Center, Alert, Stack, Group, Text,
  Button, Modal, TextInput, Textarea, NumberInput, Badge, ActionIcon, Tooltip, Code, Switch,
} from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { useApi } from '../hooks/useApi';
import { enc } from '../services/api';

export function ENCRulesPage() {
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

  if (loading) return <Center h={400}><Loader size="xl" /></Center>;
  if (error) return <Alert color="red" title="Error">{error}</Alert>;

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Classification Rules</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setModalOpen(true)}>
          Create Rule
        </Button>
      </Group>

      <Alert variant="light" color="blue" mb="sm">
        Rules automatically classify nodes based on their facts. Higher priority rules are evaluated first.
        All matching criteria use AND logic.
      </Alert>

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
