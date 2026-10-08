/**
 * OpenVox GUI - NodeClassifier.tsx
 * 
 * Component documentation to be expanded.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import {
  Title, Card, Table, Loader, Center, Alert, Stack, Group, Text, Tabs,
  Button, Modal, TextInput, Badge, ActionIcon, Tooltip, Code,
  Select, MultiSelect, Grid, ThemeIcon, Divider, Paper, ScrollArea, Box,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconPlus, IconTrash, IconPencil, IconHierarchy2, IconTags,
  IconServer, IconWorld, IconSearch, IconLayersLinked, IconArrowDown, IconX, IconHelp,
  IconRefresh,
} from '@tabler/icons-react';
import { enc, nodes as nodesApi, config } from '../services/api';
import { useAppTheme } from '../hooks/ThemeContext';
import { useApi } from '../hooks/useApi';
import { PrettyJson } from '../components/PrettyJson';
import { ConfirmModal } from '../components/ConfirmModal';
import { LoadingState } from '../components/StateComponents';
import {
  CACHE_ENC_CATALOG,
  CACHE_ENC_COMMON,
  CACHE_ENC_HIERARCHY,
  CACHE_ENC_NODES,
  CACHE_NODES,
} from '../utils/cacheKeys';
import { loadAvailableClasses, readEncClassCache } from '../utils/encClassCache';
import { readSessionCache, writeSessionCache } from '../utils/sessionCache';

/** Shared shape for ENC environments + groups across Classification tabs. */
type EncCatalog = {
  groups: any[];
  envs: any[];
};

/* ═══════════════════════════════════════════════════════════════
   SHARED: Class badges display
   ═══════════════════════════════════════════════════════════════ */
function ClassBadges({ classes, color = 'blue' }: { classes: Record<string, any>; color?: string }) {
  const keys = Object.keys(classes || {});
  if (keys.length === 0) return <Text c="dimmed" size="sm">—</Text>;
  return (
    <Group gap={4} wrap="wrap">
      {keys.map((k) => {
        const params = classes[k];
        const hasParams = params && typeof params === 'object' && Object.keys(params).length > 0;
        return (
          <Tooltip key={k} label={hasParams ? JSON.stringify(params, null, 2) : 'no parameters'} multiline maw={400}>
            <Badge variant="light" color={color} size="sm" style={{ cursor: 'help' }}>{k}</Badge>
          </Tooltip>
        );
      })}
    </Group>
  );
}

function ParamBadges({ params, color = 'cyan' }: { params: Record<string, any>; color?: string }) {
  const entries = Object.entries(params || {});
  if (entries.length === 0) return <Text c="dimmed" size="sm">—</Text>;
  return (
    <Group gap={4} wrap="wrap">
      {entries.map(([k, v]) => (
        <Tooltip key={k} label={`${k} = ${JSON.stringify(v)}`}>
          <Badge variant="light" color={color} size="sm" style={{ cursor: 'help' }}>{k}</Badge>
        </Tooltip>
      ))}
    </Group>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SHARED: Class Picker — multi-select from roles/profiles/modules
   ═══════════════════════════════════════════════════════════════ */
function ClassPicker({
  value, onChange, environment = 'production', label = 'Classes', description,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  environment?: string;
  label?: string;
  description?: string;
}) {
  const [available, setAvailable] = useState<any>(() =>
    readEncClassCache(environment) || {
      roles: [], profiles: [], modules: [], all: [], message: null, source: null, host: null,
    },
  );
  const [loaded, setLoaded] = useState(() => readEncClassCache(environment) != null);
  const [manual, setManual] = useState('');

  useEffect(() => {
    const ac = new AbortController();
    const cached = readEncClassCache<any>(environment);
    if (cached) {
      setAvailable(cached);
      setLoaded(true);
    } else {
      setLoaded(false);
    }
    loadAvailableClasses(environment, ac.signal)
      .then((d) => {
        if (ac.signal.aborted) return;
        setAvailable(d || {});
        setLoaded(true);
      })
      .catch((e: any) => {
        if (e?.name === 'AbortError' || ac.signal.aborted) return;
        if (cached) return;
        setAvailable({
          roles: [], profiles: [], modules: [], all: [],
          message: e?.message || 'Failed to load classes',
        });
        setLoaded(true);
      });
    return () => ac.abort();
  }, [environment]);

  // Keep selected values visible even if not in the remote list yet
  const selectedExtra = (value || []).filter(
    (c) => !(available.all || []).includes(c)
      && !(available.roles || []).includes(c)
      && !(available.profiles || []).includes(c)
      && !(available.modules || []).includes(c),
  );

  const selectData = [
    ...(selectedExtra.length > 0
      ? [{ group: 'Selected', items: selectedExtra.map((c: string) => ({ value: c, label: c })) }]
      : []),
    ...((available.roles || []).length > 0
      ? [{ group: 'Roles', items: available.roles.map((c: string) => ({ value: c, label: c })) }]
      : []),
    ...((available.profiles || []).length > 0
      ? [{ group: 'Profiles', items: available.profiles.map((c: string) => ({ value: c, label: c })) }]
      : []),
    ...((available.modules || []).length > 0
      ? [{ group: 'Modules', items: available.modules.map((c: string) => ({ value: c, label: c })) }]
      : []),
  ];

  const empty = loaded && (available.all || []).length === 0;

  const addManual = () => {
    const name = manual.trim();
    if (!name) return;
    if (!value.includes(name)) onChange([...value, name]);
    setManual('');
  };

  return (
    <Stack gap="xs">
      <MultiSelect
        label={label}
        description={
          available.host
            ? `${description || ''} (from ${available.source || 'compiler'}: ${available.host})`.trim()
            : description
        }
        data={selectData}
        value={value}
        onChange={onChange}
        searchable
        clearable
        placeholder={loaded ? (empty ? 'No classes from compiler — type below' : 'Search and select classes...') : 'Loading classes...'}
        nothingFoundMessage="No matching classes"
        maxDropdownHeight={300}
      />
      {empty && available.message && (
        <Alert color="yellow" variant="light">
          {available.message}
        </Alert>
      )}
      <Group align="flex-end" grow>
        <TextInput
          label="Add class by name"
          description="Works even when discovery is empty (e.g. profiles::base)"
          placeholder="profiles::base::linux"
          value={manual}
          onChange={(e) => setManual(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addManual(); } }}
        />
        <Button variant="light" onClick={addManual} disabled={!manual.trim()} style={{ flex: '0 0 auto' }}>
          Add
        </Button>
      </Group>
    </Stack>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SHARED: Key-Value Parameter Editor
   ═══════════════════════════════════════════════════════════════ */
function ParamEditor({
  value, onChange, label = 'Parameters', description,
}: {
  value: Array<{ key: string; val: string }>;
  onChange: (v: Array<{ key: string; val: string }>) => void;
  label?: string;
  description?: string;
}) {
  const addRow = () => onChange([...value, { key: '', val: '' }]);
  const removeRow = (idx: number) => onChange(value.filter((_, i) => i !== idx));
  const updateRow = (idx: number, field: 'key' | 'val', v: string) => {
    const updated = [...value];
    updated[idx] = { ...updated[idx], [field]: v };
    onChange(updated);
  };

  return (
    <div>
      <Group justify="space-between" mb={4}>
        <Text size="sm" fw={500}>{label}</Text>
        <Button variant="subtle" size="compact-xs" leftSection={<IconPlus size={12} />} onClick={addRow}>
          Add
        </Button>
      </Group>
      {description && <Text size="xs" c="dimmed" mb="xs">{description}</Text>}
      {value.length === 0 && (
        <Text size="xs" c="dimmed" fs="italic">No parameters defined</Text>
      )}
      <Stack gap={4}>
        {value.map((row, idx) => (
          <Group key={idx} gap="xs" wrap="nowrap">
            <TextInput
              placeholder="Key"
              value={row.key}
              onChange={(e) => updateRow(idx, 'key', e.currentTarget.value)}
              size="xs"
              style={{ flex: 1 }}
            />
            <TextInput
              placeholder="Value"
              value={row.val}
              onChange={(e) => updateRow(idx, 'val', e.currentTarget.value)}
              size="xs"
              style={{ flex: 2 }}
            />
            <ActionIcon size="sm" variant="subtle" color="red" onClick={() => removeRow(idx)}>
              <IconX size={14} />
            </ActionIcon>
          </Group>
        ))}
      </Stack>
    </div>
  );
}

/* ── Helpers: convert between {key:val} dict and [{key,val}] array ── */
function dictToRows(d: Record<string, any>): Array<{ key: string; val: string }> {
  return Object.entries(d || {}).map(([key, val]) => ({ key, val: String(val) }));
}
function rowsToDict(rows: Array<{ key: string; val: string }>): Record<string, string> {
  const d: Record<string, string> = {};
  for (const r of rows) {
    if (r.key.trim()) d[r.key.trim()] = r.val;
  }
  return d;
}
function classListToDict(classes: string[]): Record<string, Record<string, never>> {
  const d: Record<string, Record<string, never>> = {};
  for (const c of classes) d[c] = {};
  return d;
}
function classDictToList(d: Record<string, any>): string[] {
  return Object.keys(d || {});
}


/* ═══════════════════════════════════════════════════════════════
   NODE-O-SCOPE 2000 — classification machine cartoon
   ═══════════════════════════════════════════════════════════════ */
function NodeOScope() {
  return (
    <svg viewBox="0 0 520 280" width="100%" style={{ maxHeight: 300 }}>
      <defs>
        <linearGradient id="ns-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1a1b2e" />
          <stop offset="100%" stopColor="#252540" />
        </linearGradient>
        <linearGradient id="ns-lens" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#334466" />
          <stop offset="100%" stopColor="#223344" />
        </linearGradient>
      </defs>

      <rect width="520" height="280" fill="url(#ns-sky)" rx="8" />

      {/* Stars */}
      <circle cx="40" cy="20" r="1" fill="#fff" opacity="0.5" />
      <circle cx="120" cy="35" r="0.8" fill="#fff" opacity="0.3" />
      <circle cx="200" cy="15" r="1.2" fill="#fff" opacity="0.4" />
      <circle cx="320" cy="25" r="0.7" fill="#fff" opacity="0.5" />
      <circle cx="440" cy="18" r="1" fill="#fff" opacity="0.4" />
      <circle cx="490" cy="40" r="0.9" fill="#fff" opacity="0.3" />

      {/* Ground */}
      <rect x="0" y="235" width="520" height="45" fill="#1a1a2e" />
      <rect x="0" y="235" width="520" height="2" fill="#333355" />

      {/* ── The Microscope/Scanner Device ── */}
      {/* Base */}
      <rect x="200" y="200" width="120" height="30" fill="#445566" rx="5" stroke="#667788" strokeWidth="1" />

      {/* Arm */}
      <rect x="250" y="100" width="20" height="100" fill="#556677" rx="3" />

      {/* Eyepiece */}
      <ellipse cx="260" cy="90" rx="30" ry="18" fill="url(#ns-lens)" stroke="#667788" strokeWidth="1.5" />
      <ellipse cx="260" cy="90" rx="20" ry="12" fill="#0a1628" stroke="#334466" strokeWidth="1" />
      {/* Scanning beam */}
      <ellipse cx="260" cy="90" rx="14" ry="8" fill="#44aaff" opacity="0.15">
        <animate attributeName="opacity" values="0.15;0.4;0.15" dur="2s" repeatCount="indefinite" />
      </ellipse>
      {/* Scan rings */}
      <ellipse cx="260" cy="90" rx="8" ry="5" fill="none" stroke="#44aaff" strokeWidth="0.5" opacity="0.6">
        <animate attributeName="rx" values="8;22;8" dur="3s" repeatCount="indefinite" />
        <animate attributeName="ry" values="5;14;5" dur="3s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.6;0;0.6" dur="3s" repeatCount="indefinite" />
      </ellipse>

      {/* Label plate */}
      <rect x="210" y="205" width="100" height="16" fill="#334455" rx="2" />
      <text x="260" y="216" textAnchor="middle" fill="#EC8622" fontSize="7" fontFamily="monospace" fontWeight="bold">
        NODE-O-SCOPE 2000
      </text>

      {/* Status lights on base */}
      <circle cx="215" cy="225" r="3" fill="#44ff44">
        <animate attributeName="fill" values="#44ff44;#22aa22;#44ff44" dur="1.5s" repeatCount="indefinite" />
      </circle>
      <circle cx="225" cy="225" r="3" fill="#ffaa22">
        <animate attributeName="fill" values="#ffaa22;#cc8811;#ffaa22" dur="2s" repeatCount="indefinite" />
      </circle>
      <circle cx="235" cy="225" r="3" fill="#44aaff">
        <animate attributeName="fill" values="#44aaff;#2288cc;#44aaff" dur="1.8s" repeatCount="indefinite" />
      </circle>

      {/* ── Unclassified nodes entering (left) ── */}
      <rect x="30" y="170" width="40" height="30" fill="#445566" rx="3" stroke="#556677" strokeWidth="1" opacity="0.7">
        <animate attributeName="x" values="30;80;30" dur="5s" repeatCount="indefinite" />
      </rect>
      <text x="50" y="188" textAnchor="middle" fill="#aabbcc" fontSize="6" fontFamily="monospace">
        <animate attributeName="x" values="50;100;50" dur="5s" repeatCount="indefinite" />
        ???
      </text>

      <rect x="60" y="140" width="40" height="30" fill="#445566" rx="3" stroke="#556677" strokeWidth="1" opacity="0.7">
        <animate attributeName="x" values="60;110;60" dur="5s" repeatCount="indefinite" begin="1.5s" />
      </rect>
      <text x="80" y="158" textAnchor="middle" fill="#aabbcc" fontSize="6" fontFamily="monospace">
        <animate attributeName="x" values="80;130;80" dur="5s" repeatCount="indefinite" begin="1.5s" />
        ???
      </text>

      {/* Arrows left */}
      <text x="140" y="180" fill="#556677" fontSize="14">→</text>
      <text x="140" y="155" fill="#556677" fontSize="14">→</text>

      {/* ── Classified nodes exiting (right) ── */}
      {/* Production web server */}
      <g>
        <rect x="380" y="110" width="55" height="35" fill="#445566" rx="3" stroke="#44ff44" strokeWidth="1.5" />
        <rect x="385" y="115" width="45" height="8" fill="#0a1628" rx="1" />
        <text x="407" y="122" textAnchor="middle" fill="#44ff88" fontSize="5" fontFamily="monospace">web01</text>
        <Badge><rect x="385" y="128" width="20" height="7" fill="#4488ff" rx="2" /></Badge>
        <text x="395" y="134" textAnchor="middle" fill="white" fontSize="4" fontFamily="monospace">prod</text>
        <rect x="408" y="128" width="25" height="7" fill="#ff8844" rx="2" />
        <text x="420" y="134" textAnchor="middle" fill="white" fontSize="4" fontFamily="monospace">web</text>
        <text x="437" y="135" fill="#44ff44" fontSize="10">✓</text>
      </g>

      {/* Staging db server */}
      <g>
        <rect x="400" y="160" width="55" height="35" fill="#445566" rx="3" stroke="#44aaff" strokeWidth="1.5" />
        <rect x="405" y="165" width="45" height="8" fill="#0a1628" rx="1" />
        <text x="427" y="172" textAnchor="middle" fill="#44ff88" fontSize="5" fontFamily="monospace">db01</text>
        <rect x="405" y="178" width="20" height="7" fill="#22aacc" rx="2" />
        <text x="415" y="184" textAnchor="middle" fill="white" fontSize="4" fontFamily="monospace">stg</text>
        <rect x="428" y="178" width="18" height="7" fill="#aa44ff" rx="2" />
        <text x="437" y="184" textAnchor="middle" fill="white" fontSize="4" fontFamily="monospace">db</text>
        <text x="457" y="185" fill="#44ff44" fontSize="10">✓</text>
      </g>

      {/* Arrows right */}
      <text x="340" y="140" fill="#556677" fontSize="14">→</text>
      <text x="340" y="180" fill="#556677" fontSize="14">→</text>

      {/* Caption */}
      <text x="260" y="252" textAnchor="middle" fill="#8899aa" fontSize="10" fontFamily="monospace">
        The Classification Engine
      </text>
      <text x="260" y="266" textAnchor="middle" fill="#556677" fontSize="8" fontFamily="monospace">
        unknown nodes in → classified nodes out
      </text>
    </svg>
  );
}
/* ═══════════════════════════════════════════════════════════════
   TAB 1: HIERARCHY OVERVIEW
   ═══════════════════════════════════════════════════════════════ */
function HierarchyTab({ reloadToken = 0 }: { reloadToken?: number }) {
  const navigate = useNavigate();
  const { isRobots } = useAppTheme();
  const { data, loading } = useApi(
    () => enc.getHierarchy(),
    [reloadToken],
    {
      cacheKey: CACHE_ENC_HIERARCHY,
      cacheValidate: (v) => v != null && typeof v === 'object',
    },
  );
  const { data: fleet } = useApi(
    () => nodesApi.list().catch(() => [] as any[]),
    [],
    {
      cacheKey: CACHE_NODES,
      cacheValidate: (rows) => Array.isArray(rows),
    },
  );
  const puppetNodes = (Array.isArray(fleet) ? fleet : []).map((x: any) => x.certname).filter(Boolean).sort();

  if (loading && !data) return <Center h={300}><Loader size="xl" /></Center>;
  if (!data) return <Alert color="red">Failed to load hierarchy</Alert>;

  // Filter hierarchy nodes to only those active in PuppetDB
  const puppetSet = new Set(puppetNodes.map((cn) => cn.toLowerCase()));
  const activeHierarchyNodes = (data.nodes || []).filter((n: any) =>
    puppetSet.has(n.certname.toLowerCase())
  );

  const layers = [
    { level: 4, label: 'Node', icon: IconServer, color: 'red',
      desc: 'Per-node overrides (highest priority)', count: activeHierarchyNodes.length },
    { level: 3, label: 'Group', icon: IconTags, color: 'orange',
      desc: 'Logical groupings — webservers, databases, etc.', count: data.groups?.length || 0 },
    { level: 2, label: 'Environment', icon: IconWorld, color: 'blue',
      desc: 'control_repo branches — apply classes/parameters only', count: data.environments?.length || 0 },
    { level: 1, label: 'Common', icon: IconLayersLinked, color: 'green',
      desc: 'Global defaults applied to every node',
      count: (Object.keys(data.common?.classes || {}).length + Object.keys(data.common?.parameters || {}).length) > 0 ? 1 : 0 },
  ];

  return (
    <Stack>
      {isRobots && (
        <Card withBorder shadow="sm" padding="sm" mb="md" style={{ overflow: 'hidden' }}>
          <NodeOScope />
        </Card>
      )}

      <Alert variant="light" color="blue" mb="xs">
        Classification is resolved by deep-merging four layers. Higher layers override
        lower ones. Classes and parameters accumulate upward — a node inherits from
        Common → its Environment → its Groups → its own overrides.
      </Alert>
      <Grid>
        <Grid.Col span={{ base: 12, md: 5 }}>
          <Stack gap="xs">
            {layers.map((layer, idx) => (
              <div key={layer.level}>
                <Card withBorder shadow="sm" padding="md">
                  <Group gap="sm">
                    <ThemeIcon size="lg" variant="light" color={layer.color} radius="md">
                      <layer.icon size={20} />
                    </ThemeIcon>
                    <div style={{ flex: 1 }}>
                      <Group justify="space-between">
                        <Text fw={700} size="sm">Layer {layer.level}: {layer.label}</Text>
                        <Badge size="sm" variant="outline" color={layer.color}>
                          {layer.count} {layer.count === 1 ? 'entry' : 'entries'}
                        </Badge>
                      </Group>
                      <Text size="xs" c="dimmed">{layer.desc}</Text>
                    </div>
                  </Group>
                </Card>
                {idx < layers.length - 1 && (
                  <Center my={4}><IconArrowDown size={16} color="var(--mantine-color-dimmed)" /></Center>
                )}
              </div>
            ))}
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 7 }}>
          <Card withBorder shadow="sm" padding="md">
            <Text fw={700} mb="sm">Current Configuration Summary</Text>

            <Text fw={600} size="sm" mt="md" mb={4}>Common Defaults</Text>
            <Group gap="md" mb="sm">
              <div><Text size="xs" c="dimmed">Classes</Text><ClassBadges classes={data.common?.classes || {}} color="green" /></div>
              <div><Text size="xs" c="dimmed">Parameters</Text><ParamBadges params={data.common?.parameters || {}} color="green" /></div>
            </Group>
            <Divider my="sm" />

            <Text fw={600} size="sm" mb={4}>Environments ({data.environments?.length || 0})</Text>
            <Box style={{ maxHeight: 300, minHeight: 0, overflow: 'hidden' }}>
              <ScrollArea h="100%" type="auto" offsetScrollbars scrollbarSize={6}>
              {(data.environments || []).map((e: any) => (
                  <Paper key={e.name} p="xs" mb={4} withBorder>
                    <Group justify="space-between">
                      <Badge color="blue">{e.name}</Badge>
                      <ClassBadges classes={e.classes || {}} color="blue" />
                    </Group>
                  </Paper>
                ))}
                {(data.environments || []).length === 0 && <Text size="sm" c="dimmed">No environments defined yet</Text>}
              </ScrollArea>
            </Box>
            <Divider my="sm" />

            <Text fw={600} size="sm" mb={4}>Groups ({data.groups?.length || 0})</Text>
            <Box style={{ maxHeight: 350, minHeight: 0, overflow: 'hidden' }}>
              <ScrollArea h="100%" type="auto" offsetScrollbars scrollbarSize={6}>
              {(data.groups || []).map((g: any) => (
                  <Paper key={g.id} p="xs" mb={4} withBorder>
                    <Group justify="space-between">
                      <Group gap="xs"><Badge color="orange">{g.name}</Badge><Badge variant="outline" size="xs">{g.environment}</Badge></Group>
                      <ClassBadges classes={g.classes || {}} color="orange" />
                    </Group>
                  </Paper>
                ))}
                {(data.groups || []).length === 0 && <Text size="sm" c="dimmed">No groups defined yet</Text>}
              </ScrollArea>
            </Box>
            <Divider my="sm" />

            <Text fw={600} size="sm" mb={4}>Classified Nodes ({activeHierarchyNodes.length})</Text>
            <Box style={{ maxHeight: 600, minHeight: 0, overflow: 'hidden' }}>
              <ScrollArea h="100%" type="auto" offsetScrollbars scrollbarSize={6}>
              {activeHierarchyNodes.map((n: any) => (
                  <Paper key={n.certname} p="xs" mb={4} withBorder>
                    <Group justify="space-between">
                      <Group gap="xs">
                        <Text size="sm" fw={500} c="blue" style={{ cursor: 'pointer', textDecoration: 'underline' }}
                          onClick={() => navigate(`/nodes/${n.certname}`)}>{n.certname}</Text>
                        <Badge variant="outline" size="xs">{n.environment}</Badge>
                        {(n.groups || []).map((g: string) => <Badge key={g} variant="light" color="orange" size="xs">{g}</Badge>)}
                      </Group>
                      <ClassBadges classes={n.classes || {}} color="red" />
                    </Group>
                  </Paper>
                ))}
                {activeHierarchyNodes.length === 0 && <Text size="sm" c="dimmed">No nodes classified yet</Text>}
              </ScrollArea>
            </Box>
          </Card>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}

/** Short-lived cache: compiler environment discovery is slow on clustered consoles. */
let _envDiscoveryCache: { at: number; names: string[] } | null = null;
const ENV_DISCOVERY_TTL_MS = 90_000;

/**
 * Discover control_repo environment names (r10k branch ↔ environment).
 * Cached ~90s so tab switches / re-mounts do not re-hit compiler HTTP every time.
 */
async function discoverControlRepoEnvironments(force = false): Promise<string[]> {
  if (
    !force
    && _envDiscoveryCache
    && Date.now() - _envDiscoveryCache.at < ENV_DISCOVERY_TTL_MS
  ) {
    return _envDiscoveryCache.names;
  }
  try {
    const puppetResp = await config.getEnvironments();
    const raw = Array.isArray(puppetResp?.environments) ? puppetResp.environments : [];
    const names: string[] = raw
      .map((n: unknown) => String(n ?? '').trim())
      .filter((n: string) => n.length > 0);
    if (names.length > 0) {
      const sorted = Array.from(new Set(names)).sort();
      _envDiscoveryCache = { at: Date.now(), names: sorted };
      return sorted;
    }
  } catch {
    /* fall through */
  }
  return [];
}

/**
 * Merge discovered environment names with ENC rows.
 *
 * By default this is **read-only and fast**: list ENC envs + discover names,
 * stub missing rows in the UI. Creating missing ENC DB rows is opt-in
 * (``ensureRows: true``) for explicit Refresh — sequential create-per-env was
 * making Classification open painfully slow on multi-env control repos.
 */
async function ensureEncEnvironments(opts?: {
  notify?: boolean;
  /** When true, sync ENC rows to live r10k environments (Refresh list). */
  ensureRows?: boolean;
  /** Bypass discovery cache (after r10k / operator refresh). */
  forceDiscover?: boolean;
}): Promise<{
  envs: any[];
  discovered: string[];
}> {
  const ensureRows = opts?.ensureRows === true;
  const [discovered, encEnvsRaw] = await Promise.all([
    discoverControlRepoEnvironments(opts?.forceDiscover === true),
    enc.listEnvironments().catch(() => [] as any[]),
  ]);
  let encEnvs = Array.isArray(encEnvsRaw) ? encEnvsRaw : [];

  const byName = new Map<string, any>();
  for (const e of encEnvs) {
    if (e?.name) byName.set(String(e.name), e);
  }

  let created: string[] = [];
  let pruned: string[] = [];
  let keptInUse: string[] = [];
  if (ensureRows) {
    try {
      const sync = await enc.syncEnvironments();
      created = Array.isArray(sync?.created) ? sync.created : [];
      pruned = Array.isArray(sync?.pruned) ? sync.pruned : [];
      keptInUse = Array.isArray(sync?.kept_in_use) ? sync.kept_in_use : [];
      if (Array.isArray(sync?.live) && sync.live.length > 0) {
        discovered.splice(0, discovered.length, ...sync.live.map((n) => String(n)));
      }
      const fresh = await enc.listEnvironments();
      if (Array.isArray(fresh)) {
        byName.clear();
        for (const e of fresh) {
          if (e?.name) byName.set(String(e.name), e);
        }
      }
    } catch {
      /* keep current ENC map */
    }
  }

  // Live r10k environments only. Pruned branches (kea_cutover) must not
  // appear in Classification menus even if an ENC row still exists.
  const names = discovered.length > 0 ? discovered : [];
  const live = new Set(names);
  if (live.size > 0) {
    for (const name of names) {
      if (!byName.has(name)) {
        byName.set(name, { name, classes: {}, parameters: {}, description: '' });
      }
    }
  } else if (byName.size === 0) {
    byName.set('production', { name: 'production', classes: {}, parameters: {}, description: '' });
  }
  const envs = Array.from(byName.values())
    .filter((e) => live.size === 0 || live.has(String(e.name)))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  if (opts?.notify) {
    const listed = envs.map((e) => e.name).join(', ');
    const bits: string[] = [];
    if (created.length > 0) bits.push(`added ${created.join(', ')}`);
    if (pruned.length > 0) bits.push(`removed ${pruned.join(', ')}`);
    if (keptInUse.length > 0) {
      bits.push(`kept in-use ${keptInUse.join(', ')} (reclassify nodes/groups first)`);
    }
    if (envs.length === 0) {
      notifications.show({
        title: 'No environments found',
        message: 'Could not discover control_repo branches from compilers',
        color: 'yellow',
      });
    } else {
      notifications.show({
        title: 'Environments synced',
        message: bits.length > 0
          ? `${bits.join('; ')}. Showing ${envs.length}: ${listed}`
          : `Showing ${envs.length} live environment${envs.length === 1 ? '' : 's'}: ${listed}`,
        color: 'blue',
      });
    }
  }

  return { envs, discovered: names.length > 0 ? names : envs.map((e) => String(e.name)) };
}

/**
 * One shared catalog for Classification tabs so Create Group immediately
 * appears in Classify Node (and other consumers) without a full page reload.
 */
function isEncCatalog(value: EncCatalog): boolean {
  return Array.isArray(value?.groups) && Array.isArray(value?.envs);
}

function useEncCatalog() {
  const seed = readSessionCache<EncCatalog>(CACHE_ENC_CATALOG, isEncCatalog);
  const [catalog, setCatalog] = useState<EncCatalog>(seed || { groups: [], envs: [] });
  const [ready, setReady] = useState(seed != null);
  const refreshGen = useRef(0);

  const refresh = useCallback(async (opts?: {
    notify?: boolean;
    ensureRows?: boolean;
    forceDiscover?: boolean;
  }): Promise<EncCatalog> => {
    const gen = ++refreshGen.current;
    let groups: any[] = [];
    try {
      // Groups first, and immediately — do not wait on compiler env
      // discovery. A slow Promise.all used to finish *after* Create
      // Group and overwrite the table with the pre-insert list.
      const g = await enc.listGroups();
      groups = Array.isArray(g) ? g : [];
      if (gen === refreshGen.current) {
        setCatalog((prev) => ({ ...prev, groups }));
      }
    } catch (e: any) {
      if (gen === refreshGen.current) {
        notifications.show({
          title: 'Could not load ENC groups',
          message: e?.message || String(e),
          color: 'red',
        });
      }
    }

    let envs: any[] = [];
    try {
      const envResult = await ensureEncEnvironments({
        notify: opts?.notify ?? false,
        ensureRows: opts?.ensureRows ?? false,
        forceDiscover: opts?.forceDiscover ?? false,
      });
      envs = envResult.envs || [];
    } catch {
      envs = [];
    }
    const next: EncCatalog = { groups, envs };
    if (gen === refreshGen.current) {
      setCatalog(next);
      setReady(true);
      writeSessionCache(CACHE_ENC_CATALOG, next);
    }
    return next;
  }, []);

  useEffect(() => { void refresh({ ensureRows: false }); }, [refresh]);

  return { ...catalog, ready, refresh };
}

/** MultiSelect data: all ENC groups, optionally highlighting the selected env first. */
function groupMultiSelectData(groups: any[], preferEnv?: string) {
  const sorted = [...(groups || [])].sort((a, b) => {
    if (preferEnv) {
      const aMatch = a.environment === preferEnv ? 0 : 1;
      const bMatch = b.environment === preferEnv ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
    }
    const envCmp = String(a.environment || '').localeCompare(String(b.environment || ''));
    if (envCmp !== 0) return envCmp;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
  const byEnv: Record<string, Array<{ value: string; label: string }>> = {};
  for (const g of sorted) {
    const env = g.environment || 'unknown';
    if (!byEnv[env]) byEnv[env] = [];
    byEnv[env].push({
      value: String(g.id),
      label: preferEnv && g.environment !== preferEnv
        ? `${g.name} (${g.environment})`
        : String(g.name),
    });
  }
  return Object.entries(byEnv).map(([env, items]) => ({ group: env, items }));
}

/* ═══════════════════════════════════════════════════════════════
   TAB 2: ENVIRONMENTS
   Names come from control_repo (via compilers). Operators only set
   classes/parameters — no inventing or deleting environment names.
   ═══════════════════════════════════════════════════════════════ */
function EnvironmentsTab({
  catalogEnvs,
  onCatalogChange,
}: {
  /** Shared catalog envs from parent — avoids a second discovery on tab open. */
  catalogEnvs?: any[];
  onCatalogChange?: (opts?: { notify?: boolean; ensureRows?: boolean; forceDiscover?: boolean }) => unknown;
}) {
  const [envs, setEnvs] = useState<any[]>(() =>
    Array.isArray(catalogEnvs) && catalogEnvs.length > 0 ? catalogEnvs : [],
  );
  const [discovered, setDiscovered] = useState<string[]>(() =>
    (catalogEnvs || []).map((e: any) => String(e?.name || '')).filter(Boolean),
  );
  const [loading, setLoading] = useState(!(catalogEnvs && catalogEnvs.length > 0));
  const [syncing, setSyncing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [formClasses, setFormClasses] = useState<string[]>([]);
  const [formParams, setFormParams] = useState<Array<{ key: string; val: string }>>([]);

  // Stay in sync when parent catalog finishes loading
  useEffect(() => {
    if (Array.isArray(catalogEnvs) && catalogEnvs.length > 0) {
      setEnvs(catalogEnvs);
      setDiscovered(catalogEnvs.map((e: any) => String(e?.name || '')).filter(Boolean));
      setLoading(false);
    }
  }, [catalogEnvs]);

  const load = useCallback(async (opts?: {
    notify?: boolean;
    ensureRows?: boolean;
    forceDiscover?: boolean;
  }) => {
    setLoading(true);
    try {
      const { envs: list, discovered: names } = await ensureEncEnvironments({
        notify: opts?.notify ?? false,
        ensureRows: opts?.ensureRows ?? false,
        forceDiscover: opts?.forceDiscover ?? false,
      });
      setDiscovered(names.length ? names : list.map((e: any) => String(e.name)).filter(Boolean));
      setEnvs(Array.isArray(list) && list.length > 0
        ? list
        : (names.length ? names : ['production']).map((name) => ({
            name, classes: {}, parameters: {}, description: '',
          })));
      await onCatalogChange?.({
        notify: false,
        ensureRows: false,
        forceDiscover: false,
      });
    } catch (e: any) {
      const fallback = [{ name: 'production', classes: {}, parameters: {}, description: '' }];
      setDiscovered(['production']);
      setEnvs(fallback);
      if (opts?.notify) {
        notifications.show({
          title: 'Environments load issue',
          message: e?.message || 'Could not fully sync; showing fallback',
          color: 'yellow',
        });
      }
    }
    setLoading(false);
  }, [onCatalogChange]);

  // Only fetch if parent catalog has not already populated us
  useEffect(() => {
    if (catalogEnvs && catalogEnvs.length > 0) return;
    void load({ ensureRows: false, notify: false });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- mount only

  const openEdit = (e: any) => {
    setEditing(e);
    setFormClasses(classDictToList(e.classes));
    setFormParams(dictToRows(e.parameters));
    setModalOpen(true);
  };
  const handleSave = async () => {
    if (!editing?.name) return;
    try {
      // Name is fixed from control_repo — only classes/parameters
      await enc.updateEnvironment(editing.name, {
        name: editing.name,
        description: editing.description || '',
        classes: classListToDict(formClasses),
        parameters: rowsToDict(formParams),
      });
      notifications.show({
        title: 'Updated',
        message: `Classes/parameters for environment '${editing.name}' saved`,
        color: 'green',
      });
      setModalOpen(false);
      void load({ ensureRows: false, notify: false });
    } catch (e: any) {
      notifications.show({ title: 'Error', message: e.message, color: 'red' });
    }
  };

  const handleResync = async () => {
    setSyncing(true);
    // Re-discover from compilers; drop ENC rows for pruned branches.
    await load({ notify: true, ensureRows: true, forceDiscover: true });
    setSyncing(false);
  };

  if (loading) return <LoadingState height={300} label="Loading environments…" />;

  return (
    <Stack>
      <Group justify="space-between" align="flex-start">
        <Alert variant="light" color="blue" style={{ flex: 1 }} mb={0}>
          Environments are determined by the <strong>control_repo Git branches</strong>, and are
          <strong> not editable here</strong>. You can only apply <strong>classes</strong> and
          <strong> parameters</strong> at the environment level.
          {envs.length > 0 && (
            <>
              {' '}Currently listing <strong>{envs.length}</strong> environment
              {envs.length === 1 ? '' : 's'} from the control_repo.
            </>
          )}
        </Alert>
        <Button
          variant="light"
          leftSection={<IconRefresh size={16} />}
          loading={syncing}
          onClick={handleResync}
        >
          Refresh list
        </Button>
      </Group>
      <Card withBorder shadow="sm">
        {/* mah (not h=100% inside maxHeight-only Box) — avoids zero-height collapse */}
        <ScrollArea.Autosize mah={500} type="auto" offsetScrollbars scrollbarSize={6}>
          <Table striped highlightOnHover>
            <Table.Thead><Table.Tr>
              <Table.Th>Environment</Table.Th>
              <Table.Th>Classes</Table.Th>
              <Table.Th>Parameters</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Actions</Table.Th>
            </Table.Tr></Table.Thead>
            <Table.Tbody>
              {envs.map((e) => (
                <Table.Tr key={e.name || e.id || JSON.stringify(e)}>
                  <Table.Td><Badge color="blue" size="lg">{e.name}</Badge></Table.Td>
                  <Table.Td><ClassBadges classes={e.classes || {}} color="blue" /></Table.Td>
                  <Table.Td><ParamBadges params={e.parameters || {}} color="cyan" /></Table.Td>
                  <Table.Td>
                    <Group gap="xs" justify="flex-end">
                      <Tooltip label="Apply classes and parameters">
                        <ActionIcon variant="subtle" color="blue" onClick={() => openEdit(e)}>
                          <IconPencil size={16} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
              {envs.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={4}>
                    <Text c="dimmed" ta="center" py="lg">
                      No environments available yet. Deploy control_repo branches to the compilers,
                      then click Refresh list.
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </ScrollArea.Autosize>
      </Card>
      <Modal
        opened={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Environment level — ${editing.name}` : 'Environment'}
        size="lg"
      >
        <Stack>
          <TextInput
            label="Environment"
            value={editing?.name || ''}
            disabled
            description="Set by control_repo branch — not editable here."
          />
          <ClassPicker
            value={formClasses}
            onChange={setFormClasses}
            environment={editing?.name || 'production'}
            label="Classes"
            description="Applied to all nodes in this environment"
          />
          <ParamEditor
            value={formParams}
            onChange={setFormParams}
            label="Parameters"
            description="Applied to all nodes in this environment"
          />
          <Button onClick={handleSave}>Save</Button>
        </Stack>
      </Modal>
    </Stack>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TAB 3: NODE GROUPS
   ═══════════════════════════════════════════════════════════════ */
type CatalogRefresh = (opts?: {
  notify?: boolean;
  ensureRows?: boolean;
  forceDiscover?: boolean;
}) => Promise<EncCatalog>;

function GroupsTab({
  groups,
  envs,
  refreshCatalog,
}: {
  groups: any[];
  envs: any[];
  refreshCatalog: CatalogRefresh;
}) {
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [formName, setFormName] = useState('');
  const [formEnv, setFormEnv] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formClasses, setFormClasses] = useState<string[]>([]);
  const [formParams, setFormParams] = useState<Array<{ key: string; val: string }>>([]);
  const [pendingDeleteGroup, setPendingDeleteGroup] = useState<null | { id: number; name: string }>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    await refreshCatalog();
    setLoading(false);
  }, [refreshCatalog]);

  const openCreate = () => {
    setEditing(null);
    setFormName(''); setFormEnv(envs[0]?.name || 'production'); setFormDesc('');
    setFormClasses([]); setFormParams([]);
    setModalOpen(true);
  };
  const openEdit = (g: any) => {
    setEditing(g);
    setFormName(g.name); setFormEnv(g.environment); setFormDesc(g.description || '');
    setFormClasses(classDictToList(g.classes));
    setFormParams(dictToRows(g.parameters));
    setModalOpen(true);
  };
  const handleSave = async () => {
    try {
      const payload = { name: formName, environment: formEnv, description: formDesc,
        classes: classListToDict(formClasses), parameters: rowsToDict(formParams) };
      if (editing) {
        await enc.updateGroup(editing.id, payload);
        notifications.show({ title: 'Updated', message: `Group '${formName}' updated`, color: 'green' });
      } else {
        await enc.createGroup(payload);
        notifications.show({ title: 'Created', message: `Group '${formName}' created`, color: 'green' });
      }
      setModalOpen(false);
      await refreshCatalog();
    } catch (e: any) { notifications.show({ title: 'Error', message: e.message, color: 'red' }); }
  };
  const handleDelete = async (id: number, name: string) => {
    setDeleteLoading(true);
    try {
      await enc.deleteGroup(id);
      notifications.show({ title: 'Deleted', message: `'${name}' removed`, color: 'green' });
      setPendingDeleteGroup(null);
      await refreshCatalog();
    } catch (e: any) {
      notifications.show({ title: 'Error', message: e.message, color: 'red' });
    }
    setDeleteLoading(false);
  };

  if (loading && groups.length === 0) return <LoadingState height={300} label="Loading groups…" />;

  return (
    <Stack>
      <Group justify="flex-end">
        <Button variant="default" leftSection={<IconRefresh size={16} />} onClick={() => void load()} loading={loading}>
          Refresh
        </Button>
        <Button leftSection={<IconPlus size={16} />} onClick={openCreate} disabled={envs.length === 0}>Create Group</Button>
      </Group>
      {envs.length === 0 && <Alert color="yellow">Create at least one environment before adding groups.</Alert>}
      <Alert variant="light" color="blue" mb="xs">
        Groups are logical collections of nodes (webservers, databases, etc.) within an environment.
        Classes and parameters set here apply to every node in the group.
      </Alert>
      <Card withBorder shadow="sm">
        <Box style={{ maxHeight: 500, minHeight: 200, overflow: 'hidden' }}>
          <ScrollArea h={500} type="auto" offsetScrollbars scrollbarSize={6}>
            <Table striped highlightOnHover>
              <Table.Thead><Table.Tr>
                <Table.Th>Group</Table.Th><Table.Th>Environment</Table.Th><Table.Th>Description</Table.Th>
                <Table.Th>Classes</Table.Th><Table.Th>Parameters</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Actions</Table.Th>
              </Table.Tr></Table.Thead>
              <Table.Tbody>
            {groups.map((g) => (
              <Table.Tr key={g.id}>
                <Table.Td><Text fw={500}>{g.name}</Text></Table.Td>
                <Table.Td><Badge variant="outline" size="sm">{g.environment}</Badge></Table.Td>
                <Table.Td><Text size="sm">{g.description || '\u2014'}</Text></Table.Td>
                <Table.Td><ClassBadges classes={g.classes} color="orange" /></Table.Td>
                <Table.Td><ParamBadges params={g.parameters} color="yellow" /></Table.Td>
                <Table.Td>
                  <Group gap="xs" justify="flex-end">
                    <Tooltip label="Edit"><ActionIcon variant="subtle" color="blue" onClick={() => openEdit(g)}><IconPencil size={16} /></ActionIcon></Tooltip>
                    <Tooltip label="Delete"><ActionIcon variant="subtle" color="red" onClick={() => setPendingDeleteGroup({ id: g.id, name: g.name })}><IconTrash size={16} /></ActionIcon></Tooltip>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
            {groups.length === 0 && <Table.Tr><Table.Td colSpan={6}><Text c="dimmed" ta="center" py="lg">No groups defined yet</Text></Table.Td></Table.Tr>}
          </Table.Tbody>
        </Table>
        </ScrollArea>
      </Box>
      </Card>
      <Modal opened={modalOpen} onClose={() => setModalOpen(false)}
        title={editing ? `Edit Group \u2014 ${editing.name}` : 'Create Group'} size="lg">
        <Stack>
          <TextInput label="Name" required value={formName}
            onChange={(e) => setFormName(e.currentTarget.value)} placeholder="e.g. webservers, databases" />
          <Select label="Environment" required data={envs.map((e) => ({ value: e.name, label: e.name }))}
            value={formEnv} onChange={(v) => { setFormEnv(v || ''); setFormClasses([]); }} />
          <TextInput label="Description" value={formDesc}
            onChange={(e) => setFormDesc(e.currentTarget.value)} />
          <ClassPicker value={formClasses} onChange={setFormClasses} environment={formEnv}
            label="Group Classes" description="Classes applied to all nodes in this group" />
          <ParamEditor value={formParams} onChange={setFormParams}
            label="Group Parameters" description="Parameters applied to all nodes in this group" />
          <Button onClick={handleSave}>{editing ? 'Update' : 'Create'}</Button>
        </Stack>
      </Modal>
      <ConfirmModal
        opened={!!pendingDeleteGroup}
        onClose={() => !deleteLoading && setPendingDeleteGroup(null)}
        onConfirm={() => pendingDeleteGroup && handleDelete(pendingDeleteGroup.id, pendingDeleteGroup.name)}
        title="Delete group?"
        body={`Delete group '${pendingDeleteGroup?.name}'?`}
        details={pendingDeleteGroup ? [pendingDeleteGroup.name] : undefined}
        confirmLabel="Delete"
        danger
        loading={deleteLoading}
      />
    </Stack>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TAB 4: NODES
   ═══════════════════════════════════════════════════════════════ */
function NodesTab({
  groups,
  envs,
  refreshCatalog,
}: {
  groups: any[];
  envs: any[];
  refreshCatalog: CatalogRefresh;
}) {
  const { data: classifiedRows, loading, refetch: load } = useApi(
    () => enc.listNodes(),
    [],
    {
      cacheKey: CACHE_ENC_NODES,
      cacheValidate: (rows) => Array.isArray(rows),
    },
  );
  const { data: commonData } = useApi(
    () => enc.getCommon().catch(() => null),
    [],
    { cacheKey: CACHE_ENC_COMMON },
  );
  const { data: fleet } = useApi(
    () => nodesApi.list().catch(() => [] as any[]),
    [],
    {
      cacheKey: CACHE_NODES,
      cacheValidate: (rows) => Array.isArray(rows),
    },
  );
  const classified = Array.isArray(classifiedRows) ? classifiedRows : [];
  const puppetNodes = (Array.isArray(fleet) ? fleet : [])
    .map((x: any) => x.certname)
    .filter(Boolean)
    .sort();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [formCert, setFormCert] = useState('');
  const [formEnv, setFormEnv] = useState('');
  const [formGroupIds, setFormGroupIds] = useState<string[]>([]);
  const [formClasses, setFormClasses] = useState<string[]>([]);
  const [formParams, setFormParams] = useState<Array<{ key: string; val: string }>>([]);
  const [pendingDeleteNode, setPendingDeleteNode] = useState<string | null>(null);
  const [pendingDismissNode, setPendingDismissNode] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const openCreate = async (prefillCert?: string) => {
    // Lightweight refresh only when opening the modal (groups may have changed)
    const cat = await refreshCatalog({ ensureRows: false });
    setEditing(null);
    setFormCert(prefillCert || '');
    setFormEnv(cat.envs[0]?.name || envs[0]?.name || 'production');
    setFormGroupIds([]); setFormClasses([]); setFormParams([]);
    setModalOpen(true);
  };
  const openEdit = async (n: any) => {
    const cat = await refreshCatalog({ ensureRows: false });
    setEditing(n);
    setFormCert(n.certname); setFormEnv(n.environment);
    setFormGroupIds(
      cat.groups
        .filter((g) => (n.groups || []).includes(g.name))
        .map((g) => String(g.id)),
    );
    setFormClasses(classDictToList(n.classes));
    setFormParams(dictToRows(n.parameters));
    setModalOpen(true);
  };
  const handleSave = async () => {
    try {
      const payload = { certname: formCert, environment: formEnv,
        classes: classListToDict(formClasses), parameters: rowsToDict(formParams),
        group_ids: formGroupIds.map(Number) };
      const already = classified.some((n) => n.certname === formCert);
      if (editing || already) {
        await enc.updateNode(editing?.certname || formCert, payload);
        notifications.show({ title: 'Updated', message: `Node '${formCert}' updated`, color: 'green' });
      } else {
        try {
          await enc.createNode(payload);
          notifications.show({ title: 'Created', message: `Node '${formCert}' classified`, color: 'green' });
        } catch (e: any) {
          const msg = String(e?.message || e);
          if (/duplicate key|UniqueViolation|already exists/i.test(msg)) {
            await enc.updateNode(formCert, payload);
            notifications.show({ title: 'Updated', message: `Node '${formCert}' updated`, color: 'green' });
          } else {
            throw e;
          }
        }
      }
      setModalOpen(false); load();
    } catch (e: any) { notifications.show({ title: 'Error', message: e.message, color: 'red' }); }
  };
  const handleDelete = async (certname: string) => {
    setDeleteLoading(true);
    try {
      await enc.deleteNode(certname);
      notifications.show({ title: 'Removed', message: `'${certname}' removed`, color: 'green' });
      setPendingDeleteNode(null);
      load();
    } catch (e: any) {
      notifications.show({ title: 'Error', message: e.message, color: 'red' });
    }
    setDeleteLoading(false);
  };

  const handleDismissGhost = async (certname: string) => {
    setDeleteLoading(true);
    try {
      await nodesApi.dismiss(certname);
      notifications.show({
        title: 'Removed',
        message: `'${certname}' hidden from Unclassified (ghost).`,
        color: 'green',
      });
      setPendingDismissNode(null);
      load();
    } catch (e: any) {
      notifications.show({ title: 'Error', message: e.message, color: 'red' });
    }
    setDeleteLoading(false);
  };

  // Compute the full set of classes that will apply to this node
  // (Common + Environment + Groups + Node overrides). Used to show
  // what is already being applied from other layers.
  const getEffectiveClasses = (n: any): string[] => {
    const eff = new Set<string>();
    // Common
    if (commonData?.classes) {
      Object.keys(commonData.classes).forEach((k: string) => eff.add(k));
    }
    // Environment
    const env = envs.find((ee: any) => ee.name === n.environment);
    if (env?.classes) {
      Object.keys(env.classes).forEach((k: string) => eff.add(k));
    }
    // Groups the node is in
    (n.groups || []).forEach((gname: string) => {
      const grp = groups.find((gg: any) => gg.name === gname);
      if (grp?.classes) {
        Object.keys(grp.classes).forEach((k: string) => eff.add(k));
      }
    });
    // Direct node overrides
    if (n.classes) {
      Object.keys(n.classes).forEach((k: string) => eff.add(k));
    }
    return Array.from(eff).sort();
  };

  // For the edit/create modal: classes coming from the *current form selections*
  // (environment + chosen groups + common), excluding the "Node-specific" ones
  // the user is about to add. Lets you see conflicts before saving.
  const getInheritedClassesFromForm = (): string[] => {
    const eff = new Set<string>();
    if (commonData?.classes) {
      Object.keys(commonData.classes).forEach((k: string) => eff.add(k));
    }
    const env = envs.find((ee: any) => ee.name === formEnv);
    if (env?.classes) {
      Object.keys(env.classes).forEach((k: string) => eff.add(k));
    }
    formGroupIds.forEach((gid: string) => {
      const g = groups.find((gg: any) => String(gg.id) === gid);
      if (g?.classes) {
        Object.keys(g.classes).forEach((k: string) => eff.add(k));
      }
    });
    return Array.from(eff).sort();
  };

  // We now keep *all* nodes that have ever been classified in the ENC.
  // They are only removed by explicit delete or purge-stale (human action).
  // A normal puppet run on the OpenVox server should not cause them to
  // disappear or be auto-purged.
  //
  // We still compute "unclassified" from the *current* live fleet
  // (puppetNodes) minus those in ENC.
  //
  // Nodes in ENC that are no longer in the live fleet are "stale" but
  // remain visible so the operator can review/purge deliberately.
  const puppetSet = new Set(puppetNodes.map((cn) => cn.toLowerCase()));

  const activeClassified = classified;  // all classified are shown

  const classifiedNames = new Set(
    classified.map((n) => (n.certname || '').toLowerCase())
  );
  const unclassified = puppetNodes.filter(
    (cn) => cn && !classifiedNames.has(cn.toLowerCase())
  );

  // Stale = in ENC but not in current live fleet (for awareness, not auto-hide)
  const staleClassified = classified.filter((n) => {
    const key = (n.certname || '').toLowerCase();
    return key && !puppetSet.has(key);
  });

  if (loading && classified.length === 0) return <Center h={300}><Loader size="xl" /></Center>;

  return (
    <Stack>
      <Group justify="flex-end">
        <Button leftSection={<IconPlus size={16} />} onClick={() => openCreate()} disabled={envs.length === 0}>Classify Node</Button>
      </Group>
      {envs.length === 0 && <Alert color="yellow">Create at least one environment before classifying nodes.</Alert>}
      <Alert variant="light" color="blue" mb="xs">
        Each node is a "container" that inherits classification from Common → Environment → Groups,
        with its own overrides at the highest priority.
      </Alert>
      <Card withBorder shadow="sm">
        <Text fw={700} mb="sm">Unclassified Nodes ({unclassified.length})</Text>
        {unclassified.length > 0 ? (
          <>
            <Text size="xs" c="dimmed" mb="sm">
              On the live fleet but not yet classified. Click the name to classify.
              Use the X to remove a ghost (host gone, still listed in PuppetDB).
            </Text>
            <Group gap="xs" wrap="wrap">
              {unclassified.map((cn) => (
                <Badge
                  key={cn}
                  variant="outline"
                  color="gray"
                  size="sm"
                  pr={4}
                  rightSection={
                    <ActionIcon
                      size="xs"
                      color="red"
                      variant="transparent"
                      aria-label={`Remove ghost ${cn}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingDismissNode(cn);
                      }}
                    >
                      <IconX size={10} />
                    </ActionIcon>
                  }
                  style={{ cursor: 'pointer' }}
                  onClick={() => openCreate(cn)}
                >
                  {cn}
                </Badge>
              ))}
            </Group>
          </>
        ) : (
          <Text size="sm" c="dimmed">All live-fleet nodes are classified.</Text>
        )}
      </Card>
      <Card withBorder shadow="sm" padding="lg">
        <Text fw={700} mb="sm">Classified Nodes</Text>
        <ScrollArea h={800} type="auto" offsetScrollbars scrollbarSize={6}>
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead><Table.Tr>
              <Table.Th>Certname</Table.Th><Table.Th>Environment</Table.Th><Table.Th>Groups</Table.Th>
              <Table.Th>Effective Classes (all layers)</Table.Th><Table.Th>Node Overrides (params)</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Actions</Table.Th>
            </Table.Tr></Table.Thead>
            <Table.Tbody>
              {activeClassified.map((n) => (
                <Table.Tr key={n.certname}>
                  <Table.Td><Text fw={500} size="sm">{n.certname}</Text></Table.Td>
                  <Table.Td><Badge variant="outline" size="sm">{n.environment}</Badge></Table.Td>
                  <Table.Td>
                    <Group gap={4}>{(n.groups || []).map((g: string) => <Badge key={g} variant="light" color="orange" size="sm">{g}</Badge>)}
                    {(!n.groups || n.groups.length === 0) && <Text size="sm" c="dimmed">—</Text>}</Group>
                  </Table.Td>
                  <Table.Td>
                    <ClassBadges classes={Object.fromEntries(getEffectiveClasses(n).map((c: string) => [c, {}]))} color="grape" />
                    <Text size="xs" c="dimmed" mt={2}>effective (all layers)</Text>
                    {n.classes && Object.keys(n.classes).length > 0 && (
                      <Text size="xs" mt={1}>
                        direct on node: <ClassBadges classes={n.classes} color="red" />
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td><ParamBadges params={n.parameters} color="pink" /></Table.Td>
                  <Table.Td>
                    <Group gap="xs" justify="flex-end">
                      <Tooltip label="Edit"><ActionIcon variant="subtle" color="blue" onClick={() => openEdit(n)}><IconPencil size={16} /></ActionIcon></Tooltip>
                      <Tooltip label="Remove"><ActionIcon variant="subtle" color="red" onClick={() => setPendingDeleteNode(n.certname)}><IconTrash size={16} /></ActionIcon></Tooltip>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
              {activeClassified.length === 0 && <Table.Tr><Table.Td colSpan={6}><Text c="dimmed" ta="center" py="lg">No nodes classified yet</Text></Table.Td></Table.Tr>}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Card>
      <Modal opened={modalOpen} onClose={() => setModalOpen(false)}
        title={editing ? `Edit Node \u2014 ${editing.certname}` : 'Classify Node'} size="lg">
        <Stack>
          {!editing ? (
            <Select label="Certname" required searchable
              data={puppetNodes.map((cn) => ({ value: cn, label: cn }))}
              value={formCert} onChange={(v) => setFormCert(v || '')}
              placeholder="Select a node" />
          ) : (
            <TextInput label="Certname" value={formCert} disabled />
          )}
          <Select
            label="Environment"
            required
            data={
              envs.length > 0
                ? envs.map((e) => ({ value: e.name, label: e.name }))
                : [{ value: 'production', label: 'production' }]
            }
            value={formEnv || 'production'}
            onChange={(v) => setFormEnv(v || 'production')}
            description={
              envs.length === 0
                ? 'No environments in ENC yet — production will be created on save if needed'
                : undefined
            }
          />
          <MultiSelect
            label="Groups"
            clearable
            searchable
            data={groupMultiSelectData(groups, formEnv || undefined)}
            value={formGroupIds}
            onChange={setFormGroupIds}
            onDropdownOpen={() => { void refreshCatalog(); }}
            description={
              groups.length === 0
                ? 'No groups yet — create them under Node Groups, then reopen this form.'
                : `All ENC groups (${groups.length}). Prefer groups in the selected environment (${formEnv || '—'}).`
            }
            placeholder={groups.length === 0 ? 'No groups defined' : 'Select groups'}
            nothingFoundMessage="No groups match"
          />
          <ClassPicker value={formClasses} onChange={setFormClasses} environment={formEnv}
            label="Node-specific Classes" description="Override or add classes (highest priority)" />
          <ParamEditor value={formParams} onChange={setFormParams}
            label="Node-specific Parameters" description="Override or add parameters (highest priority)" />

          {/* Live preview of inherited classes while choosing groups/environment.
              Helps detect if profiles::base (or any class) is already coming from
              a higher layer before you save. */}
          {(formGroupIds.length > 0 || formEnv) && (
            <Alert color="blue" variant="light" p="xs">
              <Text size="xs" fw={500} mb={2}>Inherited from Environment + selected Group(s) + Common:</Text>
              <Group gap={4} wrap="wrap">
                {getInheritedClassesFromForm().map((c: string) => (
                  <Badge key={c} size="xs" variant="light" color="blue">{c}</Badge>
                ))}
                {getInheritedClassesFromForm().length === 0 && <Text size="xs" c="dimmed">none</Text>}
              </Group>
              <Text size="xs" c="dimmed" mt={4}>
                Any node-specific classes you add above will take highest priority and can override.
              </Text>
            </Alert>
          )}

          <Button onClick={handleSave}>{editing ? 'Update' : 'Classify'}</Button>
        </Stack>
      </Modal>
      <ConfirmModal
        opened={!!pendingDeleteNode}
        onClose={() => !deleteLoading && setPendingDeleteNode(null)}
        onConfirm={() => pendingDeleteNode && handleDelete(pendingDeleteNode)}
        title="Remove classification?"
        body={`Remove classification for '${pendingDeleteNode}'?`}
        details={pendingDeleteNode ? [pendingDeleteNode] : undefined}
        confirmLabel="Remove"
        danger
        loading={deleteLoading}
      />
      <ConfirmModal
        opened={!!pendingDismissNode}
        onClose={() => !deleteLoading && setPendingDismissNode(null)}
        onConfirm={() => pendingDismissNode && handleDismissGhost(pendingDismissNode)}
        title="Remove ghost node?"
        body={`Hide '${pendingDismissNode}' from Unclassified and the live fleet lists. Use this when the host is gone but PuppetDB still lists it. Classification is also removed if present.`}
        details={pendingDismissNode ? [pendingDismissNode] : undefined}
        confirmLabel="Remove ghost"
        danger
        loading={deleteLoading}
      />
    </Stack>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TAB 5: CLASSIFICATION LOOKUP
   ═══════════════════════════════════════════════════════════════ */
function LookupTab() {
  const [certname, setCertname] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data: fleet } = useApi(
    () => nodesApi.list().catch(() => [] as any[]),
    [],
    {
      cacheKey: CACHE_NODES,
      cacheValidate: (rows) => Array.isArray(rows),
    },
  );
  const puppetNodes = (Array.isArray(fleet) ? fleet : [])
    .map((n: any) => n.certname)
    .filter(Boolean)
    .sort();

  const handleLookup = async () => {
    if (!certname) return;
    setLoading(true); setError(null); setResult(null);
    try { setResult(await enc.classify(certname)); }
    catch (e: any) { setError(e.message); }
    setLoading(false);
  };

  return (
    <Stack>
      <Alert variant="light" color="blue" mb="xs">
        Preview the final merged classification for any node — the deep-merged result of
        Common → Environment → Groups → Node overrides.
      </Alert>
      <Card withBorder shadow="sm">
        <Group align="flex-end">
          <Select label="Node Certname" searchable clearable
            data={puppetNodes.map((cn) => ({ value: cn, label: cn }))}
            value={certname} onChange={(v) => { setCertname(v || ''); setResult(null); }}
            placeholder="Select a node" style={{ flex: 1 }} />
          <Button onClick={handleLookup} loading={loading} leftSection={<IconSearch size={16} />} disabled={!certname}>
            Resolve
          </Button>
        </Group>
      </Card>
      {error && <Alert color="red" title="Error">{error}</Alert>}
      {result && (
        <Card withBorder shadow="sm">
          <Text fw={700} mb="sm">Resolved Classification for <Code>{certname}</Code></Text>
          <Grid>
            <Grid.Col span={{ base: 12, md: 4 }}>
              <Paper p="md" withBorder>
                <Text fw={600} size="sm" mb="xs">Environment</Text>
                <Badge size="lg" color="blue">{result.environment}</Badge>
              </Paper>
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 4 }}>
              <Paper p="md" withBorder>
                <Text fw={600} size="sm" mb="xs">Classes ({Object.keys(result.classes || {}).length})</Text>
                <Stack gap={4}>
                  {Object.entries(result.classes || {}).map(([cls, params]: [string, any]) => (
                    <div key={cls}>
                      <Badge color="grape" variant="light">{cls}</Badge>
                      {params && Object.keys(params).length > 0 && (
                        <Box mt={2}>
                          <PrettyJson data={params} maxHeight={150} />
                        </Box>
                      )}
                    </div>
                  ))}
                  {Object.keys(result.classes || {}).length === 0 && <Text size="sm" c="dimmed">No classes</Text>}
                </Stack>
              </Paper>
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 4 }}>
              <Paper p="md" withBorder>
                <Text fw={600} size="sm" mb="xs">Parameters ({Object.keys(result.parameters || {}).length})</Text>
                {Object.keys(result.parameters || {}).length > 0 ? (
                  <PrettyJson data={result.parameters} maxHeight={200} />
                ) : <Text size="sm" c="dimmed">No parameters</Text>}
              </Paper>
            </Grid.Col>
          </Grid>
          <Divider my="md" />
          <Text fw={600} size="sm" mb="xs">YAML Output (OpenVox ENC format)</Text>
          <Code block style={{ fontSize: 12 }}>
            {`---\nenvironment: "${result.environment}"\nclasses:\n${Object.entries(result.classes || {}).map(([cls, params]: [string, any]) =>
              params && Object.keys(params).length > 0
                ? `  ${cls}:\n${Object.entries(params).map(([k, v]) => `    ${k}: ${JSON.stringify(v)}`).join('\n')}`
                : `  ${cls}: {}`
            ).join('\n') || '  {}'}\nparameters:\n${Object.entries(result.parameters || {}).map(([k, v]) =>
              `  ${k}: ${JSON.stringify(v)}`
            ).join('\n') || '  {}'}`}
          </Code>
        </Card>
      )}
    </Stack>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TAB: COMMON DEFAULTS
   ═══════════════════════════════════════════════════════════════ */
function CommonTab() {
  const { data, loading, refetch: load } = useApi(
    () => enc.getCommon(),
    [],
    { cacheKey: CACHE_ENC_COMMON },
  );
  const [editing, setEditing] = useState(false);
  const [formClasses, setFormClasses] = useState<string[]>([]);
  const [formParams, setFormParams] = useState<Array<{ key: string; val: string }>>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) return;
    setFormClasses(classDictToList(data.classes));
    setFormParams(dictToRows(data.parameters));
  }, [data]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await enc.saveCommon({ classes: classListToDict(formClasses), parameters: rowsToDict(formParams) });
      notifications.show({ title: 'Saved', message: 'Common defaults updated', color: 'green' });
      setEditing(false); load();
    } catch (e: any) { notifications.show({ title: 'Error', message: e.message, color: 'red' }); }
    setSaving(false);
  };

  if (loading && !data) return <Center h={300}><Loader size="xl" /></Center>;

  return (
    <Stack>
      <Alert variant="light" color="blue" mb="xs">
        Common defaults are the foundation layer. Classes and parameters defined here apply
        to <strong>every node</strong>. Higher layers (Environment, Group, Node) can override them.
      </Alert>
      <Card withBorder shadow="sm">
        <Group justify="space-between" mb="md">
          <Text fw={700}>Global Common Defaults</Text>
          {!editing ? (
            <Button variant="light" size="xs" leftSection={<IconPencil size={14} />} onClick={() => setEditing(true)}>Edit</Button>
          ) : (
            <Group gap="xs">
              <Button variant="light" size="xs" color="gray" onClick={() => { setEditing(false); load(); }}>Cancel</Button>
              <Button size="xs" onClick={handleSave} loading={saving}>Save</Button>
            </Group>
          )}
        </Group>
        {!editing ? (
          <Grid>
            <Grid.Col span={6}>
              <Text fw={600} size="sm" mb="xs">Classes</Text>
              <ClassBadges classes={data?.classes || {}} color="green" />
            </Grid.Col>
            <Grid.Col span={6}>
              <Text fw={600} size="sm" mb="xs">Parameters</Text>
              <ParamBadges params={data?.parameters || {}} color="green" />
            </Grid.Col>
          </Grid>
        ) : (
          <Stack>
            <ClassPicker value={formClasses} onChange={setFormClasses}
              label="Common Classes" description="Classes applied to every node in the system" />
            <ParamEditor value={formParams} onChange={setFormParams}
              label="Common Parameters" description="Parameters applied to every node in the system" />
          </Stack>
        )}
      </Card>
    </Stack>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════════════════════ */
function InfrastructureGroupsHint() {
  const { data: cluster } = useApi(config.getCluster);
  if (!cluster || cluster.deployment_mode !== 'clustered') return null;
  return (
    <Alert variant="light" color="violet" title="Infrastructure node groups (clustered)">
      When clustered mode is enabled under Settings → Cluster, the ENC seeds{' '}
      <strong>Puppet Compiler</strong> and <strong>PuppetDB</strong> node groups (production)
      and attaches configured FQDNs. Use the Node Groups tab to review membership and classes.
      These groups segment compilers and OpenVoxDB hosts from the general fleet.
    </Alert>
  );
}

export function NodeClassifierPage() {
  const catalog = useEncCatalog();
  const [activeTab, setActiveTab] = useState<string | null>('nodes');

  // No catalog.refresh() on every tab change — that re-ran compiler env discovery
  // and made Classification feel frozen. Catalog loads once; modals refresh on demand.

  return (
    <Stack>
      <Group justify="space-between" align="center">
        <Title order={2}>Classification</Title>
        {!catalog.ready && (
          <Group gap="xs">
            <Loader size="xs" />
            <Text size="sm" c="dimmed">Loading ENC catalog…</Text>
          </Group>
        )}
      </Group>
      <InfrastructureGroupsHint />
      <Tabs value={activeTab} onChange={setActiveTab} variant="outline" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="nodes" leftSection={<IconServer size={16} />}>Nodes</Tabs.Tab>
          <Tabs.Tab value="common" leftSection={<IconWorld size={16} />}>Common</Tabs.Tab>
          <Tabs.Tab value="environments" leftSection={<IconWorld size={16} />}>Environments</Tabs.Tab>
          <Tabs.Tab value="groups" leftSection={<IconTags size={16} />}>Node Groups</Tabs.Tab>
          <Tabs.Tab value="lookup" leftSection={<IconSearch size={16} />}>Classification Lookup</Tabs.Tab>
          <Tabs.Tab value="help" leftSection={<IconHelp size={16} />}>Help</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="nodes" pt="md">
          <NodesTab
            groups={catalog.groups}
            envs={catalog.envs}
            refreshCatalog={catalog.refresh}
          />
        </Tabs.Panel>
        <Tabs.Panel value="common" pt="md"><CommonTab /></Tabs.Panel>
        <Tabs.Panel value="environments" pt="md">
          <EnvironmentsTab
            catalogEnvs={catalog.envs}
            onCatalogChange={catalog.refresh}
          />
        </Tabs.Panel>
        <Tabs.Panel value="groups" pt="md">
          <GroupsTab
            groups={catalog.groups}
            envs={catalog.envs}
            refreshCatalog={catalog.refresh}
          />
        </Tabs.Panel>
        <Tabs.Panel value="lookup" pt="md"><LookupTab /></Tabs.Panel>
        <Tabs.Panel value="help" pt="md">
          <HierarchyTab reloadToken={catalog.groups.length + catalog.envs.length} />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
