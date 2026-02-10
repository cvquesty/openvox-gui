import { useState } from 'react';
import {
  Title, Card, Table, Loader, Center, Alert, Stack, Group, Text,
  Button, Modal, TextInput, Textarea, Badge, ActionIcon, Tooltip, Code,
} from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { useApi } from '../hooks/useApi';
import { enc } from '../services/api';

export function ENCClassificationsPage() {
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

  if (loading) return <Center h={400}><Loader size="xl" /></Center>;
  if (error) return <Alert color="red" title="Error">{error}</Alert>;

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Node Classifications</Title>
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
                <Table.Td>{c.is_pinned ? <Badge color="blue">Pinned</Badge> : '—'}</Table.Td>
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
