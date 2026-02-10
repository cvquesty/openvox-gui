import {
  Title, Card, Loader, Center, Alert, Stack, Text, Code, Table,
} from '@mantine/core';
import { useApi } from '../hooks/useApi';
import { config } from '../services/api';

export function ConfigPuppetDBPage() {
  const { data, loading, error } = useApi(config.getPuppetDB);

  if (loading) return <Center h={400}><Loader size="xl" /></Center>;
  if (error) return <Alert color="red" title="Error">{error}</Alert>;

  return (
    <Stack>
      <Title order={2}>PuppetDB Configuration</Title>

      {data && Object.entries(data).map(([section, values]: [string, any]) => (
        <Card key={section} withBorder shadow="sm">
          <Text fw={700} mb="sm">{section}</Text>
          <Table striped>
            <Table.Tbody>
              {Object.entries(values).map(([key, value]: [string, any]) => (
                <Table.Tr key={key}>
                  <Table.Td style={{ width: 300 }}><Text size="sm" fw={500}>{key}</Text></Table.Td>
                  <Table.Td><Code>{String(value)}</Code></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      ))}

      {data && Object.keys(data).length === 0 && (
        <Alert color="yellow">
          No PuppetDB configuration files found. PuppetDB may be using default settings.
        </Alert>
      )}
    </Stack>
  );
}
