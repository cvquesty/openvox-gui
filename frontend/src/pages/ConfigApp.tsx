import {
  Title, Card, Loader, Center, Alert, Stack, Text, Code, Table, Badge, Group, ThemeIcon,
} from '@mantine/core';
import { useApi } from '../hooks/useApi';
import { config, dashboard } from '../services/api';
import { StatusBadge } from '../components/StatusBadge';
import type { ServiceStatus } from '../types';

export function ConfigAppPage() {
  const { data, loading, error } = useApi(config.getApp);
  const { data: services } = useApi<ServiceStatus[]>(dashboard.getServices);

  if (loading) return <Center h={400}><Loader size="xl" /></Center>;
  if (error) return <Alert color="red" title="Error">{error}</Alert>;

  const entries = data ? Object.entries(data) : [];

  return (
    <Stack>
      <Title order={2}>Application Configuration</Title>

      <Card withBorder shadow="sm">
        <Text fw={700} mb="sm">Current Settings</Text>
        <Table striped>
          <Table.Tbody>
            {entries.map(([key, value]: [string, any]) => (
              <Table.Tr key={key}>
                <Table.Td style={{ width: 250 }}><Text size="sm" fw={500}>{key}</Text></Table.Td>
                <Table.Td>
                  {typeof value === 'boolean' ? (
                    <Badge color={value ? 'green' : 'gray'}>{value ? 'Yes' : 'No'}</Badge>
                  ) : (
                    <Code>{String(value)}</Code>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>

      <Card withBorder shadow="sm">
        <Text fw={700} mb="sm">Authentication</Text>
        <Group>
          <Text size="sm" c="dimmed">Current Backend:</Text>
          <Badge color={data?.auth_backend === 'none' ? 'yellow' : 'green'} size="lg">
            {data?.auth_backend || 'none'}
          </Badge>
        </Group>
        <Text size="xs" c="dimmed" mt="sm">
          Authentication backend can be changed in /opt/openvox-gui/config/.env.
          Supported backends: none, local (future), ldap (future), saml (future), oidc (future).
        </Text>
      </Card>
    
      <Card withBorder shadow="sm">
        <Text fw={700} mb="sm">Services</Text>
        <Table striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Service</Table.Th>
              <Table.Th>Status</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {services?.map((svc) => (
              <Table.Tr key={svc.service}>
                <Table.Td><Text fw={500}>{svc.service}</Text></Table.Td>
                <Table.Td><StatusBadge status={svc.status} /></Table.Td>
              </Table.Tr>
            ))}
            {(!services || services.length === 0) && (
              <Table.Tr>
                <Table.Td colSpan={2}>
                  <Text c="dimmed" ta="center">Loading services...</Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Card>
    </Stack>
  );
}