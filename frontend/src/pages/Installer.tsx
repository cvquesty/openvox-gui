/**
 * OpenVox GUI - Installer.tsx
 *
 * Lives under Infrastructure -> Agent Install. Surfaces three things
 * an operator needs in one place to bring a new node into the fleet:
 *
 *   1. The copy-to-clipboard install one-liner for Linux and Windows
 *      (the headline feature -- replicates Puppet Enterprise's
 *      "install agents" workflow but pointed at the OpenVox mirror).
 *   2. The state of the local OpenVox package mirror at
 *      /opt/openvox-pkgs/ (per-platform breakdown, last-sync time,
 *      disk usage) and a manual "Sync now" trigger.
 *   3. The list of pending certificate signing requests waiting to
 *      be approved -- moved here from Certificate Authority in
 *      3.3.5-20 because CSR approval is part of the agent-bring-up
 *      workflow, not part of CA maintenance.
 *
 * Layout (3.3.5-20):
 *   - Header
 *   - "Install Commands" Card with Tabs:
 *       Linux | Windows | Direct URLs | Mirror Status | Sync Log
 *   - "Pending Certificate Requests" Card
 *
 * Backend contract: /api/installer/{info,sync,log,diskinfo,files}
 *                   /api/certificates/{list,sign,clean}
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Title, Card, Stack, Group, Text, Button, Alert, Loader, Center,
  Table, Badge, Code, ScrollArea, Grid, Divider, Tabs, Checkbox,
  CopyButton, ActionIcon, Tooltip, Progress, Anchor, SimpleGrid,
  Box,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconDownload, IconRefresh, IconCheck, IconCopy, IconBrandWindows,
  IconBrandUbuntu, IconBrandRedhat, IconBrandDebian, IconBrandApple,
  IconAlertCircle, IconCloudDownload, IconClipboard, IconFolder,
  IconExternalLink, IconClock, IconServer, IconCertificate, IconTrash,
  IconDeviceFloppy, IconPackage,
} from '@tabler/icons-react';
import {
  installer, certificates,
  InstallerInfo, InstallerDiskInfo,
  UpstreamInfo, UpstreamFamily, MirrorSelections,
} from '../services/api';
import { useAuth } from '../hooks/AuthContext';

/**
 * Format a byte count as a human-friendly string (B / KB / MB / GB / TB).
 * Binary units (1024-based) -- matches what most disk-management tools show.
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
 * Pick a Tabler icon + display label for a mirror directory name.
 * 3.3.5-2+: layout uses upstream-source names (yum, apt, ...) rather
 * than per-OS-family names; the display labels keep the table
 * understandable to operators who think in OS terms.
 */
function platformIcon(name: string) {
  switch (name) {
    case 'yum':     return <IconBrandRedhat size={18} />;
    case 'apt':     return <IconBrandDebian size={18} />;
    case 'windows': return <IconBrandWindows size={18} />;
    case 'mac':     return <IconBrandApple size={18} />;
    default:        return <IconFolder size={18} />;
  }
}

function platformLabel(name: string): string {
  switch (name) {
    case 'yum':     return 'yum (RHEL family)';
    case 'apt':     return 'apt (Debian + Ubuntu)';
    case 'windows': return 'windows';
    case 'mac':     return 'macOS';
    default:        return name;
  }
}

/**
 * Render a copy-able command snippet inside a styled Card. Mantine's
 * CopyButton handles the clipboard interaction; we just style chrome.
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
      {/* Long commands (Windows one-liner is ~250 chars) need horizontal
          scroll so the Card doesn't overflow on narrow viewports. */}
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

  // Pending CSRs (moved here from Certificate Authority in 3.3.5-20).
  const [pendingCerts, setPendingCerts] = useState<any[]>([]);
  const [pendingCertsErr, setPendingCertsErr] = useState<string | null>(null);

  // Distribution selector state
  const [upstream, setUpstream]           = useState<UpstreamInfo | null>(null);
  const [savedSelections, setSavedSelections] = useState<MirrorSelections>({ openvox_versions: ['8'], distributions: [] });
  const [draftVersions, setDraftVersions]     = useState<string[]>(['8']);
  const [draftDists, setDraftDists]           = useState<string[]>([]);
  const [savingSelections, setSavingSelections] = useState(false);

  // Operators and admins can trigger syncs and sign certs; viewers cannot.
  const canManage = user && (user.role === 'admin' || user.role === 'operator');

  /**
   * Fetch installer info + disk info + log tail + pending certs in parallel.
   * Called on mount and after each manual sync or cert action.
   */
  const refresh = useCallback(async () => {
    try {
      const [i, d, l, c, u, s] = await Promise.all([
        installer.getInfo(),
        installer.getDiskInfo().catch(() => null),
        installer.getLog(50).catch(() => ({ lines: [] as string[] })),
        certificates.list().catch((e: any) => ({ requested: [], _err: e?.message })),
        installer.getUpstream().catch(() => null),
        installer.getSelections().catch(() => ({ openvox_versions: ['8'], distributions: [] } as MirrorSelections)),
      ]);
      setInfo(i);
      setDiskInfo(d);
      setTail(l.lines || []);
      setPendingCerts((c as any).requested || []);
      setPendingCertsErr((c as any)._err || null);
      if (u) setUpstream(u);
      setSavedSelections(s);
      setDraftVersions(s.openvox_versions);
      setDraftDists(s.distributions);
      setError(null);
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  /**
   * Trigger a manual repo sync. Disabled for viewer-role users.
   * Streams captured stdout/stderr back inline so operators can see
   * what happened without leaving the page.
   */
  const handleSync = async () => {
    if (!canManage) return;
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
      // Switch to the Sync Log tab so the captured output is immediately
      // visible (most useful UX after a manual sync).
      setActiveTab('synclog');
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

  /**
   * Sign a pending CSR. Operator/admin only. Confirms via window dialog
   * to match the existing pattern from the old Certificates.tsx code.
   */
  const handleSignCert = async (certname: string) => {
    if (!canManage) return;
    if (!confirm(`Sign certificate for "${certname}"?`)) return;
    try {
      await certificates.sign(certname);
      notifications.show({
        title: 'Signed',
        message: `Certificate signed for ${certname}`,
        color: 'green',
      });
      await refresh();
    } catch (e: any) {
      notifications.show({
        title: 'Sign failed',
        message: e.message || String(e),
        color: 'red',
      });
    }
  };

  /**
   * Reject a pending CSR by cleaning it. Operator/admin only.
   */
  const handleRejectCert = async (certname: string) => {
    if (!canManage) return;
    if (!confirm(`Reject (clean) certificate request for "${certname}"?`)) return;
    try {
      await certificates.clean(certname);
      notifications.show({
        title: 'Rejected',
        message: `Certificate request for ${certname} cleaned`,
        color: 'yellow',
      });
      await refresh();
    } catch (e: any) {
      notifications.show({
        title: 'Reject failed',
        message: e.message || String(e),
        color: 'red',
      });
    }
  };

  // ── Distribution selection helpers ──────────────────────────────────────
  const hasDraftChanges =
    JSON.stringify([...draftVersions].sort()) !== JSON.stringify([...savedSelections.openvox_versions].sort()) ||
    JSON.stringify([...draftDists].sort()) !== JSON.stringify([...savedSelections.distributions].sort());

  const draftAdded = draftDists.filter(d => !savedSelections.distributions.includes(d));
  const draftRemoved = savedSelections.distributions.filter(d => !draftDists.includes(d));

  const toggleVersion = (ver: string) => {
    setDraftVersions(prev =>
      prev.includes(ver) ? prev.filter(v => v !== ver) : [...prev, ver],
    );
  };

  const toggleDist = (key: string) => {
    setDraftDists(prev =>
      prev.includes(key) ? prev.filter(d => d !== key) : [...prev, key],
    );
  };

  const handleSaveSelections = async () => {
    if (!canManage || !hasDraftChanges) return;
    setSavingSelections(true);
    try {
      const res = await installer.saveSelections({
        openvox_versions: draftVersions,
        distributions: draftDists,
      });
      notifications.show({
        title: 'Selections updated',
        message: res.message,
        color: 'green',
      });
      await refresh();
    } catch (e: any) {
      notifications.show({
        title: 'Failed to update selections',
        message: e.message || String(e),
        color: 'red',
      });
    } finally {
      setSavingSelections(false);
    }
  };

  /**
   * Build a distribution key from family + release for the selection model.
   * YUM families: "el/9", "amazon/2023", etc.
   * APT families: "debian/debian12", "ubuntu/ubuntu24.04"
   * Downloads: "windows/windows", "mac/mac"
   */
  const distKey = (family: UpstreamFamily, releaseId: string): string => {
    if (family.repo_type === 'apt' || family.repo_type === 'downloads') {
      return `${family.id}/${releaseId}`;
    }
    return `${family.id}/${releaseId}`;
  };

  // Loading / error short-circuits ------------------------------------------
  if (loading) {
    return <Center h={300}><Loader size="lg" /></Center>;
  }
  if (error) {
    return (
      <Stack>
        <Title order={2}>Agent Install</Title>
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

      {/* ── Install commands + mirror status (folded into one tabbed Card) ── */}
      <Card withBorder shadow="sm">
        <Group justify="space-between" mb="xs">
          <Group gap="xs">
            <IconDownload size={20} />
            <Title order={4}>Install Commands</Title>
          </Group>
          <Group gap="xs">
            {info.sync_in_progress && (
              <Badge color="blue" leftSection={<Loader size={10} color="white" />}>
                Sync in progress
              </Badge>
            )}
            <Text size="xs" c="dimmed">Server:</Text>
            <Code>{info.puppet_server}:{info.puppet_port}</Code>
            <Button
              size="xs"
              variant="filled"
              color="blue"
              leftSection={<IconRefresh size={14} />}
              onClick={handleSync}
              loading={syncing}
              disabled={!canManage || info.sync_in_progress}
              title={canManage ? '' : 'Requires admin or operator role'}
            >
              Sync now
            </Button>
          </Group>
        </Group>

        <Tabs value={activeTab} onChange={setActiveTab}>
          <Tabs.List>
            <Tabs.Tab value="linux"   leftSection={<IconBrandUbuntu size={14} />}>Linux (RHEL / Debian / Ubuntu)</Tabs.Tab>
            <Tabs.Tab value="windows" leftSection={<IconBrandWindows size={14} />}>Windows</Tabs.Tab>
            <Tabs.Tab value="urls"    leftSection={<IconExternalLink size={14} />}>Direct URLs</Tabs.Tab>
            <Tabs.Tab value="mirror"  leftSection={<IconCloudDownload size={14} />}>Mirror</Tabs.Tab>
            <Tabs.Tab value="synclog" leftSection={<IconClipboard size={14} />}>Sync Log</Tabs.Tab>
          </Tabs.List>

          {/* ── Linux one-liner ──────────────────────────────────────── */}
          <Tabs.Panel value="linux" pt="md">
            <CommandBlock
              title="Run as root on the agent host"
              icon={<IconBrandUbuntu size={18} />}
              helper="Detects the platform automatically, configures the local OpenVox repo, installs openvox-agent, and points puppet.conf at this server."
              command={info.linux_command}
            />
          </Tabs.Panel>

          {/* ── Windows one-liner ────────────────────────────────────── */}
          <Tabs.Panel value="windows" pt="md">
            <CommandBlock
              title="Run in an elevated PowerShell prompt"
              icon={<IconBrandWindows size={18} />}
              helper="Downloads install.ps1 from this server, then installs openvox-agent.msi and configures puppet.conf."
              command={info.windows_command}
            />
          </Tabs.Panel>

          {/* ── Direct URLs ──────────────────────────────────────────── */}
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

          {/* ── Mirror (status on top, distribution selector below) ── */}
          <Tabs.Panel value="mirror" pt="md">
            <Stack gap="md">

              {/* ── Panel 1: Mirror Status ────────────────────────────── */}
              <Card withBorder p="md">
                <Group gap="xs" mb="sm">
                  <IconCloudDownload size={18} />
                  <Text fw={700} size="sm">Mirror Status</Text>
                </Group>
                <Grid gutter="md">
                  <Grid.Col span={{ base: 12, md: 8 }}>
                    <Stack gap="xs">
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

                      <Divider my="xs" />

                      <Text size="sm" fw={600}>Per-platform breakdown</Text>
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
                                  <Text fw={500}>{platformLabel(p.platform)}</Text>
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
                    </Stack>
                  </Grid.Col>

                  <Grid.Col span={{ base: 12, md: 4 }}>
                    <Stack gap="xs">
                      <Group gap="xs">
                        <IconFolder size={16} />
                        <Text size="sm" fw={600}>Disk space</Text>
                      </Group>
                      {diskInfo ? (
                        <>
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
                        </>
                      ) : (
                        <Text size="sm" c="dimmed">Disk info unavailable.</Text>
                      )}
                      <Divider my="xs" />
                      <Text size="xs" c="dimmed">
                        Nightly sync runs at 02:30 local time via systemd timer
                        (<Code>openvox-repo-sync.timer</Code>).
                      </Text>
                    </Stack>
                  </Grid.Col>
                </Grid>
              </Card>

              {/* ── Panel 2: Distribution Support ─────────────────────── */}
              <Card withBorder p="md">
                <Group justify="space-between" mb="sm">
                  <Group gap="xs">
                    <IconPackage size={18} />
                    <Text fw={700} size="sm">Distribution Support</Text>
                  </Group>
                  <Group gap="xs">
                    {hasDraftChanges && (
                      <Badge color="yellow" size="sm" variant="light">
                        {draftAdded.length > 0 && `+${draftAdded.length}`}
                        {draftAdded.length > 0 && draftRemoved.length > 0 && ' / '}
                        {draftRemoved.length > 0 && `-${draftRemoved.length}`}
                        {' unsaved'}
                      </Badge>
                    )}
                    <Button
                      size="xs"
                      variant="filled"
                      color="blue"
                      leftSection={<IconDeviceFloppy size={14} />}
                      onClick={handleSaveSelections}
                      loading={savingSelections}
                      disabled={!canManage || !hasDraftChanges || draftVersions.length === 0}
                      title={!canManage ? 'Requires admin or operator role' : ''}
                    >
                      Apply Changes
                    </Button>
                  </Group>
                </Group>
                <Text size="xs" c="dimmed" mb="sm">
                  Select which distributions to mirror locally. Selecting a distribution downloads its
                  packages; deselecting removes them from disk to save space.
                </Text>

                {/* OpenVox version toggles */}
                <Group gap="lg" mb="md">
                  <Text size="sm" fw={600}>OpenVox Versions:</Text>
                  {(upstream?.openvox_versions || ['7', '8']).map(ver => (
                    <Checkbox
                      key={ver}
                      label={`OpenVox ${ver}`}
                      checked={draftVersions.includes(ver)}
                      onChange={() => toggleVersion(ver)}
                      disabled={!canManage}
                    />
                  ))}
                </Group>

                {upstream ? (
                  <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="lg">
                    {upstream.families.map(family => (
                      <Box key={family.id}>
                        <Text size="sm" fw={600} mb={4}>{family.label}</Text>
                        <Stack gap={4}>
                          {family.releases.map(rel => {
                            const key = distKey(family, rel.id);
                            const available = rel.openvox_versions.some(v =>
                              draftVersions.includes(v),
                            );
                            return (
                              <Checkbox
                                key={key}
                                label={
                                  <Group gap={4}>
                                    <Text size="sm">{rel.label}</Text>
                                    {rel.openvox_versions.length > 0 && (
                                      <Text size="xs" c="dimmed">
                                        (v{rel.openvox_versions.join(', v')})
                                      </Text>
                                    )}
                                  </Group>
                                }
                                checked={draftDists.includes(key)}
                                onChange={() => toggleDist(key)}
                                disabled={!canManage || !available}
                              />
                            );
                          })}
                        </Stack>
                      </Box>
                    ))}
                  </SimpleGrid>
                ) : (
                  <Center py="md">
                    <Group gap="xs">
                      <Loader size="sm" />
                      <Text size="sm" c="dimmed">Discovering available distributions...</Text>
                    </Group>
                  </Center>
                )}
              </Card>

            </Stack>
          </Tabs.Panel>

          {/* ── Sync Log (3.3.5-20: folded in from standalone card) ──── */}
          <Tabs.Panel value="synclog" pt="md">
            <Group justify="space-between" mb="xs">
              <Text size="sm" fw={600}>Most recent sync output</Text>
              <Text size="xs" c="dimmed">tail of /opt/openvox-gui/logs/repo-sync.log</Text>
            </Group>
            <ScrollArea h={320} type="auto">
              <Code block style={{ whiteSpace: 'pre', fontSize: 11 }}>
                {(syncLog.length ? syncLog : tail).join('\n') || '(no log entries yet)'}
              </Code>
            </ScrollArea>
          </Tabs.Panel>
        </Tabs>
      </Card>

      {/* ── Pending Certificate Requests (moved from Certificate Authority,
             3.3.5-20). Sits with Install Commands because CSR approval is
             part of agent bring-up: install agent → agent generates CSR →
             operator signs here → first puppet run succeeds. ─────────── */}
      <Card withBorder shadow="sm">
        <Group justify="space-between" mb="xs">
          <Group gap="xs">
            <IconCertificate size={20} />
            <Title order={4}>Pending Certificate Requests</Title>
            <Badge color={pendingCerts.length > 0 ? 'yellow' : 'green'}>
              {pendingCerts.length}
            </Badge>
          </Group>
          <Text size="xs" c="dimmed">
            Approve agents that have just installed and submitted their CSR
          </Text>
        </Group>
        {pendingCertsErr ? (
          <Alert color="orange" icon={<IconAlertCircle size={14} />}>
            Could not load CSR list: {pendingCertsErr}
          </Alert>
        ) : pendingCerts.length === 0 ? (
          <Text c="dimmed" ta="center" py="lg" size="sm">
            No pending certificate requests. Newly installed agents that have
            checked in for the first time will appear here, ready to sign.
          </Text>
        ) : (
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Certname</Table.Th>
                <Table.Th>Fingerprint</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {pendingCerts.map((cert: any) => (
                <Table.Tr key={cert.name}>
                  <Table.Td><Text fw={500}>{cert.name}</Text></Table.Td>
                  <Table.Td><Code>{cert.fingerprint || 'N/A'}</Code></Table.Td>
                  <Table.Td>
                    <Group gap="xs" justify="flex-end">
                      <Button
                        size="xs"
                        color="green"
                        leftSection={<IconCheck size={14} />}
                        onClick={() => handleSignCert(cert.name)}
                        disabled={!canManage}
                        title={canManage ? '' : 'Requires admin or operator role'}
                      >
                        Sign
                      </Button>
                      <Button
                        size="xs"
                        color="red"
                        variant="outline"
                        leftSection={<IconTrash size={14} />}
                        onClick={() => handleRejectCert(cert.name)}
                        disabled={!canManage}
                        title={canManage ? '' : 'Requires admin or operator role'}
                      >
                        Reject
                      </Button>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Card>
    </Stack>
  );
}
