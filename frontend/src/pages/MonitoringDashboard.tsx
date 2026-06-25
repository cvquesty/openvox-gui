/**
 * NOC / ops single-pane monitoring dashboard (sruiux2 follow-up).
 * Configurable widget grid; preferences in localStorage. Deep links to full Insights pages.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Title, Text, Stack, Group, Card, SimpleGrid, Grid, Badge, Button, MultiSelect,
  Switch, Select, Loader, Center, Alert, RingProgress, ActionIcon, Tooltip, ThemeIcon,
} from '@mantine/core';
import {
  IconLayoutDashboard, IconSettings, IconRefresh, IconExternalLink, IconChartBar,
} from '@tabler/icons-react';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, Legend,
} from 'recharts';
import { dashboard, metrics } from '../services/api';

const STORAGE_KEY = 'openvox-gui-monitor-panels-v1';
const REFRESH_KEY = 'openvox-gui-monitor-refresh-v1';

export type MonitorWidgetId =
  | 'node_status_ring'
  | 'node_status_trends'
  | 'compliance_dist'
  | 'compliance_trend'
  | 'failed_nodes'
  | 'node_health'
  | 'server_health'
  | 'pdb_health'
  | 'environments';

type WidgetDef = {
  id: MonitorWidgetId;
  label: string;
  description: string;
  defaultOn: boolean;
  span: { base: number; md: number };
  detailPath?: string;
};

const WIDGET_CATALOG: WidgetDef[] = [
  {
    id: 'node_status_ring',
    label: 'Node status ring',
    description: 'Current fleet status mix',
    defaultOn: true,
    span: { base: 12, md: 4 },
    detailPath: '/',
  },
  {
    id: 'node_status_trends',
    label: 'Node status trends',
    description: 'Active status over time',
    defaultOn: true,
    span: { base: 12, md: 8 },
    detailPath: '/',
  },
  {
    id: 'compliance_dist',
    label: 'Compliance distribution',
    description: 'Compliant / drifted / failed mix',
    defaultOn: true,
    span: { base: 12, md: 5 },
    detailPath: '/insights/compliance',
  },
  {
    id: 'compliance_trend',
    label: 'Compliance trend',
    description: '24h compliance series',
    defaultOn: true,
    span: { base: 12, md: 7 },
    detailPath: '/insights/compliance',
  },
  {
    id: 'failed_nodes',
    label: 'Failed nodes',
    description: 'Latest failed certnames',
    defaultOn: true,
    span: { base: 12, md: 6 },
    detailPath: '/nodes?status=failed',
  },
  {
    id: 'node_health',
    label: 'Node health snapshot',
    description: 'Staleness / health counts',
    defaultOn: true,
    span: { base: 12, md: 6 },
    detailPath: '/insights/node-health',
  },
  {
    id: 'server_health',
    label: 'OpenVox Server health',
    description: 'Puppet Server key gauges',
    defaultOn: true,
    span: { base: 12, md: 6 },
    detailPath: '/insights/openvox-server-health',
  },
  {
    id: 'pdb_health',
    label: 'OpenVoxDB health',
    description: 'PuppetDB key gauges',
    defaultOn: true,
    span: { base: 12, md: 6 },
    detailPath: '/insights/openvoxdb-health',
  },
  {
    id: 'environments',
    label: 'Environments',
    description: 'Nodes by environment',
    defaultOn: false,
    span: { base: 12, md: 12 },
    detailPath: '/insights/environments',
  },
];

const DEFAULT_IDS = WIDGET_CATALOG.filter((w) => w.defaultOn).map((w) => w.id);

const TT = {
  contentStyle: {
    backgroundColor: 'rgba(20,20,33,0.95)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8,
    fontSize: 12,
    color: '#e0e0e0',
  },
  labelStyle: { fontWeight: 600, color: '#fff' } as const,
};

function loadPanelIds(): MonitorWidgetId[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...DEFAULT_IDS];
    const parsed = JSON.parse(raw) as string[];
    const valid = new Set(WIDGET_CATALOG.map((w) => w.id));
    const ids = parsed.filter((id) => valid.has(id as MonitorWidgetId)) as MonitorWidgetId[];
    return ids.length ? ids : [...DEFAULT_IDS];
  } catch {
    return [...DEFAULT_IDS];
  }
}

function PanelShell({
  title,
  detailPath,
  children,
  onOpenDetail,
}: {
  title: string;
  detailPath?: string;
  children: React.ReactNode;
  onOpenDetail?: (path: string) => void;
}) {
  return (
    <Card withBorder shadow="sm" padding="md" h="100%" style={{ minHeight: 280 }}>
      <Group justify="space-between" mb="sm" wrap="nowrap">
        <Text fw={600} size="sm">
          {title}
        </Text>
        {detailPath && onOpenDetail && (
          <Tooltip label="Open full view">
            <ActionIcon size="sm" variant="subtle" onClick={() => onOpenDetail(detailPath)}>
              <IconExternalLink size={14} />
            </ActionIcon>
          </Tooltip>
        )}
      </Group>
      {children}
    </Card>
  );
}

export function MonitoringDashboardPage() {
  const navigate = useNavigate();
  const [panelIds, setPanelIds] = useState<MonitorWidgetId[]>(() => loadPanelIds());
  const [configureOpen, setConfigureOpen] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(() => {
    try {
      return localStorage.getItem(REFRESH_KEY + '-auto') !== '0';
    } catch {
      return true;
    }
  });
  const [refreshSec, setRefreshSec] = useState(() => {
    try {
      return localStorage.getItem(REFRESH_KEY + '-sec') || '30';
    } catch {
      return '30';
    }
  });
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dashData, setDashData] = useState<any>(null);
  const [compliance, setCompliance] = useState<any>(null);
  const [nodeHealth, setNodeHealth] = useState<any>(null);
  const [serverHealth, setServerHealth] = useState<any>(null);
  const [pdbHealth, setPdbHealth] = useState<any>(null);
  const [environments, setEnvironments] = useState<any>(null);

  const enabled = useMemo(() => new Set(panelIds), [panelIds]);

  const persistPanels = (ids: MonitorWidgetId[]) => {
    setPanelIds(ids);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    } catch {
      /* ignore */
    }
  };

  const fetchAll = useCallback(async () => {
    setError(null);
    const needDash =
      enabled.has('node_status_ring') ||
      enabled.has('node_status_trends') ||
      enabled.has('failed_nodes');
    const needCompliance = enabled.has('compliance_dist') || enabled.has('compliance_trend');
    const needNh = enabled.has('node_health');
    const needSrv = enabled.has('server_health');
    const needPdb = enabled.has('pdb_health');
    const needEnv = enabled.has('environments');

    try {
      const tasks: Promise<void>[] = [];
      if (needDash) {
        tasks.push(
          dashboard.getData().then((d) => {
            setDashData(d);
          })
        );
      }
      if (needCompliance) {
        tasks.push(
          metrics.compliance(24).then((d) => {
            setCompliance(d);
          })
        );
      }
      if (needNh) {
        tasks.push(
          metrics.nodeHealth().then((d) => {
            setNodeHealth(d);
          })
        );
      }
      if (needSrv) {
        tasks.push(
          metrics.puppetserverHealth().then((d) => {
            setServerHealth(d);
          }).catch(() => setServerHealth(null))
        );
      }
      if (needPdb) {
        tasks.push(
          metrics.puppetdbHealth().then((d) => {
            setPdbHealth(d);
          }).catch(() => setPdbHealth(null))
        );
      }
      if (needEnv) {
        tasks.push(
          metrics.environments().then((d) => {
            setEnvironments(d);
          }).catch(() => setEnvironments(null))
        );
      }
      await Promise.all(tasks);
      setLastRefresh(new Date());
    } catch (e: any) {
      setError(e?.message || 'Failed to load monitoring data');
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    setLoading(true);
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    if (!autoRefresh) return;
    const ms = Math.max(10, parseInt(refreshSec, 10) || 30) * 1000;
    const t = setInterval(() => {
      fetchAll();
    }, ms);
    return () => clearInterval(t);
  }, [autoRefresh, refreshSec, fetchAll]);

  useEffect(() => {
    try {
      localStorage.setItem(REFRESH_KEY + '-auto', autoRefresh ? '1' : '0');
      localStorage.setItem(REFRESH_KEY + '-sec', refreshSec);
    } catch {
      /* ignore */
    }
  }, [autoRefresh, refreshSec]);

  const ns = dashData?.node_status || {
    changed: 0,
    unchanged: 0,
    failed: 0,
    unreported: 0,
    noop: 0,
    total: 0,
  };
  const total = ns.total || 1;
  const ringData = [
    { value: ((ns.unchanged || 0) / total) * 100, color: 'green' },
    { value: ((ns.changed || 0) / total) * 100, color: 'yellow' },
    { value: ((ns.failed || 0) / total) * 100, color: 'red' },
    { value: ((ns.noop || 0) / total) * 100, color: 'blue' },
    { value: ((ns.unreported || 0) / total) * 100, color: 'gray' },
  ].filter((s) => s.value > 0);

  const nodeTrends = (dashData?.node_trends || []).map((trend: any) => ({
    timestamp: trend.timestamp,
    unchanged: trend.unchanged || 0,
    changed: trend.changed || 0,
    failed: trend.failed || 0,
    noop: trend.noop || 0,
    unreported: trend.unreported || 0,
  }));

  const failedNodes = (dashData?.nodes || [])
    .filter((n: any) => (n.latest_report_status || '').toLowerCase() === 'failed')
    .slice(0, 25);

  const complianceDist = compliance
    ? [
        { name: 'Compliant', value: compliance.compliant || 0, color: '#28a745' },
        { name: 'Drifted', value: compliance.drifted || 0, color: '#fd7e14' },
        { name: 'Failed', value: compliance.failed || 0, color: '#dc3545' },
        { name: 'Noop', value: compliance.noop || 0, color: '#ffc107' },
        { name: 'Unreported', value: compliance.unreported || 0, color: '#6c757d' },
      ].filter((d) => d.value > 0)
    : [];

  const complianceTrend = (compliance?.trend || []).map((t: any) => ({
    ...t,
    label: t.timestamp
      ? new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '',
  }));

  const envRows = useMemo(() => {
    const raw = environments?.environments || environments?.items || environments;
    if (Array.isArray(raw)) {
      return raw
        .map((e: any) => ({
          name: e.name || e.environment || String(e),
          count: e.count ?? e.nodes ?? e.node_count ?? 0,
        }))
        .sort((a: any, b: any) => b.count - a.count)
        .slice(0, 12);
    }
    if (raw && typeof raw === 'object') {
      return Object.entries(raw)
        .map(([name, count]) => ({ name, count: Number(count) || 0 }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 12);
    }
    return [];
  }, [environments]);

  const openDetail = (path: string) => navigate(path);

  const renderWidget = (id: MonitorWidgetId) => {
    const def = WIDGET_CATALOG.find((w) => w.id === id)!;
    switch (id) {
      case 'node_status_ring':
        return (
          <PanelShell title={def.label} detailPath={def.detailPath} onOpenDetail={openDetail}>
            <Center>
              <RingProgress
                size={180}
                thickness={20}
                roundCaps
                label={
                  <Text ta="center" fw={700} size="lg">
                    {ns.total ?? 0}
                  </Text>
                }
                sections={ringData}
              />
            </Center>
            <Group justify="center" mt="sm" gap="md">
              <Text size="xs">Unch {ns.unchanged ?? 0}</Text>
              <Text size="xs">Chg {ns.changed ?? 0}</Text>
              <Text size="xs" c="red">
                Fail {ns.failed ?? 0}
              </Text>
            </Group>
          </PanelShell>
        );
      case 'node_status_trends':
        return (
          <PanelShell title={def.label} detailPath={def.detailPath} onOpenDetail={openDetail}>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={nodeTrends} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
                <XAxis
                  dataKey="timestamp"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) =>
                    String(v || '').includes('T')
                      ? String(v).split('T')[1]?.substring(0, 5)
                      : String(v).slice(11, 16)
                  }
                />
                <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={32} />
                <ReTooltip {...TT} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" dataKey="unchanged" stroke="#2ecc71" fill="#2ecc71" fillOpacity={0.15} strokeWidth={1.5} />
                <Area type="monotone" dataKey="changed" stroke="#f39c12" fill="#f39c12" fillOpacity={0.12} strokeWidth={1.5} />
                <Area type="monotone" dataKey="failed" stroke="#e74c3c" fill="#e74c3c" fillOpacity={0.12} strokeWidth={2} />
                <Area type="monotone" dataKey="noop" stroke="#3498db" fill="#3498db" fillOpacity={0.1} strokeWidth={1} />
              </AreaChart>
            </ResponsiveContainer>
          </PanelShell>
        );
      case 'compliance_dist':
        return (
          <PanelShell title={def.label} detailPath={def.detailPath} onOpenDetail={openDetail}>
            {!compliance ? (
              <Center h={200}><Loader size="sm" /></Center>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={complianceDist} layout="vertical" margin={{ left: 8, right: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" width={88} tick={{ fontSize: 11 }} />
                  <ReTooltip {...TT} />
                  <Bar dataKey="value" name="Nodes" radius={[0, 4, 4, 0]}>
                    {complianceDist.map((entry, idx) => (
                      <Cell key={idx} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </PanelShell>
        );
      case 'compliance_trend':
        return (
          <PanelShell title={def.label} detailPath={def.detailPath} onOpenDetail={openDetail}>
            {!compliance ? (
              <Center h={200}><Loader size="sm" /></Center>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={complianceTrend}>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={32} />
                  <ReTooltip {...TT} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="compliant" stroke="#28a745" fill="#28a745" fillOpacity={0.12} />
                  <Area type="monotone" dataKey="failed" stroke="#dc3545" fill="#dc3545" fillOpacity={0.1} />
                  <Area type="monotone" dataKey="drifted" stroke="#fd7e14" fill="#fd7e14" fillOpacity={0.08} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </PanelShell>
        );
      case 'failed_nodes':
        return (
          <PanelShell title={def.label} detailPath={def.detailPath} onOpenDetail={openDetail}>
            {failedNodes.length === 0 ? (
              <Text size="sm" c="dimmed" ta="center" py="xl">
                No failed nodes in latest dashboard snapshot
              </Text>
            ) : (
              <Stack gap={4} style={{ maxHeight: 220, overflow: 'auto' }}>
                {failedNodes.map((n: any) => (
                  <Text
                    key={n.certname}
                    size="sm"
                    c="blue"
                    style={{ cursor: 'pointer', textDecoration: 'underline' }}
                    onClick={() => navigate(`/nodes/${n.certname}`)}
                  >
                    {n.certname}
                  </Text>
                ))}
              </Stack>
            )}
          </PanelShell>
        );
      case 'node_health': {
        const summary = nodeHealth?.summary || nodeHealth?.counts || nodeHealth || {};
        const pairs = [
          ['Healthy', summary.healthy ?? summary.ok ?? '—'],
          ['Stale', summary.stale ?? summary.warning ?? '—'],
          ['Critical', summary.critical ?? summary.failed ?? '—'],
          ['Total', summary.total ?? (Array.isArray(nodeHealth?.nodes) ? nodeHealth.nodes.length : '—')],
        ];
        return (
          <PanelShell title={def.label} detailPath={def.detailPath} onOpenDetail={openDetail}>
            {!nodeHealth ? (
              <Center h={160}><Loader size="sm" /></Center>
            ) : (
              <SimpleGrid cols={2} spacing="sm">
                {pairs.map(([k, v]) => (
                  <Card key={String(k)} withBorder padding="sm" ta="center">
                    <Text size="xs" c="dimmed" tt="uppercase">
                      {k}
                    </Text>
                    <Text fw={700} size="lg">
                      {String(v)}
                    </Text>
                  </Card>
                ))}
              </SimpleGrid>
            )}
          </PanelShell>
        );
      }
      case 'server_health': {
        const g = serverHealth?.gauges || serverHealth?.metrics || serverHealth || {};
        const keys = Object.keys(g).filter((k) => typeof g[k] === 'number' || typeof g[k] === 'string').slice(0, 8);
        return (
          <PanelShell title={def.label} detailPath={def.detailPath} onOpenDetail={openDetail}>
            {!serverHealth ? (
              <Text size="sm" c="dimmed">Server health unavailable (check JMX / metrics endpoint)</Text>
            ) : keys.length === 0 ? (
              <Text size="sm" c="dimmed">No numeric gauges in response — open full Server Health page</Text>
            ) : (
              <SimpleGrid cols={2} spacing="xs">
                {keys.map((k) => (
                  <Group key={k} justify="space-between" gap={4}>
                    <Text size="xs" c="dimmed" lineClamp={1} style={{ maxWidth: '55%' }}>
                      {k}
                    </Text>
                    <Text size="sm" fw={600}>
                      {String(g[k])}
                    </Text>
                  </Group>
                ))}
              </SimpleGrid>
            )}
          </PanelShell>
        );
      }
      case 'pdb_health': {
        const g = pdbHealth?.gauges || pdbHealth?.metrics || pdbHealth || {};
        const keys = Object.keys(g).filter((k) => typeof g[k] === 'number' || typeof g[k] === 'string').slice(0, 8);
        return (
          <PanelShell title={def.label} detailPath={def.detailPath} onOpenDetail={openDetail}>
            {!pdbHealth ? (
              <Text size="sm" c="dimmed">OpenVoxDB health unavailable</Text>
            ) : keys.length === 0 ? (
              <Text size="sm" c="dimmed">No numeric gauges — open full OpenVoxDB Health page</Text>
            ) : (
              <SimpleGrid cols={2} spacing="xs">
                {keys.map((k) => (
                  <Group key={k} justify="space-between" gap={4}>
                    <Text size="xs" c="dimmed" lineClamp={1} style={{ maxWidth: '55%' }}>
                      {k}
                    </Text>
                    <Text size="sm" fw={600}>
                      {String(g[k])}
                    </Text>
                  </Group>
                ))}
              </SimpleGrid>
            )}
          </PanelShell>
        );
      }
      case 'environments':
        return (
          <PanelShell title={def.label} detailPath={def.detailPath} onOpenDetail={openDetail}>
            {envRows.length === 0 ? (
              <Text size="sm" c="dimmed">No environment breakdown</Text>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={envRows}>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={50} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={32} />
                  <ReTooltip {...TT} />
                  <Bar dataKey="count" name="Nodes" fill="#0D6EFD" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </PanelShell>
        );
      default:
        return null;
    }
  };

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <div>
          <Group gap="sm">
            <ThemeIcon size="lg" variant="light" color="teal">
              <IconLayoutDashboard size={22} />
            </ThemeIcon>
            <Title order={2}>Monitoring</Title>
            <Badge variant="light" color="teal">
              NOC pane
            </Badge>
          </Group>
          <Text c="dimmed" size="sm" mt={4} maw={640}>
            Single pane of glass for continual ops monitoring. Choose which trends and health panels stay on
            screen; each panel links to its full Insights page. Preferences are saved in this browser.
          </Text>
        </div>
        <Group gap="xs">
          <Text size="xs" c="dimmed">
            {lastRefresh ? `Updated ${lastRefresh.toLocaleTimeString()}` : '—'}
          </Text>
          <Select
            size="xs"
            w={80}
            data={[
              { value: '15', label: '15s' },
              { value: '30', label: '30s' },
              { value: '60', label: '1m' },
              { value: '120', label: '2m' },
              { value: '300', label: '5m' },
            ]}
            value={refreshSec}
            onChange={(v) => setRefreshSec(v || '30')}
            allowDeselect={false}
          />
          <Switch
            size="sm"
            label="Auto"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.currentTarget.checked)}
          />
          <Button
            size="xs"
            variant="light"
            leftSection={<IconRefresh size={14} />}
            onClick={() => {
              setLoading(true);
              fetchAll();
            }}
            loading={loading && !dashData && !compliance}
          >
            Refresh
          </Button>
          <Button
            size="xs"
            variant={configureOpen ? 'filled' : 'default'}
            leftSection={<IconSettings size={14} />}
            onClick={() => setConfigureOpen((o) => !o)}
          >
            Configure panels
          </Button>
          <Button
            size="xs"
            variant="subtle"
            leftSection={<IconChartBar size={14} />}
            onClick={() => navigate('/insights/all')}
          >
            All insights
          </Button>
        </Group>
      </Group>

      {configureOpen && (
        <Card withBorder padding="md">
          <Text fw={600} mb="xs">
            Visible panels
          </Text>
          <Text size="xs" c="dimmed" mb="sm">
            Pick the graphs and health tiles for this wallboard. Order follows the list below (catalog order).
          </Text>
          <MultiSelect
            data={WIDGET_CATALOG.map((w) => ({
              value: w.id,
              label: `${w.label} — ${w.description}`,
            }))}
            value={panelIds}
            onChange={(vals) => persistPanels(vals as MonitorWidgetId[])}
            searchable
            clearable
            nothingFoundMessage="No panels"
          />
          <Group mt="sm" gap="xs">
            <Button size="xs" variant="light" onClick={() => persistPanels([...DEFAULT_IDS])}>
              Reset defaults
            </Button>
            <Button
              size="xs"
              variant="subtle"
              onClick={() => persistPanels(WIDGET_CATALOG.map((w) => w.id))}
            >
              Show all
            </Button>
          </Group>
        </Card>
      )}

      {error && (
        <Alert color="red" title="Monitoring load error" withCloseButton onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading && !dashData && !compliance && panelIds.length > 0 ? (
        <Center h={280}>
          <Loader size="lg" />
        </Center>
      ) : panelIds.length === 0 ? (
        <Alert color="yellow" title="No panels selected">
          Open <strong>Configure panels</strong> and choose at least one graph for your monitoring wall.
        </Alert>
      ) : (
        <Grid gutter="md">
          {WIDGET_CATALOG.filter((w) => enabled.has(w.id)).map((w) => (
            <Grid.Col key={w.id} span={{ base: w.span.base, md: w.span.md }}>
              {renderWidget(w.id)}
            </Grid.Col>
          ))}
        </Grid>
      )}
    </Stack>
  );
}
