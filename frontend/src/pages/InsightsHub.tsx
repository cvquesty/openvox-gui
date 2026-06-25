/**
 * Insights catalog — deep links to full metric pages (not the NOC wallboard).
 * Primary continuous monitoring lives on MonitoringDashboard (/insights).
 */
import { Title, Text, SimpleGrid, Card, Stack, ThemeIcon, Group, Badge, Button, Alert } from '@mantine/core';
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
  IconLayoutDashboard,
  IconArrowLeft,
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
            <ThemeIcon size="lg" variant="light" color="gray">
              <IconChartBar size={22} />
            </ThemeIcon>
            <Title order={2}>Insights catalog</Title>
            <Badge variant="light">{CARDS.length} views</Badge>
          </Group>
          <Text c="dimmed" size="sm" mt={4}>
            Full-page analytics and health tools. For a NOC-style single pane with live trends, use{' '}
            <Text span fw={600} component="span">Monitoring</Text> (configurable wallboard).
          </Text>
        </div>
        <Button
          leftSection={<IconLayoutDashboard size={16} />}
          onClick={() => navigate('/insights')}
        >
          Open Monitoring dash
        </Button>
      </Group>

      <Alert variant="light" color="teal" title="Continual monitoring">
        The Monitoring dashboard keeps selected graphs on one screen with auto-refresh. Pin compliance,
        node trends, server/DB health, and failed nodes for ops/NOC walls — then open any panel&apos;s
        full page when you need drill-down.
        <Group mt="sm">
          <Button size="xs" variant="light" leftSection={<IconArrowLeft size={14} />} onClick={() => navigate('/insights')}>
            Back to Monitoring
          </Button>
        </Group>
      </Alert>

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
