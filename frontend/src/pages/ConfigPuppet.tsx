import { useState, useEffect, useCallback } from 'react';
import {
  Title, Card, Loader, Center, Alert, Stack, Group, Text, Code, Table,
  Badge, Tabs, Button, Textarea, NavLink, ScrollArea, Box,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconNetwork, IconDatabase, IconPackage, IconFile, IconFolder,
  IconEdit, IconDeviceFloppy, IconX, IconChevronRight,
} from '@tabler/icons-react';
import { useApi } from '../hooks/useApi';
import { config } from '../services/api';

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
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

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
              const isOpen = !collapsed[g.group];
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
                    onClick={() => setCollapsed((prev) => ({ ...prev, [g.group]: !prev[g.group] }))}
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

/* ── Main Page ───────────────────────────────────────────── */
export function ConfigPuppetPage() {
  const { data: hiera, loading: hieraLoading } = useApi(config.getHiera);

  return (
    <Stack>
      <Title order={2}>Puppet Configuration</Title>

      <Tabs defaultValue="files">
        <Tabs.List>
          <Tabs.Tab value="files" leftSection={<IconNetwork size={16} />}>Configuration Files</Tabs.Tab>
          <Tabs.Tab value="hiera" leftSection={<IconPackage size={16} />}>Hiera</Tabs.Tab>
        </Tabs.List>

        {/* Configuration Files tab */}
        <Tabs.Panel value="files" pt="md">
          <ConfigFileEditor />
        </Tabs.Panel>

        {/* Hiera tab */}
        <Tabs.Panel value="hiera" pt="md">
          {hieraLoading ? (
            <Center h={200}><Loader /></Center>
          ) : (
            <Card withBorder shadow="sm">
              <Text fw={700} mb="sm">hiera.yaml</Text>
              <Code block style={{ maxHeight: 500, overflow: 'auto' }}>
                {JSON.stringify(hiera, null, 2)}
              </Code>
            </Card>
          )}
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
