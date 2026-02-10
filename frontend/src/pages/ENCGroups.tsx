import { useState } from 'react';
import {
  Title, Card, Table, Loader, Center, Alert, Stack, Group, Text,
  Button, Modal, TextInput, Textarea, Select, Code, ActionIcon, Tooltip,
} from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { useApi } from '../hooks/useApi';
import { enc } from '../services/api';

export function ENCGroupsPage() {
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

  if (loading) return <Center h={400}><Loader size="xl" /></Center>;
  if (error) return <Alert color="red" title="Error">{error}</Alert>;

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Node Groups</Title>
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
                <Table.Td>{g.description || '—'}</Table.Td>
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
