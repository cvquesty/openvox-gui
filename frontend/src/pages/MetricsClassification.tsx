/**
 * OpenVox GUI - MetricsClassification.tsx
 *
 * Classification Tree — visual hierarchy of the ENC classification system.
 * Common at top, environments below, groups under their environments,
 * node counts per group. Uses nested Cards for the tree layout.
 */
import {
  Title, Card, Stack, Group, Text, Badge, Loader, Center, Alert, Paper,
  ScrollArea,
} from '@mantine/core';
import { IconHierarchy, IconWorld, IconFolder, IconServer, IconLayersLinked } from '@tabler/icons-react';
import { enc } from '../services/api';
import { useApi } from '../hooks/useApi';

const COLORS = ['#0D6EFD', '#28a745', '#dc3545', '#ffc107', '#6c757d', '#17a2b8', '#fd7e14', '#6f42c1'];

interface HierarchyData {
  common: { classes: string[]; parameters: Record<string, any> };
  environments: Array<{ name: string; classes: string[] }>;
  groups: Array<{ name: string; environment: string; classes: string[] }>;
  nodes: Array<{ certname: string; environment: string; groups: string[]; classes: string[] }>;
}

export function MetricsClassificationPage() {
  const { data, loading, refreshing, error } = useApi(
    () => enc.getHierarchy(),
    [],
    {
      cacheKey: 'openvox_metrics_classification_v1',
      cacheValidate: (d) => d != null && typeof d === 'object',
    },
  );

  if (loading && !data) return <Center h={400}><Loader size="xl" /></Center>;
  if (error && !data) return <Alert color="red" title="Error loading classification">{error}</Alert>;
  if (!data) return null;

  const hierarchy = data as HierarchyData;
  const common = hierarchy.common || { classes: [], parameters: {} };
  const environments = hierarchy.environments || [];
  const groups = hierarchy.groups || [];
  const allNodes = hierarchy.nodes || [];

  // Group groups and nodes by environment
  const groupsByEnv: Record<string, typeof groups> = {};
  for (const g of groups) {
    const env = g.environment || 'production';
    if (!groupsByEnv[env]) groupsByEnv[env] = [];
    groupsByEnv[env].push(g);
  }

  const nodesByEnv: Record<string, typeof allNodes> = {};
  for (const n of allNodes) {
    const env = n.environment || 'production';
    if (!nodesByEnv[env]) nodesByEnv[env] = [];
    nodesByEnv[env].push(n);
  }

  // Count nodes per group
  const nodesPerGroup: Record<string, number> = {};
  for (const n of allNodes) {
    for (const g of n.groups || []) {
      nodesPerGroup[g] = (nodesPerGroup[g] || 0) + 1;
    }
  }

  const commonParamCount = Object.keys(common.parameters || {}).length;

  return (
    <Stack>
      <Group gap="sm">
        <IconHierarchy size={28} />
        <Title order={2}>Classification Tree</Title>
        {refreshing && <Badge variant="outline" color="gray" size="sm">Refreshing…</Badge>}
      </Group>

      <Alert variant="light" color="blue" mb="xs">
        This page visualizes the ENC (External Node Classifier) hierarchy — how classification flows from global defaults (Common) through Environments and Groups down to individual Nodes. Each level can define Puppet classes and parameters that are inherited by the levels below it, with deeper levels overriding higher ones. Use this view to understand which classes are assigned at each level and how many nodes are affected by each group.
      </Alert>

      {/* Summary stats */}
      <Group>
        <Paper withBorder p="sm" radius="md" style={{ flex: 1 }}>
          <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Environments</Text>
          <Text size="xl" fw={700}>{environments.length}</Text>
        </Paper>
        <Paper withBorder p="sm" radius="md" style={{ flex: 1 }}>
          <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Groups</Text>
          <Text size="xl" fw={700}>{groups.length}</Text>
        </Paper>
        <Paper withBorder p="sm" radius="md" style={{ flex: 1 }}>
          <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Classified Nodes</Text>
          <Text size="xl" fw={700}>{allNodes.length}</Text>
        </Paper>
        <Paper withBorder p="sm" radius="md" style={{ flex: 1 }}>
          <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Common Classes</Text>
          <Text size="xl" fw={700}>{common.classes.length}</Text>
        </Paper>
      </Group>

      <ScrollArea>
        {/* Layer 1: Common */}
        <Card
          withBorder shadow="sm" padding="lg"
          style={{ borderLeft: `4px solid ${COLORS[5]}` }}
        >
          <Group gap="sm" mb="sm">
            <IconLayersLinked size={20} color={COLORS[5]} />
            <Title order={4}>Common (Applied to All Nodes)</Title>
          </Group>

          {common.classes.length > 0 && (
            <Group gap="xs" mb="sm">
              <Text size="sm" fw={600} c="dimmed">Classes:</Text>
              {common.classes.map((cls: string) => (
                <Badge key={cls} variant="light" color="cyan" size="sm">{cls}</Badge>
              ))}
            </Group>
          )}

          {commonParamCount > 0 && (
            <Group gap="xs">
              <Text size="sm" fw={600} c="dimmed">Parameters:</Text>
              <Badge variant="light" color="gray" size="sm">{commonParamCount} params</Badge>
            </Group>
          )}

          {common.classes.length === 0 && commonParamCount === 0 && (
            <Text size="sm" c="dimmed">No common classes or parameters configured</Text>
          )}
        </Card>

        {/* Layer 2: Environments */}
        <Stack gap="md" mt="md" ml="xl">
          {environments.map((env, envIdx) => {
            const envGroups = groupsByEnv[env.name] || [];
            const envNodes = nodesByEnv[env.name] || [];

            return (
              <Card
                key={env.name}
                withBorder shadow="sm" padding="lg"
                style={{ borderLeft: `4px solid ${COLORS[envIdx % COLORS.length]}` }}
              >
                <Group gap="sm" mb="sm">
                  <IconWorld size={20} color={COLORS[envIdx % COLORS.length]} />
                  <Title order={4}>{env.name}</Title>
                  <Badge variant="light" size="sm">{envNodes.length} nodes</Badge>
                  <Badge variant="light" color="orange" size="sm">{envGroups.length} groups</Badge>
                </Group>

                {env.classes.length > 0 && (
                  <Group gap="xs" mb="sm">
                    <Text size="sm" fw={600} c="dimmed">Environment classes:</Text>
                    {env.classes.map((cls: string) => (
                      <Badge key={cls} variant="outline" color="blue" size="sm">{cls}</Badge>
                    ))}
                  </Group>
                )}

                {/* Layer 3: Groups under this environment */}
                {envGroups.length > 0 && (
                  <Stack gap="sm" mt="sm" ml="lg">
                    {envGroups.map((grp) => {
                      const nodeCount = nodesPerGroup[grp.name] || 0;
                      return (
                        <Card
                          key={grp.name}
                          withBorder padding="md"
                          style={{
                            borderLeft: '3px solid #fd7e14',
                            backgroundColor: 'var(--mantine-color-body)',
                          }}
                        >
                          <Group gap="sm">
                            <IconFolder size={16} color="#fd7e14" />
                            <Text fw={600} size="sm">{grp.name}</Text>
                            <Badge variant="light" color="orange" size="xs">
                              {nodeCount} {nodeCount === 1 ? 'node' : 'nodes'}
                            </Badge>
                          </Group>
                          {grp.classes.length > 0 && (
                            <Group gap="xs" mt="xs" ml="lg">
                              {grp.classes.map((cls: string) => (
                                <Badge key={cls} variant="dot" color="violet" size="xs">{cls}</Badge>
                              ))}
                            </Group>
                          )}
                        </Card>
                      );
                    })}
                  </Stack>
                )}

                {/* Ungrouped nodes in this environment */}
                {envNodes.filter((n) => !n.groups || n.groups.length === 0).length > 0 && (
                  <Card
                    withBorder padding="md" mt="sm" ml="lg"
                    style={{
                      borderLeft: '3px solid #6c757d',
                      backgroundColor: 'var(--mantine-color-body)',
                    }}
                  >
                    <Group gap="sm" mb="xs">
                      <IconServer size={16} color="#6c757d" />
                      <Text fw={600} size="sm" c="dimmed">Ungrouped Nodes</Text>
                      <Badge variant="light" color="gray" size="xs">
                        {envNodes.filter((n) => !n.groups || n.groups.length === 0).length}
                      </Badge>
                    </Group>
                    <Group gap="xs">
                      {envNodes
                        .filter((n) => !n.groups || n.groups.length === 0)
                        .slice(0, 20)
                        .map((n) => (
                          <Badge key={n.certname} variant="outline" color="gray" size="xs">
                            {n.certname}
                          </Badge>
                        ))}
                      {envNodes.filter((n) => !n.groups || n.groups.length === 0).length > 20 && (
                        <Text size="xs" c="dimmed">
                          +{envNodes.filter((n) => !n.groups || n.groups.length === 0).length - 20} more
                        </Text>
                      )}
                    </Group>
                  </Card>
                )}
              </Card>
            );
          })}

          {environments.length === 0 && (
            <Center h={100}>
              <Text c="dimmed">No environments configured</Text>
            </Center>
          )}
        </Stack>
      </ScrollArea>
    </Stack>
  );
}
