import { useState, useCallback, useEffect } from 'react';
import {
  Title, Card, Table, Loader, Center, Alert, Stack, Group, Text, Tabs,
  Button, Modal, TextInput, Badge, ActionIcon, Tooltip, Code,
  Select, MultiSelect, Grid, ThemeIcon, Box, Divider, Paper,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconPlus, IconTrash, IconPencil, IconHierarchy2, IconTags,
  IconServer, IconWorld, IconSearch, IconLayersLinked, IconArrowDown, IconX, IconHelp,
} from '@tabler/icons-react';
import { enc, nodes as nodesApi, config } from '../services/api';
import { useAppTheme } from '../hooks/ThemeContext';

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
  const [available, setAvailable] = useState<any>({ roles: [], profiles: [], modules: [] });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    enc.getAvailableClasses(environment)
      .then((d) => { setAvailable(d); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, [environment]);

  const selectData = [
    ...(available.roles.length > 0 ? [{ group: 'Roles', items: available.roles.map((c: string) => ({ value: c, label: c })) }] : []),
    ...(available.profiles.length > 0 ? [{ group: 'Profiles', items: available.profiles.map((c: string) => ({ value: c, label: c })) }] : []),
    ...(available.modules.length > 0 ? [{ group: 'Modules', items: available.modules.map((c: string) => ({ value: c, label: c })) }] : []),
  ];

  return (
    <MultiSelect
      label={label}
      description={description}
      data={selectData}
      value={value}
      onChange={onChange}
      searchable
      clearable
      placeholder={loaded ? 'Search and select classes...' : 'Loading classes...'}
      nothingFoundMessage="No matching classes"
      maxDropdownHeight={300}
    />
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
function HierarchyTab() {
  const { isFormal } = useAppTheme();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await enc.getHierarchy()); } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Center h={300}><Loader size="xl" /></Center>;
  if (!data) return <Alert color="red">Failed to load hierarchy</Alert>;

  const layers = [
    { level: 4, label: 'Node', icon: IconServer, color: 'red',
      desc: 'Per-node overrides (highest priority)', count: data.nodes?.length || 0 },
    { level: 3, label: 'Group', icon: IconTags, color: 'orange',
      desc: 'Logical groupings — webservers, databases, etc.', count: data.groups?.length || 0 },
    { level: 2, label: 'Environment', icon: IconWorld, color: 'blue',
      desc: 'Environment-wide defaults — production, staging, dev', count: data.environments?.length || 0 },
    { level: 1, label: 'Common', icon: IconLayersLinked, color: 'green',
      desc: 'Global defaults applied to every node',
      count: (Object.keys(data.common?.classes || {}).length + Object.keys(data.common?.parameters || {}).length) > 0 ? 1 : 0 },
  ];

  return (
    <Stack>
      {!isFormal && (
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
            {(data.environments || []).map((e: any) => (
              <Paper key={e.name} p="xs" mb={4} withBorder>
                <Group justify="space-between">
                  <Badge color="blue">{e.name}</Badge>
                  <ClassBadges classes={e.classes || {}} color="blue" />
                </Group>
              </Paper>
            ))}
            {(data.environments || []).length === 0 && <Text size="sm" c="dimmed">No environments defined yet</Text>}
            <Divider my="sm" />

            <Text fw={600} size="sm" mb={4}>Groups ({data.groups?.length || 0})</Text>
            {(data.groups || []).map((g: any) => (
              <Paper key={g.id} p="xs" mb={4} withBorder>
                <Group justify="space-between">
                  <Group gap="xs"><Badge color="orange">{g.name}</Badge><Badge variant="outline" size="xs">{g.environment}</Badge></Group>
                  <ClassBadges classes={g.classes || {}} color="orange" />
                </Group>
              </Paper>
            ))}
            {(data.groups || []).length === 0 && <Text size="sm" c="dimmed">No groups defined yet</Text>}
            <Divider my="sm" />

            <Text fw={600} size="sm" mb={4}>Classified Nodes ({data.nodes?.length || 0})</Text>
            {(data.nodes || []).map((n: any) => (
              <Paper key={n.certname} p="xs" mb={4} withBorder>
                <Group justify="space-between">
                  <Group gap="xs">
                    <Text size="sm" fw={500}>{n.certname}</Text>
                    <Badge variant="outline" size="xs">{n.environment}</Badge>
                    {(n.groups || []).map((g: string) => <Badge key={g} variant="light" color="orange" size="xs">{g}</Badge>)}
                  </Group>
                  <ClassBadges classes={n.classes || {}} color="red" />
                </Group>
              </Paper>
            ))}
            {(data.nodes || []).length === 0 && <Text size="sm" c="dimmed">No nodes classified yet</Text>}
          </Card>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TAB 2: ENVIRONMENTS
   ═══════════════════════════════════════════════════════════════ */
function EnvironmentsTab() {
  const [envs, setEnvs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formClasses, setFormClasses] = useState<string[]>([]);
  const [formParams, setFormParams] = useState<Array<{ key: string; val: string }>>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [encEnvs, puppetResp] = await Promise.all([
        enc.listEnvironments(),
        config.getEnvironments().catch(() => ({ environments: [] })),
      ]);
      const puppetNames: string[] = puppetResp.environments || [];
      const encNames = new Set(encEnvs.map((e: any) => e.name));
      const missing = puppetNames.filter((n: string) => !encNames.has(n));
      for (const name of missing) {
        await enc.createEnvironment({ name, description: 'Puppet environment (auto-discovered)', classes: {}, parameters: {} });
      }
      if (missing.length > 0) {
        setEnvs(await enc.listEnvironments());
        notifications.show({ title: 'Environments Synced', message: `Added ${missing.length} from Puppet: ${missing.join(', ')}`, color: 'blue' });
      } else {
        setEnvs(encEnvs);
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    setFormName(''); setFormDesc(''); setFormClasses([]); setFormParams([]);
    setModalOpen(true);
  };
  const openEdit = (e: any) => {
    setEditing(e);
    setFormName(e.name); setFormDesc(e.description || '');
    setFormClasses(classDictToList(e.classes));
    setFormParams(dictToRows(e.parameters));
    setModalOpen(true);
  };
  const handleSave = async () => {
    try {
      const payload = { name: formName, description: formDesc,
        classes: classListToDict(formClasses), parameters: rowsToDict(formParams) };
      if (editing) {
        await enc.updateEnvironment(editing.name, payload);
        notifications.show({ title: 'Updated', message: `Environment '${formName}' updated`, color: 'green' });
      } else {
        await enc.createEnvironment(payload);
        notifications.show({ title: 'Created', message: `Environment '${formName}' created`, color: 'green' });
      }
      setModalOpen(false); load();
    } catch (e: any) { notifications.show({ title: 'Error', message: e.message, color: 'red' }); }
  };
  const handleDelete = async (name: string) => {
    if (!confirm(`Delete environment '${name}'?`)) return;
    try { await enc.deleteEnvironment(name); notifications.show({ title: 'Deleted', message: `'${name}' removed`, color: 'green' }); load(); }
    catch (e: any) { notifications.show({ title: 'Error', message: e.message, color: 'red' }); }
  };

  if (loading) return <Center h={300}><Loader size="xl" /></Center>;

  return (
    <Stack>
      <Group justify="flex-end">
        <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>Add Environment</Button>
      </Group>
      <Alert variant="light" color="blue" mb="xs">
        Environments are auto-discovered from <Code>/etc/puppetlabs/code/environments/</Code>.
        Classes and parameters set here apply to every node in this environment.
      </Alert>
      <Card withBorder shadow="sm">
        <Table striped highlightOnHover>
          <Table.Thead><Table.Tr>
            <Table.Th>Environment</Table.Th><Table.Th>Description</Table.Th>
            <Table.Th>Classes</Table.Th><Table.Th>Parameters</Table.Th>
            <Table.Th style={{ textAlign: 'right' }}>Actions</Table.Th>
          </Table.Tr></Table.Thead>
          <Table.Tbody>
            {envs.map((e) => (
              <Table.Tr key={e.name}>
                <Table.Td><Badge color="blue" size="lg">{e.name}</Badge></Table.Td>
                <Table.Td><Text size="sm">{e.description || '\u2014'}</Text></Table.Td>
                <Table.Td><ClassBadges classes={e.classes} color="blue" /></Table.Td>
                <Table.Td><ParamBadges params={e.parameters} color="cyan" /></Table.Td>
                <Table.Td>
                  <Group gap="xs" justify="flex-end">
                    <Tooltip label="Edit"><ActionIcon variant="subtle" color="blue" onClick={() => openEdit(e)}><IconPencil size={16} /></ActionIcon></Tooltip>
                    <Tooltip label="Delete"><ActionIcon variant="subtle" color="red" onClick={() => handleDelete(e.name)}><IconTrash size={16} /></ActionIcon></Tooltip>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
            {envs.length === 0 && <Table.Tr><Table.Td colSpan={5}><Text c="dimmed" ta="center" py="lg">No environments defined</Text></Table.Td></Table.Tr>}
          </Table.Tbody>
        </Table>
      </Card>
      <Modal opened={modalOpen} onClose={() => setModalOpen(false)}
        title={editing ? `Edit Environment \u2014 ${editing.name}` : 'Add Environment'} size="lg">
        <Stack>
          <TextInput label="Name" required value={formName} disabled={!!editing}
            onChange={(e) => setFormName(e.currentTarget.value)} placeholder="e.g. production, staging" />
          <TextInput label="Description" value={formDesc}
            onChange={(e) => setFormDesc(e.currentTarget.value)} />
          <ClassPicker value={formClasses} onChange={setFormClasses} environment={formName || 'production'}
            label="Environment Classes" description="Classes applied to all nodes in this environment" />
          <ParamEditor value={formParams} onChange={setFormParams}
            label="Environment Parameters" description="Parameters applied to all nodes in this environment" />
          <Button onClick={handleSave}>{editing ? 'Update' : 'Create'}</Button>
        </Stack>
      </Modal>
    </Stack>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TAB 3: NODE GROUPS
   ═══════════════════════════════════════════════════════════════ */
function GroupsTab() {
  const [groups, setGroups] = useState<any[]>([]);
  const [envs, setEnvs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [formName, setFormName] = useState('');
  const [formEnv, setFormEnv] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formClasses, setFormClasses] = useState<string[]>([]);
  const [formParams, setFormParams] = useState<Array<{ key: string; val: string }>>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [g, e] = await Promise.all([enc.listGroups(), enc.listEnvironments()]);
      setGroups(g); setEnvs(e);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

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
      setModalOpen(false); load();
    } catch (e: any) { notifications.show({ title: 'Error', message: e.message, color: 'red' }); }
  };
  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Delete group '${name}'?`)) return;
    try { await enc.deleteGroup(id); notifications.show({ title: 'Deleted', message: `'${name}' removed`, color: 'green' }); load(); }
    catch (e: any) { notifications.show({ title: 'Error', message: e.message, color: 'red' }); }
  };

  if (loading) return <Center h={300}><Loader size="xl" /></Center>;

  return (
    <Stack>
      <Group justify="flex-end">
        <Button leftSection={<IconPlus size={16} />} onClick={openCreate} disabled={envs.length === 0}>Create Group</Button>
      </Group>
      {envs.length === 0 && <Alert color="yellow">Create at least one environment before adding groups.</Alert>}
      <Alert variant="light" color="blue" mb="xs">
        Groups are logical collections of nodes (webservers, databases, etc.) within an environment.
        Classes and parameters set here apply to every node in the group.
      </Alert>
      <Card withBorder shadow="sm">
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
                    <Tooltip label="Delete"><ActionIcon variant="subtle" color="red" onClick={() => handleDelete(g.id, g.name)}><IconTrash size={16} /></ActionIcon></Tooltip>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
            {groups.length === 0 && <Table.Tr><Table.Td colSpan={6}><Text c="dimmed" ta="center" py="lg">No groups defined yet</Text></Table.Td></Table.Tr>}
          </Table.Tbody>
        </Table>
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
    </Stack>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TAB 4: NODES
   ═══════════════════════════════════════════════════════════════ */
function NodesTab() {
  const [classified, setClassified] = useState<any[]>([]);
  const [envs, setEnvs] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [puppetNodes, setPuppetNodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [formCert, setFormCert] = useState('');
  const [formEnv, setFormEnv] = useState('');
  const [formGroupIds, setFormGroupIds] = useState<string[]>([]);
  const [formClasses, setFormClasses] = useState<string[]>([]);
  const [formParams, setFormParams] = useState<Array<{ key: string; val: string }>>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [n, e, g] = await Promise.all([enc.listNodes(), enc.listEnvironments(), enc.listGroups()]);
      setClassified(n); setEnvs(e); setGroups(g);
      try { const pn = await nodesApi.list(); setPuppetNodes(pn.map((x: any) => x.certname)); } catch { setPuppetNodes([]); }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = (prefillCert?: string) => {
    setEditing(null);
    setFormCert(prefillCert || ''); setFormEnv(envs[0]?.name || 'production');
    setFormGroupIds([]); setFormClasses([]); setFormParams([]);
    setModalOpen(true);
  };
  const openEdit = (n: any) => {
    setEditing(n);
    setFormCert(n.certname); setFormEnv(n.environment);
    setFormGroupIds(groups.filter((g) => (n.groups || []).includes(g.name)).map((g) => String(g.id)));
    setFormClasses(classDictToList(n.classes));
    setFormParams(dictToRows(n.parameters));
    setModalOpen(true);
  };
  const handleSave = async () => {
    try {
      const payload = { certname: formCert, environment: formEnv,
        classes: classListToDict(formClasses), parameters: rowsToDict(formParams),
        group_ids: formGroupIds.map(Number) };
      if (editing) {
        await enc.updateNode(editing.certname, payload);
        notifications.show({ title: 'Updated', message: `Node '${formCert}' updated`, color: 'green' });
      } else {
        await enc.createNode(payload);
        notifications.show({ title: 'Created', message: `Node '${formCert}' classified`, color: 'green' });
      }
      setModalOpen(false); load();
    } catch (e: any) { notifications.show({ title: 'Error', message: e.message, color: 'red' }); }
  };
  const handleDelete = async (certname: string) => {
    if (!confirm(`Remove classification for '${certname}'?`)) return;
    try { await enc.deleteNode(certname); notifications.show({ title: 'Removed', message: `'${certname}' removed`, color: 'green' }); load(); }
    catch (e: any) { notifications.show({ title: 'Error', message: e.message, color: 'red' }); }
  };

  const classifiedNames = new Set(classified.map((n) => n.certname));
  const unclassified = puppetNodes.filter((cn) => !classifiedNames.has(cn));
  

  if (loading) return <Center h={300}><Loader size="xl" /></Center>;

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
        <Text fw={700} mb="sm">Classified Nodes</Text>
        <Table striped highlightOnHover>
          <Table.Thead><Table.Tr>
            <Table.Th>Certname</Table.Th><Table.Th>Environment</Table.Th><Table.Th>Groups</Table.Th>
            <Table.Th>Node Classes</Table.Th><Table.Th>Node Params</Table.Th>
            <Table.Th style={{ textAlign: 'right' }}>Actions</Table.Th>
          </Table.Tr></Table.Thead>
          <Table.Tbody>
            {classified.map((n) => (
              <Table.Tr key={n.certname}>
                <Table.Td><Text fw={500} size="sm">{n.certname}</Text></Table.Td>
                <Table.Td><Badge variant="outline" size="sm">{n.environment}</Badge></Table.Td>
                <Table.Td>
                  <Group gap={4}>{(n.groups || []).map((g: string) => <Badge key={g} variant="light" color="orange" size="sm">{g}</Badge>)}
                  {(!n.groups || n.groups.length === 0) && <Text size="sm" c="dimmed">—</Text>}</Group>
                </Table.Td>
                <Table.Td><ClassBadges classes={n.classes} color="red" /></Table.Td>
                <Table.Td><ParamBadges params={n.parameters} color="pink" /></Table.Td>
                <Table.Td>
                  <Group gap="xs" justify="flex-end">
                    <Tooltip label="Edit"><ActionIcon variant="subtle" color="blue" onClick={() => openEdit(n)}><IconPencil size={16} /></ActionIcon></Tooltip>
                    <Tooltip label="Remove"><ActionIcon variant="subtle" color="red" onClick={() => handleDelete(n.certname)}><IconTrash size={16} /></ActionIcon></Tooltip>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
            {classified.length === 0 && <Table.Tr><Table.Td colSpan={6}><Text c="dimmed" ta="center" py="lg">No nodes classified yet</Text></Table.Td></Table.Tr>}
          </Table.Tbody>
        </Table>
      </Card>
      {unclassified.length > 0 && (
        <Card withBorder shadow="sm">
          <Text fw={700} mb="sm">Unclassified Nodes ({unclassified.length})</Text>
          <Text size="xs" c="dimmed" mb="sm">Known to PuppetDB but not yet classified. Click to classify.</Text>
          <Group gap="xs" wrap="wrap">
            {unclassified.map((cn) => (
              <Badge key={cn} variant="outline" color="gray" size="sm" style={{ cursor: 'pointer' }}
                onClick={() => openCreate(cn)}>{cn}</Badge>
            ))}
          </Group>
        </Card>
      )}
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
          <Select label="Environment" required
            data={envs.map((e) => ({ value: e.name, label: e.name }))}
            value={formEnv} onChange={(v) => setFormEnv(v || '')} />
          <MultiSelect label="Groups" clearable searchable
            data={(() => {
              const byEnv: Record<string, Array<{ value: string; label: string }>> = {};
              for (const g of groups) {
                if (!byEnv[g.environment]) byEnv[g.environment] = [];
                byEnv[g.environment].push({ value: String(g.id), label: g.name });
              }
              return Object.entries(byEnv).map(([env, items]) => ({ group: env, items }));
            })()}
            value={formGroupIds} onChange={setFormGroupIds}
            description="Assign this node to one or more groups. Node inherits classes/params from all selected groups."
            placeholder={groups.length === 0 ? 'No groups defined' : 'Select groups'} />
          <ClassPicker value={formClasses} onChange={setFormClasses} environment={formEnv}
            label="Node-specific Classes" description="Override or add classes (highest priority)" />
          <ParamEditor value={formParams} onChange={setFormParams}
            label="Node-specific Parameters" description="Override or add parameters (highest priority)" />
          <Button onClick={handleSave}>{editing ? 'Update' : 'Classify'}</Button>
        </Stack>
      </Modal>
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
  const [puppetNodes, setPuppetNodes] = useState<string[]>([]);

  useEffect(() => {
    nodesApi.list().then((ns: any[]) => setPuppetNodes(ns.map((n) => n.certname))).catch(() => {});
  }, []);

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
                        <Code block mt={2} style={{ fontSize: 11 }}>{JSON.stringify(params, null, 2)}</Code>
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
                  <Code block style={{ fontSize: 11 }}>{JSON.stringify(result.parameters, null, 2)}</Code>
                ) : <Text size="sm" c="dimmed">No parameters</Text>}
              </Paper>
            </Grid.Col>
          </Grid>
          <Divider my="md" />
          <Text fw={600} size="sm" mb="xs">YAML Output (Puppet ENC format)</Text>
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
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [formClasses, setFormClasses] = useState<string[]>([]);
  const [formParams, setFormParams] = useState<Array<{ key: string; val: string }>>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const c = await enc.getCommon();
      setData(c);
      setFormClasses(classDictToList(c.classes));
      setFormParams(dictToRows(c.parameters));
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await enc.saveCommon({ classes: classListToDict(formClasses), parameters: rowsToDict(formParams) });
      notifications.show({ title: 'Saved', message: 'Common defaults updated', color: 'green' });
      setEditing(false); load();
    } catch (e: any) { notifications.show({ title: 'Error', message: e.message, color: 'red' }); }
    setSaving(false);
  };

  if (loading) return <Center h={300}><Loader size="xl" /></Center>;

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
export function NodeClassifierPage() {
  return (
    <Stack>
      <Title order={2}>Node Classifier</Title>
      <Tabs defaultValue="nodes" variant="outline">
        <Tabs.List>
          <Tabs.Tab value="nodes" leftSection={<IconServer size={16} />}>Nodes</Tabs.Tab>
          <Tabs.Tab value="common" leftSection={<IconWorld size={16} />}>Common</Tabs.Tab>
          <Tabs.Tab value="environments" leftSection={<IconWorld size={16} />}>Environments</Tabs.Tab>
          <Tabs.Tab value="groups" leftSection={<IconTags size={16} />}>Node Groups</Tabs.Tab>
          <Tabs.Tab value="lookup" leftSection={<IconSearch size={16} />}>Classification Lookup</Tabs.Tab>
          <Tabs.Tab value="help" leftSection={<IconHelp size={16} />}>Help</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="nodes" pt="md"><NodesTab /></Tabs.Panel>
        <Tabs.Panel value="common" pt="md"><CommonTab /></Tabs.Panel>
        <Tabs.Panel value="environments" pt="md"><EnvironmentsTab /></Tabs.Panel>
        <Tabs.Panel value="groups" pt="md"><GroupsTab /></Tabs.Panel>
        <Tabs.Panel value="lookup" pt="md"><LookupTab /></Tabs.Panel>
        <Tabs.Panel value="help" pt="md"><HierarchyTab /></Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
