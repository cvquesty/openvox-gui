import {
  Title, Card, Loader, Center, Alert, Stack, Group, Text, Code, Table,
  Badge, Tabs,
} from '@mantine/core';
import { IconNetwork, IconDatabase, IconPackage } from '@tabler/icons-react';
import { useApi } from '../hooks/useApi';
import { config } from '../services/api';

export function ConfigPuppetPage() {
  const { data, loading, error } = useApi(config.getPuppet);
  const { data: puppetdb, loading: pdbLoading } = useApi(config.getPuppetDB);
  const { data: hiera, loading: hieraLoading } = useApi(config.getHiera);

  if (loading) return <Center h={400}><Loader size="xl" /></Center>;
  if (error) return <Alert color="red" title="Error">{error}</Alert>;

  return (
    <Stack>
      <Title order={2}>Puppet Configuration</Title>

      <Tabs defaultValue="puppetserver">
        <Tabs.List>
          <Tabs.Tab value="puppetserver" leftSection={<IconNetwork size={16} />}>PuppetServer</Tabs.Tab>
          <Tabs.Tab value="puppetdb" leftSection={<IconDatabase size={16} />}>PuppetDB</Tabs.Tab>
          <Tabs.Tab value="hiera" leftSection={<IconPackage size={16} />}>Hiera</Tabs.Tab>
        </Tabs.List>

        {/* PuppetServer tab — puppet.conf + environments */}
        <Tabs.Panel value="puppetserver" pt="md">
          <Stack>
            {data?.server_version && (
              <Text c="dimmed">Server Version: <Code>{data.server_version}</Code></Text>
            )}

            {data?.environments && data.environments.length > 0 && (
              <Card withBorder shadow="sm">
                <Text fw={700} mb="sm">Environments</Text>
                <Group>
                  {data.environments.map((env: string) => (
                    <Badge key={env} variant="outline" size="lg">{env}</Badge>
                  ))}
                </Group>
              </Card>
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

        {/* PuppetDB tab */}
        <Tabs.Panel value="puppetdb" pt="md">
          {pdbLoading ? (
            <Center h={200}><Loader /></Center>
          ) : puppetdb && Object.keys(puppetdb).length > 0 ? (
            <Stack>
              {Object.entries(puppetdb).map(([section, values]: [string, any]) => (
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
            </Stack>
          ) : (
            <Alert color="yellow">
              No PuppetDB configuration files found. PuppetDB may be using default settings.
            </Alert>
          )}
        </Tabs.Panel>

        {/* Hiera tab */}
        <Tabs.Panel value="hiera" pt="md">
          {hieraLoading ? (
            <Center h={200}><Loader /></Center>
          ) : (
            <Card withBorder shadow="sm">
              <Text fw={700} mb="sm">hiera.yaml</Text>
              <Code block style={{ maxHeight: 500, overflow: 'auto' }}>
                {JSON.stringify(hiera, null, 2)}
              </Code>
            </Card>
          )}
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
