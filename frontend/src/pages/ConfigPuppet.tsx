import { useState, useEffect, useCallback } from 'react';
import {
  Title, Card, Loader, Center, Alert, Stack, Group, Text, Code, Table,
  Badge, Tabs, Button, Textarea, TextInput, NavLink, ScrollArea, Box,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconNetwork, IconDatabase, IconPackage, IconFile, IconFolder,
  IconEdit, IconDeviceFloppy, IconX, IconChevronRight, IconSearch,
} from '@tabler/icons-react';
import { useApi } from '../hooks/useApi';
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
function HieraViewer() {
  const [files, setFiles] = useState<{ name: string; path: string; content: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<number>(0);

  useEffect(() => {
    config.getHieraFiles()
      .then((data: any) => {
        setFiles(data.files || []);
        setSelected(0);
      })
      .catch(() => notifications.show({ title: 'Error', message: 'Failed to load hiera files', color: 'red' }))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Center h={200}><Loader /></Center>;
  if (files.length === 0) return <Alert color="yellow">No hiera.yaml files found</Alert>;

  const current = files[selected];

  return (
    <Group align="flex-start" gap="md" wrap="nowrap" style={{ minHeight: 400 }}>
      {/* Left: file list */}
      <Card withBorder shadow="sm" padding={0} style={{ width: 280, flexShrink: 0 }}>
        <ScrollArea style={{ height: 500 }}>
          <Box p="xs">
            <Box mb={4}>
              <Group gap={6} mb={4} ml={4}>
                <IconFolder size={14} color="#888" />
                <Text size="xs" fw={700} c="dimmed" tt="uppercase">Hiera Configuration</Text>
              </Group>
              {files.map((f, i) => (
                <NavLink
                  key={f.path}
                  label={f.name}
                  leftSection={<IconFile size={14} />}
                  active={selected === i}
                  onClick={() => setSelected(i)}
                  variant="filled"
                  py={4}
                  styles={{ label: { fontSize: 13 } }}
                />
              ))}
            </Box>
          </Box>
        </ScrollArea>
      </Card>

      {/* Right: read-only file viewer */}
      <Card withBorder shadow="sm" padding="md" style={{ flex: 1, minWidth: 0 }}>
        <Stack gap="sm" h={480}>
          <div>
            <Text fw={700} size="sm">{current.name}</Text>
            <Text size="xs" c="dimmed">{current.path}</Text>
          </div>
          <ScrollArea style={{ flex: 1 }}>
            <Code block style={{ whiteSpace: 'pre', fontSize: 13, minHeight: 430 }}>
              {current.content || '(empty file)'}
            </Code>
          </ScrollArea>
        </Stack>
      </Card>
    </Group>
  );
}


/* ── Lookup Trace (puppet lookup --explain) ──────────────── */
function LookupTrace() {
  const [key, setKey] = useState('');
  const [node, setNode] = useState('');
  const [environment, setEnvironment] = useState<string | null>(null);
  const [output, setOutput] = useState('');
  const [running, setRunning] = useState(false);
  const [environments, setEnvironments] = useState<string[]>([]);
  const [nodes, setNodes] = useState<string[]>([]);

  // Load environments and nodes for dropdowns
  useEffect(() => {
    config.getHieraFiles()
      .then((data: any) => {
        const envs = (data.files || []).map((f: any) => f.name.replace('/hiera.yaml', '')).filter((n: string) => n);
        setEnvironments(envs);
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
      <Card withBorder shadow="sm" padding="md">
        <Title order={4} mb="md">Puppet Lookup</Title>
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
            <Code block style={{ whiteSpace: 'pre', fontSize: 13 }}>
              {output}
            </Code>
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

      <Tabs defaultValue="files">
        <Tabs.List>
          <Tabs.Tab value="files" leftSection={<IconNetwork size={16} />}>Configuration Files</Tabs.Tab>
          <Tabs.Tab value="hiera" leftSection={<IconPackage size={16} />}>Hiera</Tabs.Tab>
          <Tabs.Tab value="lookup" leftSection={<IconSearch size={16} />}>Lookup Trace</Tabs.Tab>
        </Tabs.List>

        {/* Configuration Files tab */}
        <Tabs.Panel value="files" pt="md">
          <ConfigFileEditor />
        </Tabs.Panel>

        {/* Hiera tab */}
        <Tabs.Panel value="hiera" pt="md">
          <HieraViewer />
        </Tabs.Panel>

        {/* Lookup Trace tab */}
        <Tabs.Panel value="lookup" pt="md">
          <LookupTrace />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
