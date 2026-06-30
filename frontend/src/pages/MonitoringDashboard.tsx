/**
 * Insights | Monitoring — NOC wallboard.
 *
 * Does NOT reimplement charts. Embeds the same pages that already look good
 * in the Insights catalog (Fleet Compliance, Run Performance, OpenVox Server
 * Health, OpenVoxDB Health) via embedded={true}, so data, history, and Recharts
 * config stay single-source-of-truth with those full pages.
 *
 * Window control (presets + freeform hours) applies to sections that support
 * lookback (Compliance, Run Performance). Server/DB health remain live poll series.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Title, Text, Stack, Group, Card, Badge, Button, MultiSelect,
  Divider, ThemeIcon, Select, NumberInput,
} from '@mantine/core';
import {
  IconLayoutDashboard, IconSettings, IconExternalLink, IconChartBar,
} from '@tabler/icons-react';
import {
  MetricsCompliancePage,
  WINDOW_HOUR_PRESETS,
  clampWindowHours,
} from './MetricsCompliance';
import { MetricsPerformancePage } from './MetricsPerformance';
import { MetricsPuppetServerHealthPage } from './MetricsPuppetServerHealth';
import { MetricsPuppetDBHealthPage } from './MetricsPuppetDBHealth';

const SECTIONS_KEY = 'openvox-gui-monitor-sections-v3';
const WINDOW_KEY = 'openvox-gui-monitor-window-hours-v2';

const MIN_WINDOW_HOURS = 0.25;
const MAX_WINDOW_HOURS = 168;
const DEFAULT_WINDOW_HOURS = 24;

type SectionId = 'compliance' | 'performance' | 'server' | 'pdb';

type SectionDef = {
  id: SectionId;
  label: string;
  detailPath: string;
  defaultOn: boolean;
};

const SECTION_CATALOG: SectionDef[] = [
  { id: 'compliance', label: 'Fleet Compliance', detailPath: '/insights/compliance', defaultOn: true },
  { id: 'performance', label: 'Run Performance', detailPath: '/insights/performance', defaultOn: true },
  { id: 'server', label: 'OpenVox Server Health', detailPath: '/insights/openvox-server-health', defaultOn: true },
  { id: 'pdb', label: 'OpenVoxDB Health', detailPath: '/insights/openvoxdb-health', defaultOn: true },
];

const DEFAULT_SECTION_IDS = SECTION_CATALOG.filter((s) => s.defaultOn).map((s) => s.id);

function loadSectionIds(): SectionId[] {
  try {
    const raw = localStorage.getItem(SECTIONS_KEY);
    if (!raw) return [...DEFAULT_SECTION_IDS];
    const parsed = JSON.parse(raw) as string[];
    const valid = new Set(SECTION_CATALOG.map((s) => s.id));
    const ids = parsed.filter((id) => valid.has(id as SectionId)) as SectionId[];
    return ids.length ? ids : [...DEFAULT_SECTION_IDS];
  } catch {
    return [...DEFAULT_SECTION_IDS];
  }
}

function loadWindowHours(): number {
  try {
    const raw = localStorage.getItem(WINDOW_KEY);
    if (raw == null || raw === '') return DEFAULT_WINDOW_HOURS;
    const n = parseFloat(raw);
    return Number.isFinite(n) ? clampWindowHours(n) : DEFAULT_WINDOW_HOURS;
  } catch {
    return DEFAULT_WINDOW_HOURS;
  }
}

function SectionFrame({
  title,
  detailPath,
  onOpenDetail,
  children,
}: {
  title: string;
  detailPath: string;
  onOpenDetail: (p: string) => void;
  children: React.ReactNode;
}) {
  return (
    <Card withBorder shadow="sm" padding="md">
      <Group justify="space-between" mb="sm" wrap="nowrap">
        <Text fw={700} size="sm" c="dimmed" tt="uppercase" style={{ letterSpacing: 0.4 }}>
          {title}
        </Text>
        <Button
          size="compact-xs"
          variant="subtle"
          leftSection={<IconExternalLink size={12} />}
          onClick={() => onOpenDetail(detailPath)}
        >
          Full page
        </Button>
      </Group>
      <Divider mb="md" />
      {children}
    </Card>
  );
}

export function MonitoringDashboardPage() {
  const navigate = useNavigate();
  const [sectionIds, setSectionIds] = useState<SectionId[]>(loadSectionIds);
  const [configureOpen, setConfigureOpen] = useState(false);
  const [windowHours, setWindowHours] = useState<number>(loadWindowHours);

  useEffect(() => {
    try {
      localStorage.setItem(SECTIONS_KEY, JSON.stringify(sectionIds));
    } catch {
      /* ignore */
    }
  }, [sectionIds]);

  useEffect(() => {
    try {
      localStorage.setItem(WINDOW_KEY, String(windowHours));
    } catch {
      /* ignore */
    }
  }, [windowHours]);

  const selected = useMemo(
    () => SECTION_CATALOG.filter((s) => sectionIds.includes(s.id)),
    [sectionIds]
  );

  const multiSelectData = SECTION_CATALOG.map((s) => ({
    value: s.id,
    label: s.label,
  }));

  const presetValue = WINDOW_HOUR_PRESETS.some((o) => Number(o.value) === windowHours)
    ? String(windowHours)
    : null;

  const applyWindowHours = (n: number) => {
    setWindowHours(clampWindowHours(n));
  };

  const renderSection = (id: SectionId) => {
    switch (id) {
      case 'compliance':
        return <MetricsCompliancePage embedded windowHours={windowHours} />;
      case 'performance':
        return <MetricsPerformancePage embedded windowHours={windowHours} />;
      case 'server':
        return <MetricsPuppetServerHealthPage embedded />;
      case 'pdb':
        return <MetricsPuppetDBHealthPage embedded />;
      default:
        return null;
    }
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <Group gap="sm">
          <ThemeIcon size="lg" variant="light" color="blue" radius="md">
            <IconLayoutDashboard size={20} />
          </ThemeIcon>
          <div>
            <Title order={2}>Monitoring</Title>
            <Text size="sm" c="dimmed">
              NOC wallboard — same charts as Fleet Compliance, Run Performance, OpenVox Server Health,
              and OpenVoxDB Health (not a separate graph implementation).
            </Text>
          </div>
          <Badge variant="light" color="blue">Live</Badge>
        </Group>
        <Group gap="xs" align="flex-end">
          <Select
            size="xs"
            label="Window"
            data={WINDOW_HOUR_PRESETS}
            value={presetValue}
            placeholder="Custom"
            onChange={(v) => {
              if (v != null) applyWindowHours(Number(v));
            }}
            allowDeselect={false}
            clearable={false}
            searchable
            w={120}
          />
          <NumberInput
            size="xs"
            label="Hours"
            description="Any value"
            value={windowHours}
            onChange={(v) => {
              const n = typeof v === 'number' ? v : parseFloat(String(v));
              if (Number.isFinite(n)) applyWindowHours(n);
            }}
            min={MIN_WINDOW_HOURS}
            max={MAX_WINDOW_HOURS}
            step={0.5}
            decimalScale={2}
            w={100}
          />
          <Button
            size="xs"
            variant={configureOpen ? 'filled' : 'default'}
            leftSection={<IconSettings size={14} />}
            onClick={() => setConfigureOpen((o) => !o)}
          >
            Sections
          </Button>
          <Button
            size="xs"
            variant="subtle"
            leftSection={<IconChartBar size={14} />}
            onClick={() => navigate('/insights/all')}
          >
            Insights catalog
          </Button>
        </Group>
      </Group>

      <Text size="xs" c="dimmed">
        Window applies to <strong>Fleet Compliance</strong> and <strong>Run Performance</strong> lookbacks
        (presets: 1h, 4h, 8h, 12h, 24h, 48h, 72h, 7d — or type any hours e.g. <strong>6.5</strong>).
        Server and OpenVoxDB sections use live poll history while the page is open.
      </Text>

      {configureOpen && (
        <Card withBorder padding="md">
          <Text fw={600} mb={4}>
            Sections on this wallboard
          </Text>
          <Text size="xs" c="dimmed" mb="sm">
            Each section embeds the catalog page graphs (history, refresh, and Recharts config unchanged).
            Use <strong>Full page</strong> on a section for the complete Insights view.
          </Text>
          <MultiSelect
            data={multiSelectData}
            value={sectionIds}
            onChange={(vals) => setSectionIds(vals as SectionId[])}
            searchable
            clearable
            placeholder="Pick sections…"
          />
          <Group mt="sm" gap="xs">
            <Button size="xs" variant="light" onClick={() => setSectionIds([...DEFAULT_SECTION_IDS])}>
              Reset recommended
            </Button>
            <Button
              size="xs"
              variant="subtle"
              onClick={() => setSectionIds(SECTION_CATALOG.map((s) => s.id))}
            >
              All sections
            </Button>
            <Button size="xs" variant="subtle" color="red" onClick={() => setSectionIds([])}>
              Clear all
            </Button>
          </Group>
        </Card>
      )}

      {selected.length === 0 ? (
        <Card withBorder padding="xl">
          <Text c="dimmed">
            No sections selected. Click <strong>Sections</strong> and enable Fleet Compliance, Run Performance,
            OpenVox Server Health, and/or OpenVoxDB Health.
          </Text>
        </Card>
      ) : (
        <Stack gap="xl">
          {selected.map((s) => (
            <SectionFrame
              key={`${s.id}-${windowHours}`}
              title={s.label}
              detailPath={s.detailPath}
              onOpenDetail={(p) => navigate(p)}
            >
              {renderSection(s.id)}
            </SectionFrame>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
