import {
  Title, Card, Loader, Center, Alert, Stack, Group, Text, Code, Table,
  Badge, Tabs, Button,
} from '@mantine/core';
import { IconNetwork, IconFolder, IconPackage, IconRefresh } from '@tabler/icons-react';
import { useApi } from '../hooks/useApi';
import { config } from '../services/api';
import { StatusBadge } from '../components/StatusBadge';
import { useState } from 'react';

export function ConfigPuppetPage() {
  const { data, loading, error, refetch } = useApi(config.getPuppet);
  const { data: services, refetch: refetchServices } = useApi(config.getServices);
  const { data: hiera } = useApi(config.getHiera);
  const [restarting, setRestarting] = useState(false);

  const handleRestart = async (service: string) => {
    setRestarting(true);
    try {
      await config.restartService(service);
      setTimeout(() => { refetchServices(); setRestarting(false); }, 3000);
    } catch (e: any) {
      alert(e.message);
      setRestarting(false);
    }
  };

  if (loading) return <Center h={400}><Loader size="xl" /></Center>;
  if (error) return <Alert color="red" title="Error">{error}</Alert>;

  return (
    <Stack>
      <Title order={2}>PuppetServer Configuration</Title>

      <Tabs defaultValue="config">
        <Tabs.List>
          <Tabs.Tab value="config" leftSection={<IconNetwork size={16} />}>puppet.conf</Tabs.Tab>
          <Tabs.Tab value="environments" leftSection={<IconFolder size={16} />}>Environments</Tabs.Tab>
          <Tabs.Tab value="hiera" leftSection={<IconPackage size={16} />}>Hiera</Tabs.Tab>
          <Tabs.Tab value="services" leftSection={<IconRefresh size={16} />}>Services</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="config" pt="md">
          <Stack>
            {data?.server_version && (
              <Text c="dimmed">Server Version: <Code>{data.server_version}</Code></Text>
            )}
            {data?.puppet_conf && Object.entries(data.puppet_conf).map(([section, values]: [string, any]) => (
              <Card key={section} withBorder shadow="sm">
                <Text fw={700} mb="sm">[{section}]</Text>
                <Table striped>
                  <Table.Tbody>
                    {Object.entries(values).map(([key, value]: [string, any]) => (
                      <Table.Tr key={key}>
                        <Table.Td style={{ width: 250 }}><Text size="sm" fw={500}>{key}</Text></Table.Td>
                        <Table.Td><Code>{String(value)}</Code></Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Card>
            ))}
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="environments" pt="md">
          <Card withBorder shadow="sm">
            <Text fw={700} mb="sm">Available Environments</Text>
            <Group>
              {data?.environments?.map((env: string) => (
                <Badge key={env} variant="outline" size="lg">{env}</Badge>
              ))}
            </Group>
          </Card>
        </Tabs.Panel>

        <Tabs.Panel value="hiera" pt="md">
          <Card withBorder shadow="sm">
            <Text fw={700} mb="sm">hiera.yaml</Text>
            <Code block style={{ maxHeight: 500, overflow: 'auto' }}>
              {JSON.stringify(hiera, null, 2)}
            </Code>
          </Card>
        </Tabs.Panel>

        <Tabs.Panel value="services" pt="md">
          <Stack>
            {services?.map((svc: any) => (
              <Card key={svc.service} withBorder shadow="sm" padding="md">
                <Group justify="space-between">
                  <div>
                    <Text fw={700}>{svc.service}</Text>
                    <Group gap="xs" mt={4}>
                      <StatusBadge status={svc.status} />
                      {svc.pid && <Text size="xs" c="dimmed">PID: {svc.pid}</Text>}
                      {svc.since && <Text size="xs" c="dimmed">Since: {svc.since}</Text>}
                    </Group>
                  </div>
                  <Button variant="outline" color="orange" size="xs"
                    loading={restarting}
                    onClick={() => handleRestart(svc.service)}>
                    Restart
                  </Button>
                </Group>
              </Card>
            ))}
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
