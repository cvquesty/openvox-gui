import { useState } from 'react';
import {
  Title, Card, Stack, Group, Text, Badge, Button, Select, Alert,
  Loader, Center, Table, Code, Paper, ThemeIcon, SimpleGrid,
  Notification, ScrollArea, Anchor,
} from '@mantine/core';
import {
  IconRocket, IconGitBranch, IconBrandGithub, IconRefresh,
  IconCheck, IconX, IconPlayerPlay,
} from '@tabler/icons-react';
import { useApi } from '../hooks/useApi';
import { deploy } from '../services/api';

export function CodeDeploymentPage() {
  const { data: envsData, loading: envsLoading } = useApi(() => deploy.getEnvironments());
  const { data: reposData, loading: reposLoading } = useApi(() => deploy.getRepos());
  const { data: statusData, loading: statusLoading, refetch: refetchStatus } = useApi(() => deploy.getStatus());

  const [selectedEnv, setSelectedEnv] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [deployResult, setDeployResult] = useState<any>(null);
  const [deployError, setDeployError] = useState<string | null>(null);

  const environments = envsData?.environments || [];
  const repos = reposData?.repos || [];
  const controlRepos = repos.filter((r: any) => r.type === 'control');
  const moduleRepos = repos.filter((r: any) => r.type === 'module');

  const handleDeploy = async () => {
    setDeploying(true);
    setDeployResult(null);
    setDeployError(null);
    try {
      const result = await deploy.run(selectedEnv || undefined);
      setDeployResult(result);
      refetchStatus();
    } catch (e: any) {
      setDeployError(e.message || 'Deployment failed');
    } finally {
      setDeploying(false);
    }
  };

  if (envsLoading || reposLoading) {
    return <Center h={400}><Loader size="xl" /></Center>;
  }

  return (
    <Stack>
      <Group justify="space-between">
        <Group>
          <ThemeIcon size="xl" color='#EC8622'>
            <IconRocket size={24} />
          </ThemeIcon>
          <Title order={2}>Code Deployment</Title>
        </Group>
      </Group>

      {/* Source Repositories */}
      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        <Card withBorder shadow="sm" padding="lg">
          <Group mb="md">
            <IconBrandGithub size={20} />
            <Title order={4}>Control Repository</Title>
          </Group>
          {controlRepos.length > 0 ? (
            <Stack gap="sm">
              {controlRepos.map((repo: any) => (
                <Paper key={repo.name} withBorder p="sm" radius="md">
                  <Group justify="space-between">
                    <div>
                      <Text fw={600}>{repo.name}</Text>
                      <Anchor href={repo.url.startsWith('http') ? repo.url : `https://${repo.url}`}
                        target="_blank" size="sm" c="dimmed">
                        {repo.url}
                      </Anchor>
                    </div>
                    <Badge variant="outline" color="#EC8622" leftSection={<IconGitBranch size={12} />}>
                      {repo.basedir || 'default'}
                    </Badge>
                  </Group>
                  {repo.source && (
                    <Text size="xs" c="dimmed" mt={4}>Source: {repo.source}</Text>
                  )}
                </Paper>
              ))}
            </Stack>
          ) : (
            <Text c="dimmed">No control repository found in r10k.yaml</Text>
          )}
        </Card>

        <Card withBorder shadow="sm" padding="lg">
          <Group mb="md">
            <IconGitBranch size={20} />
            <Title order={4}>Module Repositories</Title>
          </Group>
          {moduleRepos.length > 0 ? (
            <ScrollArea style={{ maxHeight: 300 }}>
              <Stack gap="sm">
                {moduleRepos.map((repo: any) => (
                  <Paper key={repo.name} withBorder p="sm" radius="md">
                    <Group justify="space-between">
                      <div>
                        <Text fw={600} size="sm">{repo.name}</Text>
                        <Anchor href={repo.url.startsWith('http') ? repo.url : `https://${repo.url}`}
                          target="_blank" size="xs" c="dimmed">
                          {repo.url}
                        </Anchor>
                      </div>
                      <Badge variant="outline" size="sm" leftSection={<IconGitBranch size={10} />}>
                        {repo.branch || 'main'}
                      </Badge>
                    </Group>
                  </Paper>
                ))}
              </Stack>
            </ScrollArea>
          ) : (
            <Text c="dimmed">No git modules found in Puppetfile</Text>
          )}
        </Card>
      </SimpleGrid>

      {/* Deploy Action */}
      <Card withBorder shadow="sm" padding="lg">
        <Title order={4} mb="md">Deploy with r10k</Title>
        <Group align="end">
          <Select
            label="Environment"
            placeholder="All environments"
            data={[
              { value: '', label: '— All Environments —' },
              ...environments.map((e: string) => ({ value: e, label: e })),
            ]}
            value={selectedEnv}
            onChange={setSelectedEnv}
            clearable
            style={{ width: 260 }}
          />
          <Button
            leftSection={deploying ? <Loader size={16} color="white" /> : <IconPlayerPlay size={16} />}
            color="#EC8622"
            onClick={handleDeploy}
            disabled={deploying}
            loading={deploying}
          >
            {deploying ? 'Deploying...' : 'Deploy Now'}
          </Button>
        </Group>

        {!statusLoading && statusData?.last_commit && statusData.last_commit !== 'unknown' && (
          <Text size="xs" c="dimmed" mt="sm">
            Last production commit: {statusData.last_commit}
          </Text>
        )}
      </Card>

      {/* Deploy Result */}
      {deployError && (
        <Alert color="red" title="Deployment Error" icon={<IconX size={18} />}
          withCloseButton onClose={() => setDeployError(null)}>
          {deployError}
        </Alert>
      )}

      {deployResult && (
        <Card withBorder shadow="sm" padding="lg">
          <Group mb="md" justify="space-between">
            <Group>
              <ThemeIcon
                color={deployResult.success ? 'green' : 'red'}
                variant="light" size="lg"
              >
                {deployResult.success ? <IconCheck size={20} /> : <IconX size={20} />}
              </ThemeIcon>
              <div>
                <Title order={4}>
                  Deployment {deployResult.success ? 'Succeeded' : 'Failed'}
                </Title>
                <Text size="sm" c="dimmed">
                  Environment: {deployResult.environment} | Triggered by: {deployResult.triggered_by}
                </Text>
              </div>
            </Group>
            <Badge color={deployResult.success ? 'green' : 'red'} size="lg">
              Exit code: {deployResult.exit_code}
            </Badge>
          </Group>

          {deployResult.output && deployResult.output.length > 0 && (
            <Paper withBorder p="sm" bg="dark.8" radius="md">
              <ScrollArea style={{ maxHeight: 400 }}>
                <Code block style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>
                  {deployResult.output.join('\n')}
                </Code>
              </ScrollArea>
            </Paper>
          )}
        </Card>
      )}

      {/* Available Environments */}
      <Card withBorder shadow="sm" padding="lg">
        <Title order={4} mb="md">Available Environments</Title>
        <Group>
          {environments.map((env: string) => (
            <Badge
              key={env}
              variant={selectedEnv === env ? 'filled' : 'outline'}
              color="#EC8622"
              size="lg"
              style={{ cursor: 'pointer' }}
              onClick={() => setSelectedEnv(env === selectedEnv ? null : env)}
            >
              {env}
            </Badge>
          ))}
          {environments.length === 0 && (
            <Text c="dimmed">No environments found</Text>
          )}
        </Group>
      </Card>
    </Stack>
  );
}
