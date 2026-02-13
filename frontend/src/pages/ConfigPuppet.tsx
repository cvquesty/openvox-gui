import { useState, useEffect, useCallback } from 'react';
import {
  Title, Card, Loader, Center, Alert, Stack, Group, Text, Code, Table,
  Badge, Tabs, Button, Textarea, TextInput, Select, NavLink, ScrollArea, Box, Grid,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconNetwork, IconDatabase, IconPackage, IconFile, IconFolder,
  IconEdit, IconDeviceFloppy, IconX, IconChevronRight, IconSearch, IconAlertTriangle,
} from '@tabler/icons-react';
import { useApi } from '../hooks/useApi';
import { useAppTheme } from '../hooks/ThemeContext';
import { config, nodes as nodesApi } from '../services/api';

/* ── Types ─────────────────────────────────────────────── */
interface ConfigFile {
  name: string;
  path: string;
  exists: boolean;
}

interface ConfigGroup {
  group: string;
  base: string;
  files: ConfigFile[];
}

/* ── Config File Editor component ────────────────────────── */
function ConfigFileEditor() {
  const [groups, setGroups] = useState<ConfigGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string>('');
  const [fileContent, setFileContent] = useState<string>('');
  const [originalContent, setOriginalContent] = useState<string>('');
  const [fileLoading, setFileLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Load file tree on mount
  useEffect(() => {
    config.listFiles()
      .then((data: any) => setGroups(data.groups || []))
      .catch(() => notifications.show({ title: 'Error', message: 'Failed to load config files', color: 'red' }))
      .finally(() => setLoading(false));
  }, []);

  // Load a file's contents
  const loadFile = useCallback(async (path: string, name: string) => {
    setSelectedPath(path);
    setSelectedName(name);
    setEditing(false);
    setFileLoading(true);
    try {
      const data = await config.readFile(path);
      setFileContent(data.content);
      setOriginalContent(data.content);
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
      setFileContent('');
      setOriginalContent('');
    } finally {
      setFileLoading(false);
    }
  }, []);

  // Save the file
  const handleSave = async () => {
    if (!selectedPath) return;
    setSaving(true);
    try {
      await config.saveFile(selectedPath, fileContent);
      setOriginalContent(fileContent);
      setEditing(false);
      notifications.show({ title: 'Saved', message: `${selectedName} saved successfully (backup created)`, color: 'green' });
    } catch (err: any) {
      notifications.show({ title: 'Save Failed', message: err.message, color: 'red' });
    } finally {
      setSaving(false);
    }
  };

  // Cancel editing
  const handleCancel = () => {
    setFileContent(originalContent);
    setEditing(false);
  };

  if (loading) return <Center h={200}><Loader /></Center>;

  return (
    <Group align="flex-start" gap="md" wrap="nowrap" style={{ minHeight: 400 }}>
      {/* Left: file tree */}
      <Card withBorder shadow="sm" padding={0} style={{ width: 280, flexShrink: 0 }}>
        <ScrollArea style={{ height: 500 }}>
          <Box p="xs">
            {groups.map((g) => {
              const isOpen = !!expanded[g.group];
              return (
                <Box key={g.group} mb={4}>
                  <NavLink
                    label={g.group}
                    leftSection={<IconFolder size={16} />}
                    rightSection={
                      <IconChevronRight
                        size={14}
                        style={{
                          transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                          transition: 'transform 150ms ease',
                        }}
                      />
                    }
                    onClick={() => setExpanded((prev) => ({ ...prev, [g.group]: !prev[g.group] }))}
                    variant="subtle"
                    py={6}
                    styles={{ label: { fontSize: 13, fontWeight: 700, textTransform: 'uppercase' } }}
                  />
                  {isOpen && g.files.map((f) => (
                    <NavLink
                      key={f.path}
                      label={f.name}
                      leftSection={<IconFile size={14} />}
                      active={selectedPath === f.path}
                      onClick={() => f.exists && loadFile(f.path, f.name)}
                      disabled={!f.exists}
                      variant="filled"
                      py={4}
                      pl={28}
                      styles={{ label: { fontSize: 13 } }}
                      rightSection={
                        !f.exists ? <Badge size="xs" color="gray">missing</Badge> : null
                      }
                    />
                  ))}
                </Box>
              );
            })}
          </Box>
        </ScrollArea>
      </Card>

      {/* Right: file viewer / editor */}
      <Card withBorder shadow="sm" padding="md" style={{ flex: 1, minWidth: 0 }}>
        {!selectedPath ? (
          <Center h={460}>
            <Stack align="center" gap="xs">
              <IconFile size={48} color="#666" />
              <Text c="dimmed" size="sm">Select a configuration file to view</Text>
            </Stack>
          </Center>
        ) : fileLoading ? (
          <Center h={460}><Loader /></Center>
        ) : (
          <Stack gap="sm" h={480}>
            <Group justify="space-between">
              <div>
                <Text fw={700} size="sm">{selectedName}</Text>
                <Text size="xs" c="dimmed">{selectedPath}</Text>
              </div>
              <Group gap="xs">
                {editing ? (
                  <>
                    <Button
                      size="xs"
                      variant="outline"
                      color="gray"
                      leftSection={<IconX size={14} />}
                      onClick={handleCancel}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="xs"
                      color="green"
                      leftSection={<IconDeviceFloppy size={14} />}
                      onClick={handleSave}
                      loading={saving}
                    >
                      Save
                    </Button>
                  </>
                ) : (
                  <Button
                    size="xs"
                    variant="outline"
                    leftSection={<IconEdit size={14} />}
                    onClick={() => setEditing(true)}
                  >
                    Edit
                  </Button>
                )}
              </Group>
            </Group>

            {editing ? (
              <Textarea
                value={fileContent}
                onChange={(e) => setFileContent(e.currentTarget.value)}
                autosize={false}
                styles={{
                  input: {
                    fontFamily: 'monospace',
                    fontSize: 13,
                    height: 430,
                    resize: 'none',
                  },
                }}
              />
            ) : (
              <ScrollArea style={{ flex: 1 }}>
                <Code block style={{ whiteSpace: 'pre', fontSize: 13, minHeight: 430 }}>
                  {fileContent || '(empty file)'}
                </Code>
              </ScrollArea>
            )}
          </Stack>
        )}
      </Card>
    </Group>
  );
}


/* ── Hiera Viewer (read-only) ────────────────────────────── */
interface HieraFile {
  name: string;
  path: string;
  content: string;
}
interface HieraEnv {
  environment: string;
  files: HieraFile[];
}

function HieraViewer() {
  const [envs, setEnvs] = useState<HieraEnv[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selectedFile, setSelectedFile] = useState<HieraFile | null>(null);

  useEffect(() => {
    config.getHieraFiles()
      .then((data: any) => {
        const environments: HieraEnv[] = data.environments || [];
        setEnvs(environments);
        // Auto-select first file of first environment
        if (environments.length > 0 && environments[0].files.length > 0) {
          setExpanded({ [environments[0].environment]: true });
          setSelectedFile(environments[0].files[0]);
        }
      })
      .catch(() => notifications.show({ title: 'Error', message: 'Failed to load hiera files', color: 'red' }))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Center h={200}><Loader /></Center>;
  if (envs.length === 0) return <Alert color="yellow">No Hiera data found</Alert>;

  return (
    <Group align="flex-start" gap="md" wrap="nowrap" style={{ minHeight: 400 }}>
      {/* Left: file tree grouped by environment */}
      <Card withBorder shadow="sm" padding={0} style={{ width: 320, flexShrink: 0 }}>
        <ScrollArea style={{ height: 500 }}>
          <Box p="xs">
            {envs.map((env) => {
              const isOpen = !!expanded[env.environment];
              return (
                <Box key={env.environment} mb={4}>
                  <NavLink
                    label={env.environment}
                    leftSection={<IconFolder size={16} />}
                    rightSection={
                      <IconChevronRight
                        size={14}
                        style={{
                          transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                          transition: 'transform 150ms ease',
                        }}
                      />
                    }
                    onClick={() => setExpanded((prev) => ({ ...prev, [env.environment]: !prev[env.environment] }))}
                    variant="subtle"
                    py={6}
                    styles={{ label: { fontSize: 13, fontWeight: 700, textTransform: 'uppercase' } }}
                  />
                  {isOpen && env.files.map((f) => (
                    <NavLink
                      key={f.path}
                      label={f.name}
                      leftSection={<IconFile size={14} />}
                      active={selectedFile?.path === f.path}
                      onClick={() => setSelectedFile(f)}
                      variant="filled"
                      py={4}
                      pl={28}
                      styles={{ label: { fontSize: 13 } }}
                    />
                  ))}
                </Box>
              );
            })}
          </Box>
        </ScrollArea>
      </Card>

      {/* Right: read-only file viewer */}
      <Card withBorder shadow="sm" padding="md" style={{ flex: 1, minWidth: 0 }}>
        {!selectedFile ? (
          <Center h={460}>
            <Stack align="center" gap="xs">
              <IconFile size={48} color="#666" />
              <Text c="dimmed" size="sm">Select a Hiera file to view</Text>
            </Stack>
          </Center>
        ) : (
          <Stack gap="sm" h={480}>
            <div>
              <Text fw={700} size="sm">{selectedFile.name}</Text>
              <Text size="xs" c="dimmed">{selectedFile.path}</Text>
            </div>
            <ScrollArea style={{ flex: 1 }}>
              <Code block style={{ whiteSpace: 'pre', fontSize: 13, minHeight: 430 }}>
                {selectedFile.content || '(empty file)'}
              </Code>
            </ScrollArea>
          </Stack>
        )}
      </Card>
    </Group>
  );
}



/* ── HIERA-TRON — data lookup machine illustration ──────── */
function HieraTron() {
  return (
    <svg viewBox="0 0 300 360" width="100%" style={{ maxHeight: 380, display: 'block' }}>
      <defs>
        <linearGradient id="ht-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1a1b2e" />
          <stop offset="100%" stopColor="#252540" />
        </linearGradient>
      </defs>

      <rect width="300" height="360" fill="url(#ht-sky)" rx="8" />

      {/* Stars */}
      <circle cx="20" cy="12" r="1" fill="#fff" opacity="0.6" />
      <circle cx="65" cy="25" r="1.5" fill="#fff" opacity="0.4" />
      <circle cx="120" cy="8" r="1" fill="#fff" opacity="0.7" />
      <circle cx="180" cy="20" r="1" fill="#fff" opacity="0.5" />
      <circle cx="230" cy="10" r="1.5" fill="#fff" opacity="0.6" />
      <circle cx="275" cy="30" r="1" fill="#fff" opacity="0.4" />
      <circle cx="45" cy="40" r="1" fill="#fff" opacity="0.3" />
      <circle cx="260" cy="45" r="1" fill="#fff" opacity="0.5" />

      {/* Ground */}
      <rect x="0" y="300" width="300" height="60" fill="#1a1a2e" />
      <rect x="0" y="300" width="300" height="2" fill="#333355" />

      {/* ── Data hierarchy tower ── */}
      {/* Base platform */}
      <rect x="80" y="270" width="140" height="28" fill="#3d4d5d" rx="4" stroke="#7788aa" strokeWidth="1" />
      <rect x="95" y="276" width="110" height="16" fill="#334455" rx="3" />
      <text x="150" y="288" textAnchor="middle" fill="#44aaff" fontSize="7" fontFamily="monospace" fontWeight="bold">
        HIERA-TRON 5000
      </text>

      {/* Data layers — stacked like a pyramid */}
      {/* Layer 1: Common (bottom, widest) */}
      <rect x="90" y="230" width="120" height="35" fill="#445566" rx="4" stroke="#667788" strokeWidth="1" />
      <text x="150" y="245" textAnchor="middle" fill="#88aacc" fontSize="8" fontFamily="monospace">common.yaml</text>
      <rect x="98" y="252" width="50" height="4" fill="#556677" rx="1" />
      <rect x="98" y="258" width="35" height="4" fill="#556677" rx="1" />

      {/* Layer 2: OS family */}
      <rect x="105" y="192" width="90" height="33" fill="#4a5a6a" rx="4" stroke="#667788" strokeWidth="1" />
      <text x="150" y="206" textAnchor="middle" fill="#88aacc" fontSize="7" fontFamily="monospace">os_family.yaml</text>
      <rect x="112" y="213" width="40" height="4" fill="#556677" rx="1" />

      {/* Layer 3: Node-specific (top, narrowest) */}
      <rect x="115" y="155" width="70" height="32" fill="#506070" rx="4" stroke="#778899" strokeWidth="1" />
      <text x="150" y="168" textAnchor="middle" fill="#aaccee" fontSize="7" fontFamily="monospace">node.yaml</text>
      <rect x="122" y="175" width="30" height="3" fill="#667788" rx="1" />

      {/* Search beam from top */}
      <line x1="150" y1="60" x2="150" y2="155" stroke="#44aaff" strokeWidth="2" opacity="0.4" strokeDasharray="4 4">
        <animate attributeName="strokeDashoffset" values="0;-16" dur="1s" repeatCount="indefinite" />
      </line>

      {/* Magnifying glass at top */}
      <circle cx="150" cy="52" r="18" fill="none" stroke="#88aacc" strokeWidth="3" />
      <circle cx="150" cy="52" r="14" fill="#112233" opacity="0.5" />
      <line x1="163" y1="65" x2="175" y2="77" stroke="#88aacc" strokeWidth="3" strokeLinecap="round" />
      {/* Question mark in lens */}
      <text x="150" y="58" textAnchor="middle" fill="#44aaff" fontSize="16" fontFamily="serif" fontWeight="bold" opacity="0.8">
        ?
      </text>
      {/* Lens pulse */}
      <circle cx="150" cy="52" r="18" fill="none" stroke="#44aaff" strokeWidth="1" opacity="0.3">
        <animate attributeName="r" values="16;20;16" dur="2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.3;0.1;0.3" dur="2s" repeatCount="indefinite" />
      </circle>

      {/* Arrows showing lookup flow */}
      <path d="M150,80 L150,155" fill="none" stroke="#44aaff" strokeWidth="0" />

      {/* Found indicator — key popping out */}
      <g>
        <rect x="215" y="160" width="60" height="22" fill="#223344" rx="4" stroke="#44ff44" strokeWidth="1">
          <animate attributeName="opacity" values="0;1;1;0" dur="4s" repeatCount="indefinite" />
        </rect>
        <text x="245" y="175" textAnchor="middle" fill="#44ff44" fontSize="8" fontFamily="monospace" fontWeight="bold">
          <animate attributeName="opacity" values="0;1;1;0" dur="4s" repeatCount="indefinite" />
          FOUND ✓
        </text>
        {/* Arrow from node layer to found */}
        <line x1="185" y1="171" x2="215" y2="171" stroke="#44ff44" strokeWidth="1" opacity="0.6">
          <animate attributeName="opacity" values="0;0.6;0.6;0" dur="4s" repeatCount="indefinite" />
        </line>
      </g>

      {/* Data particles floating up from layers */}
      <circle r="2" fill="#44aaff" opacity="0.5">
        <animateMotion dur="3s" repeatCount="indefinite" path="M130,250 L130,100" />
        <animate attributeName="opacity" values="0.5;0.1;0" dur="3s" repeatCount="indefinite" />
      </circle>
      <circle r="1.5" fill="#44aaff" opacity="0.4">
        <animateMotion dur="3.5s" repeatCount="indefinite" path="M170,240 L170,90" begin="1s" />
        <animate attributeName="opacity" values="0.4;0.1;0" dur="3.5s" repeatCount="indefinite" />
      </circle>
      <circle r="2" fill="#88ccff" opacity="0.3">
        <animateMotion dur="4s" repeatCount="indefinite" path="M145,260 L145,80" begin="2s" />
        <animate attributeName="opacity" values="0.3;0.1;0" dur="4s" repeatCount="indefinite" />
      </circle>

      {/* Status lights on base */}
      <circle cx="100" cy="284" r="3" fill="#44ff44">
        <animate attributeName="fill" values="#44ff44;#22aa22;#44ff44" dur="1.5s" repeatCount="indefinite" />
      </circle>
      <circle cx="110" cy="284" r="3" fill="#ffaa22">
        <animate attributeName="fill" values="#ffaa22;#cc8811;#ffaa22" dur="2s" repeatCount="indefinite" />
      </circle>
      <circle cx="120" cy="284" r="3" fill="#44aaff">
        <animate attributeName="fill" values="#44aaff;#2288cc;#44aaff" dur="1.8s" repeatCount="indefinite" />
      </circle>

      {/* Little robot searching */}
      <rect x="30" y="252" width="16" height="22" fill="#667788" rx="3" />
      <rect x="33" y="242" width="10" height="12" fill="#778899" rx="2" />
      <rect x="35" y="246" width="2.5" height="2.5" fill="#44aaff" rx="0.5">
        <animate attributeName="fill" values="#44aaff;#88ccff;#44aaff" dur="2s" repeatCount="indefinite" />
      </rect>
      <rect x="39" y="246" width="2.5" height="2.5" fill="#44aaff" rx="0.5">
        <animate attributeName="fill" values="#44aaff;#88ccff;#44aaff" dur="2s" repeatCount="indefinite" />
      </rect>
      <line x1="38" y1="242" x2="38" y2="235" stroke="#8899bb" strokeWidth="1" />
      <circle cx="38" cy="233" r="2" fill="#44aaff">
        <animate attributeName="fill" values="#44aaff;#88ccff;#44aaff" dur="1.5s" repeatCount="indefinite" />
      </circle>
      {/* Robot arm pointing at tower */}
      <line x1="46" y1="258" x2="88" y2="250" stroke="#667788" strokeWidth="2" />
      <line x1="30" y1="260" x2="22" y2="268" stroke="#667788" strokeWidth="2" />
      <line x1="35" y1="274" x2="32" y2="282" stroke="#667788" strokeWidth="2" />
      <line x1="41" y1="274" x2="44" y2="282" stroke="#667788" strokeWidth="2" />

      {/* Caption */}
      <text x="150" y="322" textAnchor="middle" fill="#8899aa" fontSize="10" fontFamily="monospace">
        traversing the hierarchy
      </text>
      <text x="150" y="336" textAnchor="middle" fill="#556677" fontSize="8" fontFamily="monospace">
        one yaml file at a time
      </text>
    </svg>
  );
}

/* ── Hiera Lookup (puppet lookup --explain) ──────────────── */
function LookupTrace() {
  const { isFormal } = useAppTheme();
  const [key, setKey] = useState('');
  const [node, setNode] = useState('');
  const [environment, setEnvironment] = useState<string | null>(null);
  const [output, setOutput] = useState('');
  const [running, setRunning] = useState(false);
  const [environments, setEnvironments] = useState<string[]>([]);
  const [nodes, setNodes] = useState<string[]>([]);

  // Load environments and nodes for dropdowns
  useEffect(() => {
    config.getEnvironments()
      .then((data: any) => {
        setEnvironments(data.environments || []);
      })
      .catch(() => {});
    // Fetch node list
    nodesApi.list()
      .then((data: any) => {
        const names = (Array.isArray(data) ? data : []).map((n: any) => n.certname || n).filter(Boolean);
        setNodes(names);
      })
      .catch(() => {});
  }, []);

  const handleLookup = async () => {
    if (!key.trim()) return;
    setRunning(true);
    setOutput('');
    try {
      const result = await config.lookup(key.trim(), node.trim() || undefined, environment || undefined);
      let text = result.output || '';
      if (result.stderr) {
        text += (text ? '\n' : '') + result.stderr;
      }
      if (!text.trim()) {
        text = `(no output — exit code ${result.exit_code})`;
      }
      setOutput(text);
    } catch (err: any) {
      setOutput(`Error: ${err.message}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Stack>
      <Grid>
        <Grid.Col span={{ base: 12, md: isFormal ? 12 : 7 }}>
      <Card withBorder shadow="sm" padding="md" h="100%">
        <Title order={4} mb="md">Hiera Lookup</Title>
        <Group align="end" grow>
          <TextInput
            label="Hiera Key"
            placeholder="e.g. classes, profile::base::ntp_servers"
            value={key}
            onChange={(e) => setKey(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleLookup(); }}
            style={{ flex: 2 }}
          />
          <Select
            label="Node"
            placeholder="(optional)"
            data={nodes.map((n) => ({ value: n, label: n }))}
            value={node || null}
            onChange={(v) => setNode(v || '')}
            clearable
            searchable
            style={{ flex: 1 }}
          />
          <Select
            label="Environment"
            placeholder="(default: production)"
            data={environments.map((e) => ({ value: e, label: e }))}
            value={environment}
            onChange={setEnvironment}
            clearable
            style={{ flex: 1 }}
          />
          <Button
            leftSection={running ? <Loader size={14} color="white" /> : <IconSearch size={16} />}
            onClick={handleLookup}
            loading={running}
            disabled={!key.trim() || running}
          >
            Trace
          </Button>
        </Group>
      </Card>
        </Grid.Col>
        {!isFormal && (
          <Grid.Col span={{ base: 12, md: 5 }}>
            <Card withBorder shadow="sm" padding={0} h="100%" style={{ overflow: 'hidden', background: 'linear-gradient(to bottom, #1a1b2e, #252540)' }}>
              <HieraTron />
            </Card>
          </Grid.Col>
        )}
      </Grid>

      <Card withBorder shadow="sm" padding="md">
        <Group mb="sm" justify="space-between">
          <Title order={4}>Explain Output</Title>
          {output && (
            <Button variant="subtle" size="xs" color="gray" onClick={() => setOutput('')}>
              Clear
            </Button>
          )}
        </Group>
        <ScrollArea style={{ height: 450 }}>
          {output ? (
            <Box
              style={{
                fontFamily: 'monospace',
                fontSize: 13,
                whiteSpace: 'pre',
                backgroundColor: 'var(--mantine-color-dark-8)',
                color: 'var(--mantine-color-dark-0)',
                padding: 12,
                borderRadius: 8,
              }}
            >
              {output.split('\n').map((line, i) => (
                <div key={i}>
                  {/Found key:/.test(line) ? (
                    <span style={{ color: '#ff4444', fontWeight: 700 }}>{line}</span>
                  ) : line}
                </div>
              ))}
            </Box>
          ) : (
            <Center h={400}>
              <Text c="dimmed" size="sm">
                Enter a Hiera key and click Trace to see the full lookup path
              </Text>
            </Center>
          )}
        </ScrollArea>
      </Card>
    </Stack>
  );
}

/* ── Main Page ───────────────────────────────────────────── */
export function ConfigPuppetPage() {

  return (
    <Stack>
      <Title order={2}>Puppet Configuration</Title>

      <Alert
        variant="light"
        color="yellow"
        title="Puppet-Managed Configuration Warning"
        icon={<IconAlertTriangle size={20} />}
        radius="md"
      >
        If you are managing <Code>puppet.conf</Code> or any other configuration files on this page with Puppet itself
        (e.g. via the <Code>puppet_conf</Code> resource type or an INI settings module), any changes you make here
        will be <Text span fw={700}>overwritten</Text> on the next Puppet agent run. To make persistent changes,
        update your Puppet code instead.
      </Alert>

      <Tabs defaultValue="files">
        <Tabs.List>
          <Tabs.Tab value="files" leftSection={<IconNetwork size={16} />}>Configuration Files</Tabs.Tab>
          <Tabs.Tab value="hiera" leftSection={<IconPackage size={16} />}>Hiera Data Files</Tabs.Tab>
          <Tabs.Tab value="lookup" leftSection={<IconSearch size={16} />}>Hiera Lookup</Tabs.Tab>
        </Tabs.List>

        {/* Configuration Files tab */}
        <Tabs.Panel value="files" pt="md">
          <ConfigFileEditor />
        </Tabs.Panel>

        {/* Hiera tab */}
        <Tabs.Panel value="hiera" pt="md">
          <HieraViewer />
        </Tabs.Panel>

        {/* Hiera Lookup tab */}
        <Tabs.Panel value="lookup" pt="md">
          <LookupTrace />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
