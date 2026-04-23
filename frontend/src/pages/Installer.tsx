/**
 * OpenVox GUI - Installer.tsx
 *
 * Lives under Infrastructure -> Installer.  Surfaces the local OpenVox
 * package mirror that openvox-gui maintains under /opt/openvox-pkgs/
 * and provides the install commands a fresh agent host should run to
 * bootstrap itself against this puppetserver.
 *
 * Mirrors the spirit of Puppet Enterprise's "Install agents" page
 * (https://help.puppet.com/pe/2023.8/topics/installing_agents.htm)
 * but for OpenVox: agents pull packages from yum.voxpupuli.org /
 * apt.voxpupuli.org / downloads.voxpupuli.org via this server.
 *
 * Major UI sections:
 *
 *   1. Install commands (Linux + Windows) -- the headline feature.
 *      One copy-to-clipboard box per platform with the curl/PowerShell
 *      one-liner pre-rendered.
 *   2. Mirror status -- last sync time, total bytes, disk space, lock
 *      status; "Sync now" button for admins/operators.
 *   3. Per-platform breakdown -- one row per top-level platform
 *      directory showing presence, size, and package count.
 *   4. Sync log tail -- last N lines of the sync log file for quick
 *      troubleshooting.
 *
 * Backend contract: /api/installer/{info,sync,log,diskinfo,files}.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Title, Card, Stack, Group, Text, Button, Alert, Loader, Center,
  Table, Badge, Code, ScrollArea, Grid, Box, Divider, Tabs,
  CopyButton, ActionIcon, Tooltip, Progress, Anchor,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconDownload, IconRefresh, IconCheck, IconCopy, IconBrandWindows,
  IconBrandUbuntu, IconBrandDebian, IconBrandRedhat, IconBrandApple,
  IconAlertCircle, IconCloudDownload, IconClipboard, IconFolder,
  IconExternalLink, IconClock, IconServer,
} from '@tabler/icons-react';
import { installer, InstallerInfo, InstallerDiskInfo } from '../services/api';
import { useAuth } from '../hooks/AuthContext';

/**
 * Format a byte count as a human-friendly string (B / KB / MB / GB / TB).
 * We use binary units (1024-based) to match what most disk-management
 * tools display, not decimal MB.
 */
function formatBytes(n: number): string {
  if (!n || n < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}

/**
 * Pick a Tabler icon for a platform directory name so the platform
 * breakdown table is scannable at a glance.
 */
function platformIcon(name: string) {
  switch (name) {
    case 'redhat':  return <IconBrandRedhat size={18} />;
    case 'debian':  return <IconBrandDebian size={18} />;
    case 'ubuntu':  return <IconBrandUbuntu size={18} />;
    case 'windows': return <IconBrandWindows size={18} />;
    case 'mac':     return <IconBrandApple size={18} />;
    default:        return <IconFolder size={18} />;
  }
}

/**
 * Render a copy-able command snippet inside a styled <Card>.  The
 * Mantine CopyButton handles the clipboard interaction; we just style
 * the surrounding chrome.
 */
function CommandBlock({
  title, icon, command, helper,
}: {
  title: string;
  icon: React.ReactNode;
  command: string;
  helper?: string;
}) {
  return (
    <Card withBorder shadow="sm">
      <Group justify="space-between" mb="xs">
        <Group gap="xs">
          {icon}
          <Text fw={700}>{title}</Text>
        </Group>
        <CopyButton value={command} timeout={2000}>
          {({ copied, copy }) => (
            <Tooltip label={copied ? 'Copied!' : 'Copy to clipboard'} withArrow>
              <Button
                size="xs"
                variant="light"
                color={copied ? 'teal' : 'blue'}
                leftSection={copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                onClick={copy}
              >
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </Tooltip>
          )}
        </CopyButton>
      </Group>
      {helper && (
        <Text size="xs" c="dimmed" mb="xs">{helper}</Text>
      )}
      {/*
        The command can be very long (the Windows one-liner is ~250
        chars).  Wrap inside a horizontally-scrolling ScrollArea so the
        Card doesn't overflow on narrow viewports.
      */}
      <ScrollArea>
        <Code block style={{ whiteSpace: 'pre' }}>{command}</Code>
      </ScrollArea>
    </Card>
  );
}

export function InstallerPage() {
  const { user } = useAuth();
  const [info, setInfo]           = useState<InstallerInfo | null>(null);
  const [diskInfo, setDiskInfo]   = useState<InstallerDiskInfo | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [syncing, setSyncing]     = useState(false);
  const [syncLog, setSyncLog]     = useState<string[]>([]);
  const [tail, setTail]           = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>('linux');

  // Operators and admins can trigger sync; viewers cannot.
  const canSync = user && (user.role === 'admin' || user.role === 'operator');

  /**
   * Fetch installer info + disk info + log tail in parallel.
   * Called on mount and after each manual sync.
   */
  const refresh = useCallback(async () => {
    try {
      const [i, d, l] = await Promise.all([
        installer.getInfo(),
        installer.getDiskInfo().catch(() => null),
        installer.getLog(50).catch(() => ({ lines: [] as string[] })),
      ]);
      setInfo(i);
      setDiskInfo(d);
      setTail(l.lines || []);
      setError(null);
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  /**
   * Trigger a manual repo sync.  Disabled for viewer-role users.
   * Streams the captured stdout/stderr back inline so operators can
   * see what happened without leaving the page.
   */
  const handleSync = async () => {
    if (!canSync) return;
    setSyncing(true);
    setSyncLog([]);
    try {
      const res = await installer.triggerSync();
      setSyncLog(res.output);
      notifications.show({
        title: res.success ? 'Sync complete' : 'Sync finished with errors',
        message: res.success
          ? 'Mirror is up to date'
          : `Exit code ${res.exit_code} -- check the log for details`,
        color: res.success ? 'green' : 'orange',
      });
      // Refresh info regardless of success so disk usage / status
      // numbers reflect whatever did get downloaded.
      await refresh();
    } catch (e: any) {
      notifications.show({
        title: 'Sync failed to start',
        message: e.message || String(e),
        color: 'red',
      });
    } finally {
      setSyncing(false);
    }
  };

  // Loading / error short-circuits ------------------------------------------
  if (loading) {
    return <Center h={300}><Loader size="lg" /></Center>;
  }
  if (error) {
    return (
      <Stack>
        <Title order={2}>Installer</Title>
        <Alert color="red" icon={<IconAlertCircle size={16} />} title="Could not load installer info">
          {error}
        </Alert>
      </Stack>
    );
  }
  if (!info) {
    return null;
  }

  const lastSync = info.last_sync_utc
    ? new Date(info.last_sync_utc).toLocaleString()
    : 'never';
  const lastSyncBadge = info.last_sync_utc
    ? (info.last_sync_result?.startsWith('success')
        ? <Badge color="green" size="sm">success</Badge>
        : <Badge color="orange" size="sm">{info.last_sync_result || 'partial'}</Badge>)
    : <Badge color="gray" size="sm">never run</Badge>;

  return (
    <Stack>
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={2}>OpenVox Agent Installer</Title>
          <Text c="dimmed" size="sm">
            Bootstrap OpenVox agents from this server using the same one-liner pattern Puppet Enterprise uses.
            Packages are mirrored locally from{' '}
            <Anchor href="https://yum.voxpupuli.org" target="_blank" rel="noopener">yum.voxpupuli.org</Anchor>,{' '}
            <Anchor href="https://apt.voxpupuli.org" target="_blank" rel="noopener">apt.voxpupuli.org</Anchor>,{' '}
            and{' '}
            <Anchor href="https://downloads.voxpupuli.org" target="_blank" rel="noopener">downloads.voxpupuli.org</Anchor>.
          </Text>
        </div>
        <Group gap="xs">
          <Tooltip label="Reload status">
            <ActionIcon variant="subtle" onClick={refresh}>
              <IconRefresh size={18} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      {/* ── Install commands (the headline feature) ───────────────── */}
      <Card withBorder shadow="sm">
        <Group justify="space-between" mb="xs">
          <Group gap="xs">
            <IconDownload size={20} />
            <Title order={4}>Install commands</Title>
          </Group>
          <Group gap="xs">
            <Text size="xs" c="dimmed">Server:</Text>
            <Code>{info.puppet_server}:{info.puppet_port}</Code>
          </Group>
        </Group>

        <Tabs value={activeTab} onChange={setActiveTab}>
          <Tabs.List>
            <Tabs.Tab value="linux"   leftSection={<IconBrandUbuntu size={14} />}>Linux (RHEL / Debian / Ubuntu)</Tabs.Tab>
            <Tabs.Tab value="windows" leftSection={<IconBrandWindows size={14} />}>Windows</Tabs.Tab>
            <Tabs.Tab value="urls"    leftSection={<IconExternalLink size={14} />}>Direct URLs</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="linux" pt="md">
            <CommandBlock
              title="Run as root on the agent host"
              icon={<IconBrandUbuntu size={18} />}
              helper="Detects the platform automatically, configures the local OpenVox repo, installs openvox-agent, and points puppet.conf at this server."
              command={info.linux_command}
            />
          </Tabs.Panel>

          <Tabs.Panel value="windows" pt="md">
            <CommandBlock
              title="Run in an elevated PowerShell prompt"
              icon={<IconBrandWindows size={18} />}
              helper="Downloads install.ps1 from this server, then installs openvox-agent.msi and configures puppet.conf."
              command={info.windows_command}
            />
          </Tabs.Panel>

          <Tabs.Panel value="urls" pt="md">
            <Stack gap="xs">
              <Group justify="space-between">
                <Text size="sm" fw={600}>Linux installer:</Text>
                <Group gap="xs">
                  <Code>{info.install_url_linux}</Code>
                  <CopyButton value={info.install_url_linux}>
                    {({ copied, copy }) => (
                      <ActionIcon size="sm" variant="subtle" onClick={copy}>
                        {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                      </ActionIcon>
                    )}
                  </CopyButton>
                </Group>
              </Group>
              <Group justify="space-between">
                <Text size="sm" fw={600}>Windows installer:</Text>
                <Group gap="xs">
                  <Code>{info.install_url_win}</Code>
                  <CopyButton value={info.install_url_win}>
                    {({ copied, copy }) => (
                      <ActionIcon size="sm" variant="subtle" onClick={copy}>
                        {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                      </ActionIcon>
                    )}
                  </CopyButton>
                </Group>
              </Group>
              <Group justify="space-between">
                <Text size="sm" fw={600}>Mirror root:</Text>
                <Group gap="xs">
                  <Code>{info.pkg_repo_url}</Code>
                  <CopyButton value={info.pkg_repo_url}>
                    {({ copied, copy }) => (
                      <ActionIcon size="sm" variant="subtle" onClick={copy}>
                        {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                      </ActionIcon>
                    )}
                  </CopyButton>
                </Group>
              </Group>
              <Divider my="xs" />
              <Text size="xs" c="dimmed">
                These URLs use port 8140 (the standard puppetserver port) so existing
                firewall rules already permit the traffic. The puppetserver static-content
                mount installed by openvox-gui serves /packages/* directly from{' '}
                <Code>{info.pkg_repo_dir}</Code>.
              </Text>
            </Stack>
          </Tabs.Panel>
        </Tabs>
      </Card>

      {/* ── Mirror status ─────────────────────────────────────────── */}
      <Grid>
        <Grid.Col span={{ base: 12, md: 8 }}>
          <Card withBorder shadow="sm" h="100%">
            <Group justify="space-between" mb="md">
              <Group gap="xs">
                <IconCloudDownload size={20} />
                <Title order={4}>Mirror status</Title>
              </Group>
              <Group gap="xs">
                {info.sync_in_progress && (
                  <Badge color="blue" leftSection={<Loader size={10} color="white" />}>
                    Sync in progress
                  </Badge>
                )}
                <Button
                  size="xs"
                  variant="filled"
                  color="blue"
                  leftSection={<IconRefresh size={14} />}
                  onClick={handleSync}
                  loading={syncing}
                  disabled={!canSync || info.sync_in_progress}
                  title={canSync ? '' : 'Requires admin or operator role'}
                >
                  Sync now
                </Button>
              </Group>
            </Group>

            <Grid gutter="xs">
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <Stack gap={4}>
                  <Group gap="xs"><IconClock size={14} /><Text size="sm" fw={600}>Last sync</Text></Group>
                  <Text size="sm">{lastSync}</Text>
                  {lastSyncBadge}
                </Stack>
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <Stack gap={4}>
                  <Group gap="xs"><IconServer size={14} /><Text size="sm" fw={600}>Mirror size</Text></Group>
                  <Text size="sm">{formatBytes(info.total_bytes)}</Text>
                  <Text size="xs" c="dimmed">at {info.pkg_repo_dir}</Text>
                </Stack>
              </Grid.Col>
            </Grid>

            <Divider my="md" />

            <Text size="sm" fw={600} mb="xs">Per-platform breakdown</Text>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Platform</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Packages</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Size</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {info.platforms.map((p) => (
                  <Table.Tr key={p.platform}>
                    <Table.Td>
                      <Group gap="xs">
                        {platformIcon(p.platform)}
                        <Text fw={500} tt="capitalize">{p.platform}</Text>
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      {p.present
                        ? <Badge color="green" size="sm">mirrored</Badge>
                        : <Badge color="gray"  size="sm">not yet synced</Badge>}
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      {p.present ? p.packages.toLocaleString() : '-'}
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      {p.present ? formatBytes(p.bytes) : '-'}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 4 }}>
          <Card withBorder shadow="sm" h="100%">
            <Group gap="xs" mb="md">
              <IconFolder size={20} />
              <Title order={4}>Disk space</Title>
            </Group>
            {diskInfo ? (
              <Stack gap="xs">
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">Free</Text>
                  <Text size="sm" fw={600}>{formatBytes(diskInfo.free)}</Text>
                </Group>
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">Used</Text>
                  <Text size="sm">{formatBytes(diskInfo.used)}</Text>
                </Group>
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">Total</Text>
                  <Text size="sm">{formatBytes(diskInfo.total)}</Text>
                </Group>
                <Progress
                  value={diskInfo.used_pct}
                  color={diskInfo.used_pct > 90 ? 'red'
                       : diskInfo.used_pct > 75 ? 'orange'
                       : 'blue'}
                />
                <Text size="xs" c="dimmed" ta="right">{diskInfo.used_pct}% used</Text>
                {diskInfo.used_pct > 90 && (
                  <Alert color="red" icon={<IconAlertCircle size={14} />} p="xs">
                    Disk almost full -- next sync may fail.
                  </Alert>
                )}
              </Stack>
            ) : (
              <Text size="sm" c="dimmed">Disk info unavailable.</Text>
            )}
            <Divider my="md" />
            <Text size="xs" c="dimmed">
              Nightly sync runs at 02:30 local time via systemd timer
              (<Code>openvox-repo-sync.timer</Code>).
            </Text>
          </Card>
        </Grid.Col>
      </Grid>

      {/* ── Sync log / tail ───────────────────────────────────────── */}
      <Card withBorder shadow="sm">
        <Group justify="space-between" mb="xs">
          <Group gap="xs">
            <IconClipboard size={20} />
            <Title order={4}>Sync log</Title>
          </Group>
          <Text size="xs" c="dimmed">
            tail of /opt/openvox-gui/logs/repo-sync.log
          </Text>
        </Group>
        {/* If we just ran a manual sync, show its captured output;
            otherwise show the persistent file tail. */}
        <ScrollArea h={240} type="auto">
          <Code block style={{ whiteSpace: 'pre', fontSize: 11 }}>
            {(syncLog.length ? syncLog : tail).join('\n') || '(no log entries yet)'}
          </Code>
        </ScrollArea>
      </Card>
    </Stack>
  );
}
