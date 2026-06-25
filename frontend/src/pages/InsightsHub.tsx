/**
 * Insights launcher — collapses Metrics nav overload (sruiux1 P0 #2).
 */
import { Title, Text, SimpleGrid, Card, Stack, ThemeIcon, Group, Badge } from '@mantine/core';
import { useNavigate } from 'react-router-dom';
import {
  IconHeartRateMonitor,
  IconActivity,
  IconTimeline,
  IconChartPie,
  IconBinaryTree,
  IconTopologyRing,
  IconServer,
  IconHeartbeat,
  IconGridDots,
  IconWorld,
  IconStack2,
  IconChartBar,
} from '@tabler/icons-react';

const CARDS: { path: string; title: string; description: string; icon: any; color: string }[] = [
  { path: '/insights/compliance', title: 'Fleet Compliance', description: 'Run status distribution and compliance trends', icon: IconHeartRateMonitor, color: 'teal' },
  { path: '/insights/performance', title: 'Run Performance', description: 'Catalog compile and agent run timings', icon: IconActivity, color: 'blue' },
  { path: '/insights/timeline', title: 'Change Timeline', description: 'When changes and failures occurred', icon: IconTimeline, color: 'violet' },
  { path: '/insights/facts', title: 'Fact Distribution', description: 'Fleet-wide fact value histograms', icon: IconChartPie, color: 'grape' },
  { path: '/insights/classification', title: 'Classification Tree', description: 'Roles, profiles, and class coverage', icon: IconBinaryTree, color: 'orange' },
  { path: '/insights/catalog', title: 'Catalog Graph', description: 'Catalog resource relationships', icon: IconTopologyRing, color: 'cyan' },
  { path: '/insights/openvox-server-health', title: 'OpenVox Server Health', description: 'Puppet Server JVM and service metrics', icon: IconServer, color: 'indigo' },
  { path: '/insights/openvoxdb-health', title: 'OpenVoxDB Health', description: 'PuppetDB command and storage health', icon: IconHeartRateMonitor, color: 'pink' },
  { path: '/insights/node-health', title: 'Node Health', description: 'Per-node status and staleness', icon: IconHeartbeat, color: 'red' },
  { path: '/insights/heatmap', title: 'Node Heatmap', description: 'Visual density of node outcomes', icon: IconGridDots, color: 'lime' },
  { path: '/insights/environments', title: 'Environments', description: 'Nodes and activity by environment', icon: IconWorld, color: 'green' },
  { path: '/insights/classes', title: 'Class Coverage', description: 'Which classes are applied where', icon: IconStack2, color: 'yellow' },
];

export function InsightsHubPage() {
  const navigate = useNavigate();

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start">
        <div>
          <Group gap="sm">
            <ThemeIcon size="lg" variant="light" color="teal">
              <IconChartBar size={22} />
            </ThemeIcon>
            <Title order={2}>Insights</Title>
            <Badge variant="light">{CARDS.length} views</Badge>
          </Group>
          <Text c="dimmed" size="sm" mt={4}>
            Fleet metrics and health dashboards. Deep links stay on the individual routes; this hub is the entry point from Metrics in the nav.
          </Text>
        </div>
      </Group>

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
        {CARDS.map((c) => {
          const Icon = c.icon;
          return (
            <Card
              key={c.path}
              withBorder
              shadow="sm"
              padding="lg"
              style={{ cursor: 'pointer' }}
              onClick={() => navigate(c.path)}
            >
              <Group align="flex-start" gap="md" wrap="nowrap">
                <ThemeIcon size={42} radius="md" variant="light" color={c.color}>
                  <Icon size={22} />
                </ThemeIcon>
                <div>
                  <Text fw={600}>{c.title}</Text>
                  <Text size="sm" c="dimmed" mt={4}>
                    {c.description}
                  </Text>
                </div>
              </Group>
            </Card>
          );
        })}
      </SimpleGrid>
    </Stack>
  );
}
