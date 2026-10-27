/**
 * NodeHealthGlance — at-a-glance host health for Node Detail only.
 *
 * A) Facter snapshot (memory / uptime / CPU / disks / mounts)
 * B) Host Health sparklines when cert is on the serving estate
 * C) Optional one-shot live sample (Bolt / local /proc) — operator+
 */
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import {
  Card, Stack, Group, Text, Badge, Button, Progress, SimpleGrid,
  Tooltip, ThemeIcon, Loader, Alert, RingProgress,
} from '@mantine/core';
import {
  IconHeartbeat, IconRefresh, IconCpu, IconDatabase,
  IconClock, IconDeviceDesktop, IconAlertTriangle, IconServer2,
} from '@tabler/icons-react';
import {
  ResponsiveContainer, AreaChart, Area, YAxis, Tooltip as ReTooltip,
} from 'recharts';
import { useApi } from '../hooks/useApi';
import { nodes } from '../services/api';
import { notifications } from '@mantine/notifications';

function satColor(level?: string): string {
  if (level === 'red') return 'red';
  if (level === 'yellow') return 'yellow';
  if (level === 'green') return 'teal';
  return 'gray';
}

function pctColor(pct?: number | null): string {
  if (pct == null || Number.isNaN(pct)) return 'gray';
  if (pct >= 95) return 'red';
  if (pct >= 85) return 'yellow';
  if (pct >= 70) return 'orange';
  return 'teal';
}

function seriesPoints(data: any[] | undefined, dataKey: string): any[] {
  if (!data?.length) return [];
  return data.filter((p) => {
    const v = p?.[dataKey];
    return v != null && v !== '' && !Number.isNaN(Number(v));
  });
}

function MiniSpark({
  data,
  dataKey,
  color,
  height = 48,
  domain,
  emptyHint,
}: {
  data: any[];
  dataKey: string;
  color: string;
  height?: number;
  domain?: [number, number | 'auto'];
  emptyHint?: string;
}) {
  const pts = seriesPoints(data, dataKey);
  if (pts.length === 0) {
    return (
      <Text size="xs" c="dimmed" ta="center" py="sm">
        {emptyHint || 'No samples yet'}
      </Text>
    );
  }
  // One point: AreaChart often draws nothing — show a clear value + tiny series
  const chartData =
    pts.length === 1
      ? [pts[0], { ...pts[0], _pad: true }]
      : pts;
  const showDot = pts.length < 4;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={chartData} margin={{ top: 4, right: 2, left: 0, bottom: 0 }}>
        <YAxis hide domain={domain || [0, 'auto']} />
        <ReTooltip
          contentStyle={{
            background: 'rgba(20,20,33,0.95)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 6,
            fontSize: 11,
          }}
          labelFormatter={(_, payload) => {
            const t = payload?.[0]?.payload?.time;
            return t ? String(t).slice(11, 19) : '';
          }}
        />
        <Area
          type="monotone"
          dataKey={dataKey}
          stroke={color}
          fill={color}
          fillOpacity={0.2}
          strokeWidth={1.5}
          dot={showDot}
          connectNulls
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function GaugeCard({
  label,
  valueLabel,
  pct,
  icon,
  hint,
}: {
  label: string;
  valueLabel: string;
  pct?: number | null;
  icon: ReactNode;
  hint?: string;
}) {
  const color = pctColor(pct);
  return (
    <Card withBorder padding="sm" radius="md">
      <Group justify="space-between" mb={6} wrap="nowrap">
        <Group gap={6} wrap="nowrap">
          <ThemeIcon size="sm" variant="light" color={color}>
            {icon}
          </ThemeIcon>
          <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
            {label}
          </Text>
        </Group>
        {pct != null && !Number.isNaN(pct) && (
          <Badge size="xs" color={color} variant="light">
            {Math.round(pct)}%
          </Badge>
        )}
      </Group>
      <Text size="lg" fw={700} lh={1.2}>
        {valueLabel}
      </Text>
      {pct != null && !Number.isNaN(pct) ? (
        <Progress value={Math.min(100, Math.max(0, pct))} color={color} size="sm" mt="xs" radius="xl" />
      ) : (
        <Text size="xs" c="dimmed" mt={6}>
          —
        </Text>
      )}
      {hint && (
        <Text size="xs" c="dimmed" mt={4} lineClamp={2}>
          {hint}
        </Text>
      )}
    </Card>
  );
}

export function NodeHealthGlance({ certname }: { certname: string }) {
  const { data, loading, error, refetch, refreshing } = useApi(
    () => nodes.getHealthGlance(certname),
    [certname],
    {
      cacheKey: `openvox_node_health_glance_v1_${certname}`,
      keepPreviousData: true,
    },
  );
  const [sampling, setSampling] = useState(false);
  /** Last one-shot sample from POST (not returned by plain GET). */
  const [liveSample, setLiveSample] = useState<any | null>(null);

  const handleLiveSample = useCallback(async () => {
    setSampling(true);
    try {
      const res = await nodes.sampleHealthGlance(certname);
      // Prefer nested sample; keep sparkline_point if sample lacks metrics
      const sample = res?.live?.sample || res?.sample || null;
      const spark = res?.live?.sparkline_point || res?.sparkline_point;
      setLiveSample(sample ? { ...sample, ...(spark || {}) } : spark || null);
      notifications.show({
        title: 'Live sample complete',
        message: sample?.cpu_used_pct != null
          ? `CPU ${sample.cpu_used_pct}% · mem ${sample.mem_used_pct ?? '—'}%`
          : 'Host metrics refreshed for this investigation.',
        color: 'teal',
      });
      await refetch();
    } catch (e: any) {
      notifications.show({
        title: 'Live sample failed',
        message: e?.message || String(e),
        color: 'red',
      });
    } finally {
      setSampling(false);
    }
  }, [certname, refetch]);

  const fg = data?.facts_glance || {};
  const mem = fg.memory || {};
  const cpu = fg.cpu || {};
  const up = fg.uptime || {};
  const mounts: any[] = fg.mounts || [];
  const disks: any[] = fg.disks || [];
  const estate = data?.serving_estate || {};
  const live = liveSample || data?.live?.sample || null;
  const history = useMemo(() => {
    const h = [...(estate.history || [])];
    // Fold in the latest live sample so graphs aren't empty after one click
    const pt = liveSample
      ? {
          time: liveSample.time,
          ts: liveSample.ts,
          cpu_used_pct: liveSample.cpu_used_pct,
          mem_used_pct: liveSample.mem_used_pct,
          load1: liveSample.load1,
          cpu_iowait_pct: liveSample.cpu_iowait_pct,
        }
      : null;
    if (pt && (pt.cpu_used_pct != null || pt.mem_used_pct != null || pt.load1 != null)) {
      const last = h[h.length - 1];
      if (!last || last.ts !== pt.ts || last.time !== pt.time) {
        h.push(pt);
      }
    }
    return h.map((p: any) => ({
      ...p,
      label: p.time ? String(p.time).slice(11, 19) : '',
    }));
  }, [estate.history, liveSample]);

  const cpuSeries = useMemo(() => seriesPoints(history, 'cpu_used_pct'), [history]);
  const memSeries = useMemo(() => seriesPoints(history, 'mem_used_pct'), [history]);
  const hasAnySeries = cpuSeries.length > 0 || memSeries.length > 0;

  const sat = live?.saturation || estate.latest?.saturation || data?.facts_saturation || {};
  const latestLive = live || estate.latest || {};

  const rootMount = mounts.find((m) => m.path === '/') || mounts[0];
  const memLabel =
    mem.used_pct != null
      ? `${Math.round(mem.used_pct)}% used`
      : mem.total
        ? String(mem.total)
        : '—';
  const memHint = [mem.total && `total ${mem.total}`, mem.available && `avail ${mem.available}`]
    .filter(Boolean)
    .join(' · ');

  if (loading && !data) {
    return (
      <Card withBorder shadow="sm" padding="md">
        <Group gap="sm">
          <Loader size="sm" />
          <Text size="sm" c="dimmed">
            Loading host health glance…
          </Text>
        </Group>
      </Card>
    );
  }

  return (
    <Card withBorder shadow="sm" padding="md">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start" wrap="wrap">
          <div>
            <Group gap="xs" mb={2}>
              <ThemeIcon size="md" variant="light" color={satColor(sat.level)}>
                <IconHeartbeat size={18} />
              </ThemeIcon>
              <Text fw={700} size="sm">
                Host health
              </Text>
              <Badge size="sm" color={satColor(sat.level)} variant="filled">
                {sat.level || 'n/a'}
              </Badge>
              {estate.member ? (
                <Badge size="sm" variant="light" color="cyan" leftSection={<IconServer2 size={10} />}>
                  serving estate
                  {(estate.roles || []).length ? ` · ${(estate.roles || []).join(', ')}` : ''}
                </Badge>
              ) : (
                <Badge size="sm" variant="outline" color="gray">
                  agent facts
                </Badge>
              )}
            </Group>
            <Text size="xs" c="dimmed">
              At-a-glance for investigation · facts from last agent run
              {estate.member ? ' · sparklines from Host Health ring when available' : ''}
            </Text>
          </div>
          <Group gap="xs">
            <Button
              size="xs"
              variant="default"
              leftSection={refreshing ? <Loader size={12} /> : <IconRefresh size={14} />}
              onClick={() => refetch()}
              disabled={refreshing || sampling}
            >
              Refresh
            </Button>
            <Tooltip label="One-shot /proc sample via local or Bolt (operator). Not fleet-wide collection.">
              <Button
                size="xs"
                variant="light"
                color="cyan"
                leftSection={sampling ? <Loader size={12} /> : <IconDeviceDesktop size={14} />}
                onClick={handleLiveSample}
                loading={sampling}
              >
                Live sample
              </Button>
            </Tooltip>
          </Group>
        </Group>

        {error && (
          <Alert color="red" icon={<IconAlertTriangle size={16} />} py="xs">
            {error}
          </Alert>
        )}

        {(sat.reasons || []).length > 0 && (
          <Group gap={4}>
            {(sat.reasons as string[]).map((r, i) => (
              <Badge key={i} size="xs" color={satColor(sat.level)} variant="light">
                {r}
              </Badge>
            ))}
          </Group>
        )}

        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
          <GaugeCard
            label="Memory"
            valueLabel={memLabel}
            pct={mem.used_pct}
            icon={<IconDatabase size={14} />}
            hint={memHint || fg.as_of_note}
          />
          <GaugeCard
            label="Uptime"
            valueLabel={up.display || '—'}
            pct={null}
            icon={<IconClock size={14} />}
            hint={
              up.days != null
                ? `${up.days} day(s)`
                : latestLive.load1 != null
                  ? `load ${latestLive.load1}`
                  : undefined
            }
          />
          <GaugeCard
            label="CPUs"
            valueLabel={
              cpu.count != null
                ? `${cpu.count}${cpu.physical != null ? ` (${cpu.physical} phys)` : ''}`
                : '—'
            }
            pct={latestLive.cpu_used_pct ?? null}
            icon={<IconCpu size={14} />}
            hint={
              latestLive.cpu_used_pct != null
                ? `live CPU ${latestLive.cpu_used_pct}%`
                : cpu.model
                  ? String(cpu.model).slice(0, 42)
                  : undefined
            }
          />
          <GaugeCard
            label={rootMount ? `Disk ${rootMount.path}` : 'Disk'}
            valueLabel={
              rootMount?.used_pct != null
                ? `${Math.round(rootMount.used_pct)}% used`
                : rootMount?.size || (disks[0] ? `${disks[0].name} ${disks[0].size || ''}` : '—')
            }
            pct={rootMount?.used_pct ?? null}
            icon={<IconDeviceDesktop size={14} />}
            hint={
              rootMount
                ? [rootMount.size && `size ${rootMount.size}`, rootMount.available && `free ${rootMount.available}`]
                    .filter(Boolean)
                    .join(' · ')
                : disks.length
                  ? disks
                      .slice(0, 3)
                      .map((d) => `${d.name}: ${d.size || '?'}`)
                      .join(' · ')
                  : undefined
            }
          />
        </SimpleGrid>

        {/* Extra mounts (compact) */}
        {mounts.length > 1 && (
          <Group gap="xs" wrap="wrap">
            {mounts.slice(0, 5).map((m) => (
              <Tooltip
                key={m.path}
                label={[m.size && `size ${m.size}`, m.available && `free ${m.available}`, m.filesystem]
                  .filter(Boolean)
                  .join(' · ')}
              >
                <Badge
                  size="sm"
                  variant="light"
                  color={pctColor(m.used_pct)}
                  leftSection={
                    m.used_pct != null ? (
                      <RingProgress
                        size={14}
                        thickness={2}
                        sections={[{ value: Math.min(100, m.used_pct), color: pctColor(m.used_pct) }]}
                      />
                    ) : undefined
                  }
                >
                  {m.path} {m.used_pct != null ? `${Math.round(m.used_pct)}%` : m.size || ''}
                </Badge>
              </Tooltip>
            ))}
          </Group>
        )}

        {/* Live / estate numbers strip */}
        {(latestLive.cpu_used_pct != null || latestLive.mem_used_pct != null || latestLive.load1 != null) && (
          <Group gap="md" wrap="wrap">
            <Text size="xs" c="dimmed" fw={600}>
              {live ? 'Live sample' : 'Host Health'}:
            </Text>
            {latestLive.cpu_used_pct != null && (
              <Text size="sm">
                CPU <Text span fw={700}>{latestLive.cpu_used_pct}%</Text>
                {latestLive.cpu_iowait_pct != null && (
                  <Text span c="dimmed" size="xs"> · iowait {latestLive.cpu_iowait_pct}%</Text>
                )}
              </Text>
            )}
            {latestLive.mem_used_pct != null && (
              <Text size="sm">
                Mem <Text span fw={700}>{latestLive.mem_used_pct}%</Text>
                {latestLive.mem_used_mb != null && (
                  <Text span c="dimmed" size="xs">
                    {' '}
                    ({latestLive.mem_used_mb}/{latestLive.mem_total_mb} MiB)
                  </Text>
                )}
              </Text>
            )}
            {latestLive.load1 != null && (
              <Text size="sm">
                Load <Text span fw={700}>{latestLive.load1}</Text>
                {latestLive.load5 != null && (
                  <Text span c="dimmed" size="xs"> / {latestLive.load5} / {latestLive.load15}</Text>
                )}
              </Text>
            )}
            {latestLive.source && (
              <Badge size="xs" variant="outline">
                {latestLive.source}
              </Badge>
            )}
          </Group>
        )}

        {/* Sparklines — only when we have real samples (no empty decorative panes) */}
        {hasAnySeries ? (
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
            <Card withBorder padding="xs" bg="var(--mantine-color-body)">
              <Text size="xs" fw={600} c="dimmed" mb={4}>
                CPU % (recent)
                {cpuSeries.length === 1 ? ' · 1 sample' : cpuSeries.length ? ` · ${cpuSeries.length} pts` : ''}
              </Text>
              <MiniSpark
                data={history}
                dataKey="cpu_used_pct"
                color="#228be6"
                domain={[0, 100]}
                emptyHint="No CPU samples yet — try Live sample"
              />
            </Card>
            <Card withBorder padding="xs" bg="var(--mantine-color-body)">
              <Text size="xs" fw={600} c="dimmed" mb={4}>
                Memory % (recent)
                {memSeries.length === 1 ? ' · 1 sample' : memSeries.length ? ` · ${memSeries.length} pts` : ''}
              </Text>
              <MiniSpark
                data={history}
                dataKey="mem_used_pct"
                color="#12b886"
                domain={[0, 100]}
                emptyHint="No memory samples yet — try Live sample"
              />
            </Card>
          </SimpleGrid>
        ) : (
          <Alert variant="light" color="gray" py="xs">
            <Text size="xs">
              {estate.member
                ? 'No CPU/memory time series for this host yet. The Host Health collector may not have sampled it, or history keys did not match. Click '
                : 'Continuous graphs are only collected for the OpenVox serving estate (console / compilers / OpenVoxDB / CA). For this agent, click '}
              <Text span fw={700}>Live sample</Text>
              {' '}to SSH this one host (sparklines appear after the first sample).
            </Text>
          </Alert>
        )}

        {(latestLive.errors || []).length > 0 && (
          <Alert color="yellow" py="xs">
            {(latestLive.errors as string[]).slice(0, 3).join(' · ')}
          </Alert>
        )}
      </Stack>
    </Card>
  );
}

export default NodeHealthGlance;
