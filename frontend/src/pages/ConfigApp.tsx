/**
 * OpenVox GUI - ConfigApp.tsx
 * 
 * Component documentation to be expanded.
 */
import { useState, useCallback, useEffect } from 'react';
import {
  Title, Loader, Center, Alert, Card, Stack, Text, Code, Table, Badge, Group,
  Tabs, TextInput, Textarea, PasswordInput, Select, ActionIcon, Modal, Tooltip, Button,
  Grid, SegmentedControl, Switch, Divider, Accordion, Collapse, ScrollArea,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconSettings, IconUsers, IconPlus, IconTrash, IconKey, IconShield,
  IconEdit, IconDeviceFloppy, IconX, IconRefresh, IconServer,
  IconPlugConnected, IconTestPipe, IconLock, IconWorld,
  IconSwitchHorizontal,
} from '@tabler/icons-react';
import { useApi } from '../hooks/useApi';
import { config, users, ldap } from '../services/api';
import { useAuth } from '../hooks/AuthContext';
import { useAppTheme } from '../hooks/ThemeContext';
import { StatusBadge } from '../components/StatusBadge';
import { ConfirmModal } from '../components/ConfirmModal';
import { ConfigSSLPage } from './ConfigSSL';

/* ────────────────────── Types ────────────────────── */
interface User {
  username: string;
  role: string;
  auth_source?: string;
}

const roleBadgeColor: Record<string, string> = {
  admin: 'red',
  operator: 'blue',
  certops: 'orange',
  viewer: 'gray',
};

const ROLE_SELECT_DATA = [
  { value: 'admin', label: 'Admin — Full access' },
  { value: 'operator', label: 'Operator — Deploy & manage' },
  { value: 'certops', label: 'Certops — View + clean agent certs' },
  { value: 'viewer', label: 'Viewer — Read only' },
];

const authSourceColor: Record<string, string> = {
  local: 'cyan',
  ldap: 'grape',
};

/* ── People Processing Machine SVG (unchanged) ──────────── */
function PeopleProcessingMachine() {
  return (
    <svg viewBox="0 0 500 320" width="100%" style={{ maxHeight: 360 }}>
      <defs>
        <linearGradient id="pm-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1a1b2e" />
          <stop offset="100%" stopColor="#252540" />
        </linearGradient>
        <linearGradient id="pm-machine" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#556677" />
          <stop offset="100%" stopColor="#3d4d5d" />
        </linearGradient>
      </defs>
      <rect width="500" height="320" fill="url(#pm-sky)" rx="8" />
      <rect x="0" y="260" width="500" height="60" fill="#1a1a2e" />
      <rect x="0" y="260" width="500" height="2" fill="#333355" />
      <rect x="30" y="240" width="440" height="12" fill="#334455" rx="6" />
      <circle cx="50" cy="246" r="5" fill="#445566" stroke="#556677" strokeWidth="1">
        <animateTransform attributeName="transform" type="rotate" values="0 50 246;360 50 246" dur="2s" repeatCount="indefinite" />
      </circle>
      <circle cx="450" cy="246" r="5" fill="#445566" stroke="#556677" strokeWidth="1">
        <animateTransform attributeName="transform" type="rotate" values="0 450 246;360 450 246" dur="2s" repeatCount="indefinite" />
      </circle>
      <circle r="2" fill="#556677"><animateMotion dur="4s" repeatCount="indefinite" path="M30,246 L470,246" /></circle>
      <circle r="2" fill="#556677"><animateMotion dur="4s" repeatCount="indefinite" path="M30,246 L470,246" begin="2s" /></circle>
      <g><animateMotion dur="6s" repeatCount="indefinite" path="M0,0 L80,0" />
        <circle cx="55" cy="208" r="8" fill="none" stroke="#aabbcc" strokeWidth="2" />
        <line x1="55" y1="216" x2="55" y2="232" stroke="#aabbcc" strokeWidth="2" />
        <line x1="55" y1="222" x2="45" y2="228" stroke="#aabbcc" strokeWidth="2" />
        <line x1="55" y1="222" x2="65" y2="228" stroke="#aabbcc" strokeWidth="2" />
        <line x1="55" y1="232" x2="48" y2="242" stroke="#aabbcc" strokeWidth="2" />
        <line x1="55" y1="232" x2="62" y2="242" stroke="#aabbcc" strokeWidth="2" />
        <text x="67" y="206" fill="#ffaa44" fontSize="14" fontWeight="bold">?</text>
      </g>
      <g><animateMotion dur="6s" repeatCount="indefinite" path="M0,0 L80,0" begin="3s" />
        <circle cx="100" cy="208" r="8" fill="none" stroke="#ccbbaa" strokeWidth="2" />
        <line x1="100" y1="216" x2="100" y2="232" stroke="#ccbbaa" strokeWidth="2" />
        <line x1="100" y1="222" x2="90" y2="228" stroke="#ccbbaa" strokeWidth="2" />
        <line x1="100" y1="222" x2="110" y2="228" stroke="#ccbbaa" strokeWidth="2" />
        <line x1="100" y1="232" x2="93" y2="242" stroke="#ccbbaa" strokeWidth="2" />
        <line x1="100" y1="232" x2="107" y2="242" stroke="#ccbbaa" strokeWidth="2" />
        <text x="112" y="206" fill="#ff6644" fontSize="14" fontWeight="bold">!</text>
      </g>
      <rect x="175" y="120" width="150" height="128" fill="url(#pm-machine)" rx="6" stroke="#7788aa" strokeWidth="1.5" />
      <polygon points="210,120 290,120 270,95 230,95" fill="#667788" stroke="#7788aa" strokeWidth="1" />
      <text x="250" y="113" textAnchor="middle" fill="#aabbcc" fontSize="7" fontFamily="monospace">INPUT</text>
      <rect x="195" y="140" width="110" height="22" fill="#334455" rx="3" />
      <text x="250" y="155" textAnchor="middle" fill="#44aaff" fontSize="9" fontFamily="monospace" fontWeight="bold">USER-O-MATIC 3000</text>
      <circle cx="215" cy="180" r="14" fill="none" stroke="#88aacc" strokeWidth="2" strokeDasharray="4 3">
        <animateTransform attributeName="transform" type="rotate" values="0 215 180;360 215 180" dur="3s" repeatCount="indefinite" />
      </circle>
      <circle cx="285" cy="180" r="14" fill="none" stroke="#88aacc" strokeWidth="2" strokeDasharray="4 3">
        <animateTransform attributeName="transform" type="rotate" values="360 285 180;0 285 180" dur="3s" repeatCount="indefinite" />
      </circle>
      <circle cx="195" cy="210" r="4" fill="#44ff44"><animate attributeName="fill" values="#44ff44;#22aa22;#44ff44" dur="1.5s" repeatCount="indefinite" /></circle>
      <circle cx="207" cy="210" r="4" fill="#ffaa22" /><circle cx="219" cy="210" r="4" fill="#44aaff" />
      <rect x="290" y="220" width="40" height="12" fill="#556677" rx="2" />
      <text x="310" y="218" textAnchor="middle" fill="#aabbcc" fontSize="7" fontFamily="monospace">OUTPUT</text>
      <g>
        <circle cx="370" cy="208" r="8" fill="none" stroke="#66dd66" strokeWidth="2" />
        <line x1="370" y1="216" x2="370" y2="232" stroke="#66dd66" strokeWidth="2" />
        <line x1="370" y1="222" x2="360" y2="228" stroke="#66dd66" strokeWidth="2" />
        <line x1="370" y1="222" x2="380" y2="228" stroke="#66dd66" strokeWidth="2" />
        <line x1="370" y1="232" x2="364" y2="242" stroke="#66dd66" strokeWidth="2" />
        <line x1="370" y1="232" x2="376" y2="242" stroke="#66dd66" strokeWidth="2" />
        <rect x="358" y="216" width="24" height="8" fill="#ff4444" rx="2" opacity="0.9" />
        <text x="370" y="223" textAnchor="middle" fill="white" fontSize="5" fontFamily="monospace">ADMIN</text>
        <text x="382" y="208" fill="#44ff44" fontSize="10">&#10003;</text>
      </g>
      <g>
        <circle cx="420" cy="208" r="8" fill="none" stroke="#66bbdd" strokeWidth="2" />
        <line x1="420" y1="216" x2="420" y2="232" stroke="#66bbdd" strokeWidth="2" />
        <line x1="420" y1="222" x2="410" y2="228" stroke="#66bbdd" strokeWidth="2" />
        <line x1="420" y1="222" x2="430" y2="228" stroke="#66bbdd" strokeWidth="2" />
        <line x1="420" y1="232" x2="414" y2="242" stroke="#66bbdd" strokeWidth="2" />
        <line x1="420" y1="232" x2="426" y2="242" stroke="#66bbdd" strokeWidth="2" />
        <rect x="410" y="216" width="20" height="8" fill="#4488ff" rx="2" opacity="0.9" />
        <text x="420" y="223" textAnchor="middle" fill="white" fontSize="5" fontFamily="monospace">OPS</text>
      </g>
      <text x="250" y="282" textAnchor="middle" fill="#8899aa" fontSize="11" fontFamily="monospace">The People Processing Machine</text>
      <text x="250" y="298" textAnchor="middle" fill="#556677" fontSize="9" fontFamily="monospace">unsorted humans in &#8594; authorized users out</text>
      <text x="250" y="310" textAnchor="middle" fill="#445566" fontSize="7" fontFamily="monospace">(no humans were harmed in the making of this feature)</text>
    </svg>
  );
}

/* ────────────────────── Application Tab ────────────────────── */
function ApplicationTab({ onSwitchToServices }: { onSwitchToServices: () => void }) {
  const { data, loading, error, refetch } = useApi(config.getApp);
  const { theme: appTheme, setTheme } = useAppTheme();
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  if (loading) return <Center h={300}><Loader size="xl" /></Center>;
  if (error) return <Alert color="red" title="Error">{error}</Alert>;

  const settingsMeta: Record<string, { label: string; description: string; editable: boolean; type?: string }> = {
    app_name:            { label: 'Application Name',    description: 'Display name shown in the header and login page', editable: true },
    puppet_server_host:  { label: 'OpenVox Server Host',  description: 'FQDN of the OpenVox Server for API communication', editable: true },
    puppet_server_port:  { label: 'OpenVox Server Port',  description: 'OpenVox Server HTTPS API port (usually 8140)', editable: true, type: 'number' },
    puppet_ca_host:      { label: 'OpenVox CA Host',      description: 'FQDN of the CA (clustered consoles only; empty means same as OpenVox Server Host)', editable: true },
    puppet_ca_port:      { label: 'OpenVox CA Port',      description: 'CA HTTPS API port (usually 8140)', editable: true, type: 'number' },
    puppetdb_host:       { label: 'OpenVox DB Host',      description: 'FQDN of the OpenVoxDB server', editable: true },
    puppetdb_port:       { label: 'OpenVox DB Port',      description: 'OpenVoxDB HTTPS API port (usually 8081)', editable: true, type: 'number' },
    debug:               { label: 'Debug Mode',          description: 'Enable verbose debug logging (restart required)', editable: true, type: 'boolean' },
    skip_adhoc_confirm_dialogs: {
      label: 'Skip ad-hoc run confirms',
      description:
        'When Yes, skip confirmation dialogs for Bolt (command / task / plan), r10k deploy, and Run OpenVox. Destructive actions (purge node, certs, ENC deletes, user delete) always require confirmation. Applies immediately (no restart).',
      editable: true,
      type: 'boolean',
    },
  };

  const HIDDEN_APP_KEYS = new Set(['auth_backend', 'http_proxy', 'https_proxy', 'no_proxy']);
  const entries = data
    ? Object.entries(data).filter(([key]) => !HIDDEN_APP_KEYS.has(key))
    : [];
  // Stable order: known meta keys first (incl. new toggle at bottom of identity/debug block), then any extras
  const metaOrder = Object.keys(settingsMeta);
  entries.sort(([a], [b]) => {
    const ia = metaOrder.indexOf(a);
    const ib = metaOrder.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  const handleEdit = (key: string, currentValue: any) => {
    setEditing((prev) => ({ ...prev, [key]: String(currentValue) }));
  };
  const handleCancel = (key: string) => {
    setEditing((prev) => { const next = { ...prev }; delete next[key]; return next; });
  };
  const handleSave = async (key: string) => {
    setSaving(key);
    try {
      await config.updateApp(key, editing[key]);
      const restartHint =
        key === 'skip_adhoc_confirm_dialogs'
          ? 'Applied for this process — reload other tabs if needed.'
          : 'Go to the Services tab to restart.';
      notifications.show({
        title: 'Setting Updated',
        message: `${settingsMeta[key]?.label || key} updated. ${restartHint}`,
        color: 'green',
      });
      handleCancel(key);
      refetch();
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    } finally { setSaving(null); }
  };

  return (
    <Stack>
      <Card withBorder shadow="sm">
        <Group justify="space-between" align="center">
          <div>
            <Text fw={700} mb={4}>Application Theme</Text>
            <Text size="sm" c="dimmed">
              Choose the visual style. <Text span fw={500}>Light</Text> is a clean light theme with blue accents. <Text span fw={500}>Dark</Text> is a clean dark theme with orange accents. <Text span fw={500}>Robots!!</Text> features dark mode with orange accents and animated illustrations.
            </Text>
          </div>
          <SegmentedControl value={appTheme} onChange={(v) => setTheme(v as any)}
            data={[
              { label: 'Light', value: 'light' }, 
              { label: 'Dark', value: 'dark' }, 
              { label: 'Robots!!', value: 'robots' }
            ]} size="md" />
        </Group>
      </Card>
      <Card withBorder shadow="sm">
        <Text fw={700} mb="sm">Application Settings</Text>
        <Text size="xs" c="dimmed" mb="md">Changes are written to the .env configuration file. Some changes require a <Text span size="xs" c="blue" style={{ cursor: 'pointer' }} td="underline" onClick={onSwitchToServices}>service restart</Text> to take effect.</Text>
        <Table striped>
          <Table.Thead><Table.Tr><Table.Th style={{ width: 220 }}>Setting</Table.Th><Table.Th>Value</Table.Th><Table.Th style={{ width: 100, textAlign: 'right' }}>Actions</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>
            {entries.map(([key, value]: [string, any]) => {
              const meta = settingsMeta[key];
              const isEditing = key in editing;
              return (
                <Table.Tr key={key}>
                  <Table.Td><Text size="sm" fw={500}>{meta?.label || key}</Text>{meta?.description && <Text size="xs" c="dimmed">{meta.description}</Text>}</Table.Td>
                  <Table.Td>
                    {isEditing ? (
                      meta?.type === 'boolean' ? (
                        <Select data={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} value={editing[key]}
                          onChange={(v) => setEditing((prev) => ({ ...prev, [key]: v || 'false' }))} size="xs" style={{ maxWidth: 120 }} />
                      ) : (
                        <TextInput value={editing[key]} onChange={(e) => setEditing((prev) => ({ ...prev, [key]: e.currentTarget.value }))}
                          size="xs" style={{ maxWidth: 300 }} type={meta?.type === 'number' ? 'number' : 'text'} />
                      )
                    ) : typeof value === 'boolean' ? (
                      <Badge color={value ? 'green' : 'gray'}>{value ? 'Yes' : 'No'}</Badge>
                    ) : (<Code>{String(value)}</Code>)}
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    {meta?.editable && (isEditing ? (
                      <Group gap={4} justify="flex-end">
                        <ActionIcon size="sm" variant="subtle" color="gray" onClick={() => handleCancel(key)}><IconX size={14} /></ActionIcon>
                        <ActionIcon size="sm" variant="filled" color="green" onClick={() => handleSave(key)} loading={saving === key}><IconDeviceFloppy size={14} /></ActionIcon>
                      </Group>
                    ) : (<ActionIcon size="sm" variant="subtle" onClick={() => handleEdit(key, value)}><IconEdit size={14} /></ActionIcon>))}
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Card>
    </Stack>
  );
}

/* ────────────────────── Cluster health (FQDN APIs + HA) ────────────────────── */
function ClusterHealthPanel({
  members,
  full,
  onRefresh,
}: {
  members: any[];
  full?: any;
  onRefresh: () => void;
}) {
  const ha = full?.ha;
  const summary = full?.summary || {};
  const pcs = ha?.pcs;

  return (
    <Stack>
      <Card withBorder shadow="sm" padding="md">
        <Group justify="space-between" mb="sm">
          <Text fw={700}>Cluster member health (per-FQDN service APIs)</Text>
          <Button variant="subtle" size="xs" leftSection={<IconRefresh size={14} />} onClick={onRefresh}>
            Refresh
          </Button>
        </Group>
        <Text size="xs" c="dimmed" mb="sm">
          Compilers: /status/v1/simple + /status/v1/services on :8140.
          PuppetDB: simple + services + /pdb/meta/v1/version + sample /pdb/query/v4/nodes.
          CA: simple + services + CA certificate endpoint. Probes use host FQDNs, not VIP.
        </Text>
        {summary && (
          <Group gap="md" mb="sm">
            <Badge variant="outline">
              compilers {summary.compilers_healthy ?? '—'}/{summary.compilers_total ?? '—'}
            </Badge>
            <Badge variant="outline">
              puppetdb {summary.puppetdb_healthy ?? '—'}/{summary.puppetdb_total ?? '—'}
            </Badge>
            <Badge variant="outline">
              ca {summary.ca_healthy ?? '—'}/{summary.ca_total ?? '—'}
            </Badge>
            {summary.ha_primary && (
              <Badge color="blue" variant="light">HA primary: {summary.ha_primary}</Badge>
            )}
            {summary.ha_vip_node && (
              <Badge color="cyan" variant="light">VIP on: {summary.ha_vip_node}</Badge>
            )}
          </Group>
        )}
        <Table striped highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>FQDN</Table.Th>
              <Table.Th>Role</Table.Th>
              <Table.Th>Port</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Detail</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(members || []).length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={5}>
                  <Text c="dimmed" size="sm">No members configured — add FQDNs under Settings → Cluster.</Text>
                </Table.Td>
              </Table.Tr>
            ) : (
              members.map((m: any) => (
                <Table.Tr key={`${m.role}-${m.fqdn}`}>
                  <Table.Td><Code>{m.fqdn}</Code></Table.Td>
                  <Table.Td>{m.role}</Table.Td>
                  <Table.Td>{m.port}</Table.Td>
                  <Table.Td>
                    <Badge color={m.healthy ? 'green' : 'red'} variant="light">
                      {m.healthy ? 'healthy' : 'unhealthy'}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">
                      {m.version ? `v${m.version} · ` : ''}
                      {m.error || m.body || (m.http_status != null ? `HTTP ${m.http_status}` : '—')}
                      {m.query_nodes && !m.query_nodes.ok ? ` · query: ${m.query_nodes.error || 'fail'}` : ''}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))
            )}
          </Table.Tbody>
        </Table>
      </Card>

      <Card withBorder shadow="sm" padding="md">
        <Text fw={700} mb="sm">Pacemaker / Corosync / DRBD (CA HA)</Text>
        {!ha ? (
          <Text size="sm" c="dimmed">No HA data yet.</Text>
        ) : (
          <Stack gap="xs">
            <Group gap="sm">
              <Badge color={ha.available ? 'green' : 'gray'} variant="light">
                {ha.available ? 'pcs available' : 'pcs unavailable'}
              </Badge>
              {ha.method && <Text size="xs" c="dimmed">via {ha.method}</Text>}
            </Group>
            {ha.error && <Alert color="orange" variant="light">{ha.error}</Alert>}
            {pcs && (
              <>
                <Text size="sm">
                  <strong>Primary (Promoted):</strong>{' '}
                  {pcs.primary_node || pcs.drbd_promoted || '—'}
                  {' · '}
                  <strong>VIP node:</strong> {pcs.vip_node || '—'}
                </Text>
                <Text size="sm">
                  <strong>Online:</strong> {(pcs.online || []).join(', ') || '—'}
                  {(pcs.offline || []).length > 0 && (
                    <> · <strong>Offline:</strong> {(pcs.offline || []).join(', ')}</>
                  )}
                </Text>
                {pcs.cluster_name && (
                  <Text size="xs" c="dimmed">Cluster name: {pcs.cluster_name}</Text>
                )}
                {(pcs.resources || []).length > 0 && (
                  <Table withTableBorder>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Resource</Table.Th>
                        <Table.Th>State</Table.Th>
                        <Table.Th>Node</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {pcs.resources.map((r: any, i: number) => (
                        <Table.Tr key={`${r.name}-${i}`}>
                          <Table.Td><Code>{r.name}</Code></Table.Td>
                          <Table.Td>
                            <Badge
                              size="sm"
                              color={
                                r.state === 'Promoted' || r.state === 'Started'
                                  ? 'green'
                                  : r.state === 'FAILED'
                                    ? 'red'
                                    : 'gray'
                              }
                            >
                              {r.state}
                            </Badge>
                          </Table.Td>
                          <Table.Td>{r.node}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                )}
                {pcs.raw && (
                  <Accordion variant="contained">
                    <Accordion.Item value="pcs-raw">
                      <Accordion.Control>Raw pcs status</Accordion.Control>
                      <Accordion.Panel>
                        <Code block style={{ maxHeight: 240, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                          {pcs.raw}
                        </Code>
                      </Accordion.Panel>
                    </Accordion.Item>
                  </Accordion>
                )}
              </>
            )}
            {ha.drbd?.raw && (
              <Accordion variant="contained">
                <Accordion.Item value="drbd-raw">
                  <Accordion.Control>Raw drbdadm status</Accordion.Control>
                  <Accordion.Panel>
                    <Code block style={{ maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                      {ha.drbd.raw}
                    </Code>
                  </Accordion.Panel>
                </Accordion.Item>
              </Accordion>
            )}
          </Stack>
        )}
      </Card>
    </Stack>
  );
}

/* ────────────────────── Services Tab ────────────────────── */
function ServicesTab() {
  const { data: servicesPayload, loading, refetch } = useApi(config.getServices);
  const [restarting, setRestarting] = useState<string | null>(null);

  const handleRestart = async (service: string) => {
    setRestarting(service);
    try {
      await config.restartService(service);
      notifications.show({ title: 'Restarting', message: `${service} restart initiated`, color: 'blue' });
      setTimeout(() => { refetch(); setRestarting(null); }, 4000);
    } catch (e: any) {
      notifications.show({ title: 'Error', message: e.message, color: 'red' });
      setRestarting(null);
    }
  };

  if (loading) return <Center h={300}><Loader size="xl" /></Center>;

  // Support both legacy array response and new object shape with cluster_members
  const services: any[] = Array.isArray(servicesPayload)
    ? servicesPayload
    : (servicesPayload?.services || []);
  const deploymentMode = Array.isArray(servicesPayload)
    ? 'single'
    : (servicesPayload?.deployment_mode || 'single');
  const clusterMembers: any[] = Array.isArray(servicesPayload)
    ? []
    : (servicesPayload?.cluster_members || []);

  const puppetServices = services.filter((s: any) => ['puppetserver', 'puppetdb', 'puppet'].includes(s.service));
  const appServices = services.filter((s: any) => s.service === 'openvox-gui');

  return (
    <Stack>
      <Alert variant="light" color="blue">
        Manage all services in the OpenVox ecosystem. Restart individual services or the entire OpenVox stack in the correct dependency order.
        {deploymentMode === 'clustered' && (
          <> Clustered mode: member health checks use each host&apos;s <strong>FQDN</strong> (not VIP).</>
        )}
      </Alert>

      <Card withBorder shadow="sm" padding="md">
        <Text fw={700} mb="sm">OpenVox Infrastructure (this host)</Text>
        <Stack gap="xs">
          {puppetServices.map((svc: any) => (
            <Card key={svc.service} withBorder padding="sm">
              <Group justify="space-between" wrap="nowrap">
                <div>
                  <Text fw={600} size="sm">{svc.service}</Text>
                  <Group gap="xs" mt={4}>
                    <StatusBadge status={svc.status} />
                    {svc.pid && svc.pid !== '0' && <Text size="xs" c="dimmed">PID {svc.pid}</Text>}
                    {svc.since && <Text size="xs" c="dimmed">since {svc.since}</Text>}
                  </Group>
                </div>
                <Button variant="outline" color="orange" size="xs" leftSection={<IconRefresh size={14} />}
                  loading={restarting === svc.service} onClick={() => handleRestart(svc.service)}>
                  Restart
                </Button>
              </Group>
            </Card>
          ))}
        </Stack>
      </Card>

      {deploymentMode === 'clustered' && (
        <ClusterHealthPanel members={clusterMembers} full={servicesPayload?.cluster_health} onRefresh={refetch} />
      )}

      <Card withBorder shadow="sm" padding="md">
        <Text fw={700} mb="sm">Application</Text>
        <Stack gap="xs">
          {appServices.map((svc: any) => (
            <Card key={svc.service} withBorder padding="sm">
              <Group justify="space-between" wrap="nowrap">
                <div>
                  <Text fw={600} size="sm">{svc.service}</Text>
                  <Group gap="xs" mt={4}>
                    <StatusBadge status={svc.status} />
                    {svc.pid && svc.pid !== '0' && <Text size="xs" c="dimmed">PID {svc.pid}</Text>}
                    {svc.since && <Text size="xs" c="dimmed">since {svc.since}</Text>}
                  </Group>
                </div>
                <Button variant="outline" color="orange" size="xs" leftSection={<IconRefresh size={14} />}
                  loading={restarting === svc.service} onClick={() => handleRestart(svc.service)}>
                  Restart
                </Button>
              </Group>
            </Card>
          ))}
        </Stack>
        <Text size="xs" c="dimmed" mt="sm">
          Restarting the OpenVox GUI service will apply any pending configuration changes. The page will briefly disconnect and reconnect automatically.
        </Text>
      </Card>
    </Stack>
  );
}

/* ────────────────────── Cluster / multi-server Tab ────────────────────── */
function ClusterTab() {
  const { data, loading, error, refetch } = useApi(config.getCluster);
  const [mode, setMode] = useState<'single' | 'clustered'>('single');
  const [compilers, setCompilers] = useState('');
  const [puppetdbNodes, setPuppetdbNodes] = useState('');
  const [caNodes, setCaNodes] = useState('');
  const [caVips, setCaVips] = useState('');
  const [infraVips, setInfraVips] = useState('');
  const [dnsRrVips, setDnsRrVips] = useState('');
  const [fleetExclude, setFleetExclude] = useState('');
  const [deployTargets, setDeployTargets] = useState('');
  const [consoles, setConsoles] = useState('');
  const [vipHosts, setVipHosts] = useState('');
  const [dbBackend, setDbBackend] = useState<'sqlite' | 'postgresql'>('sqlite');
  const [encUrls, setEncUrls] = useState('');
  const [databaseUrl, setDatabaseUrl] = useState('');
  const [sharedSecret, setSharedSecret] = useState('');
  const [secretName, setSecretName] = useState('');
  const [secretValue, setSecretValue] = useState('');
  const [secretDesc, setSecretDesc] = useState('');
  const [saving, setSaving] = useState(false);
  const { data: secretList, refetch: refetchSecrets } = useApi(config.getClusterSecrets);

  useEffect(() => {
    if (!data) return;
    setMode((data.deployment_mode === 'clustered' ? 'clustered' : 'single'));
    setCompilers((data.compilers || []).join('\n'));
    setPuppetdbNodes((data.puppetdb_nodes || []).join('\n'));
    setCaNodes((data.ca_nodes || []).join('\n'));
    setCaVips((data.ca_vips || []).join('\n'));
    setInfraVips((data.infra_vips || []).join('\n'));
    setDnsRrVips((data.dns_rr_vips || []).join('\n'));
    setFleetExclude((data.fleet_exclude || []).join('\n'));
    setDeployTargets((data.code_deploy_targets || []).join('\n'));
    setConsoles((data.consoles || []).join('\n'));
    setVipHosts((data.vip_hosts || []).join('\n'));
    setDbBackend((data.database_backend === 'postgresql' ? 'postgresql' : 'sqlite'));
    setEncUrls((data.enc_api_urls || []).join('\n'));
  }, [data]);

  const lines = (s: string) =>
    s.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);

  const handleSave = async () => {
    setSaving(true);
    try {
      if (mode === 'clustered' && !databaseUrl.trim()) {
        // Allow save only if server already on Postgres (API validates).
        // Still prefer sending URL when operator filled it.
      }
      const result = await config.updateCluster({
        deployment_mode: mode,
        compilers: lines(compilers),
        puppetdb_nodes: lines(puppetdbNodes),
        ca_nodes: lines(caNodes),
        ca_vips: lines(caVips),
        infra_vips: lines(infraVips),
        dns_rr_vips: lines(dnsRrVips),
        fleet_exclude: lines(fleetExclude),
        code_deploy_targets: lines(deployTargets),
        consoles: lines(consoles),
        vip_hosts: lines(vipHosts),
        database_backend: mode === 'clustered' ? 'postgresql' : dbBackend,
        enc_api_urls: lines(encUrls),
        database_url: databaseUrl || undefined,
        shared_secret_key: sharedSecret || undefined,
        seed_infrastructure_groups: mode === 'clustered',
      });
      const seeded = (result?.seeded_groups || []).join(', ') || 'none';
      const actions = [
        ...(result?.migration_actions || []),
        ...(result?.restart_required || []),
      ];
      const warnings = result?.migration_warnings || [];
      if (result?.seed_warning) {
        notifications.show({
          title: 'Cluster config saved (ENC seed warning)',
          message: result.seed_warning,
          color: 'yellow',
        });
      }
      if (warnings.length > 0) {
        notifications.show({
          title: 'Migration warnings',
          message: warnings.join(' · '),
          color: 'yellow',
          autoClose: 12000,
        });
      }
      notifications.show({
        title: mode === 'clustered' ? 'Clustered mode ready' : 'Cluster settings saved',
        message:
          actions.length > 0
            ? actions.slice(0, 6).join(' · ')
            : mode === 'clustered'
            ? `ENC groups seeded: ${seeded}. Restart openvox-gui if DATABASE_URL changed.`
            : 'Single-server mode',
        color: 'green',
        autoClose: 15000,
      });
      refetch();
    } catch (e: any) {
      notifications.show({ title: 'Save failed', message: e.message, color: 'red' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Center h={200}><Loader /></Center>;
  if (error) return <Alert color="red">{error}</Alert>;

  return (
    <Stack>
      <Alert variant="light" color="blue">
        <strong>Single server</strong> = one GUI process (optionally behind a VIP).
        <strong> Clustered</strong> = multi-compiler / multi-OpenVoxDB estate awareness
        (Stage/Activate, FQDN health, infrastructure ENC groups).
        Classification and GUI state should live in PostgreSQL database{' '}
        <Code>openvox_gui</Code> for both modes so a second console can join later
        without migrating SQLite.
      </Alert>
      <Card withBorder padding="md">
        <Stack>
          <Select
            label="Deployment mode"
            description="Clustered requires PostgreSQL for the GUI application database."
            data={[
              { value: 'single', label: 'Single server (one GUI)' },
              { value: 'clustered', label: 'Clustered (multi-compiler / multi-OpenVoxDB)' },
            ]}
            value={mode}
            onChange={(v) => {
              const next = (v as 'single' | 'clustered') || 'single';
              setMode(next);
              if (next === 'clustered') {
                setDbBackend('postgresql');
              }
            }}
          />
          {mode === 'clustered' && (
            <>
              <Textarea
                label="Compiler FQDNs (one per line)"
                description="Catalog compilers — health-checked on :8140 by FQDN"
                minRows={3}
                value={compilers}
                onChange={(e) => setCompilers(e.currentTarget.value)}
                placeholder="compiler1.example.com"
              />
              <Textarea
                label="OpenVoxDB / PuppetDB node FQDNs"
                description="Application hosts — /status + /pdb/meta + sample query on :8081 by FQDN (not VIP)"
                minRows={3}
                value={puppetdbNodes}
                onChange={(e) => setPuppetdbNodes(e.currentTarget.value)}
                placeholder="puppetdb1.example.com"
              />
              <Textarea
                label="CA cluster member FQDNs"
                description="ovca1/ovca2 per site — status APIs + used for pcs/DRBD via bolt when GUI is not on a CA host"
                minRows={2}
                value={caNodes}
                onChange={(e) => setCaNodes(e.currentTarget.value)}
                placeholder={"ca1.example.com\nca2.example.com"}
              />
              <Textarea
                label="CA VIP FQDNs (optional)"
                description="e.g. ca.site.example.com, ca.example.com — health on :8140. Also hidden from Overview | Nodes (not agents)."
                minRows={2}
                value={caVips}
                onChange={(e) => setCaVips(e.currentTarget.value)}
                placeholder="ovca.example.com"
              />
              <Textarea
                label="Infrastructure VIP FQDNs (compiler / PDB LBs)"
                description="Health probes only (HAProxy frontends such as ovcompilers.<site>). These are real agents and stay on Nodes. First-label ovcompilers is never hidden."
                minRows={2}
                value={infraVips}
                onChange={(e) => setInfraVips(e.currentTarget.value)}
                placeholder={"compilers.site-a.example.com\ncompilers.site-b.example.com"}
              />
              <Textarea
                label="DNS RR names (no VM — hide from Nodes)"
                description="Names that exist only in DNS, e.g. ovdb.example.com. Hidden from live fleet. Not ovcompilers.*."
                minRows={2}
                value={dnsRrVips}
                onChange={(e) => setDnsRrVips(e.currentTarget.value)}
                placeholder="ovdb.example.com"
              />
              <Textarea
                label="Extra fleet exclusions (optional)"
                description="Any other certnames to hide from Nodes / Inventory. Merged with CA VIPs, DNS RR names, and console VIP hosts. Never put ovcompilers.* here."
                minRows={2}
                value={fleetExclude}
                onChange={(e) => setFleetExclude(e.currentTarget.value)}
                placeholder="legacy-lb.example.com"
              />
              <Textarea
                label="Code deploy targets (optional)"
                description="Hosts that receive r10k stage/activate. Defaults to compiler list if empty."
                minRows={2}
                value={deployTargets}
                onChange={(e) => setDeployTargets(e.currentTarget.value)}
              />
              <Divider label="GUI application database (required)" labelPosition="left" />
              <Alert variant="light" color="orange">
                Switching to Clustered is designed to be automatic: we seed environments from
                this host if present, and if you still use SQLite we <strong>copy</strong> your
                classification and users into PostgreSQL when you provide the URL below
                (database <Code>openvox_gui</Code> on ovdb — not inside <Code>puppetdb</Code>).
                After save, restart the service. Discovery then uses compilers (API + Bolt).
                Any future console uses the same URL and SECRET_KEY.
              </Alert>
              <TextInput
                label="PostgreSQL URL (writes .env — restart required)"
                description="postgresql+asyncpg://openvox_gui:PASSWORD@ovdb-primary-or-vip:5432/openvox_gui"
                required
                value={databaseUrl}
                onChange={(e) => setDatabaseUrl(e.currentTarget.value)}
                placeholder="postgresql+asyncpg://openvox_gui:…@ovdb1.example.com:5432/openvox_gui"
              />
              <PasswordInput
                label="SECRET_KEY (optional write to .env)"
                description="Leave blank to keep current key. Back this up — required identical on any additional console."
                value={sharedSecret}
                onChange={(e) => setSharedSecret(e.currentTarget.value)}
              />
              <Textarea
                label="GUI console FQDNs (optional, one per line)"
                description="Individual console nodes. Direct access keeps full poll rates."
                minRows={2}
                value={consoles}
                onChange={(e) => setConsoles(e.currentTarget.value)}
                placeholder={"console-a.example.com\nconsole-b.example.com"}
              />
              <Textarea
                label="Console VIP / public LB hostnames"
                description="Hostnames users hit via the load balancer. SPA uses gentler polling and session-safe 401 handling when Host matches. Also set OPENVOX_GUI_VIP_HOSTS on both consoles if preferred."
                minRows={2}
                value={vipHosts}
                onChange={(e) => setVipHosts(e.currentTarget.value)}
                placeholder="openvox.example.com"
              />
              <Textarea
                label="ENC API base URLs for compilers (optional)"
                description="Put in OPENVOX_GUI_API_BASE on compilers (comma-separated). Prefer console VIP."
                minRows={2}
                value={encUrls}
                onChange={(e) => setEncUrls(e.currentTarget.value)}
                placeholder="https://openvox.example.com:4567"
              />
              <Divider label="Cluster secrets (encrypted in openvox_gui DB)" labelPosition="left" />
              <Text size="sm" c="dimmed">
                Optional named secrets (PDB password, GUI DB password, Bolt, etc.). Values are
                Fernet-encrypted with SECRET_KEY in the application database.
              </Text>
              {(secretList?.secrets || []).length > 0 && (
                <Table>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Name</Table.Th>
                      <Table.Th>Description</Table.Th>
                      <Table.Th>Updated</Table.Th>
                      <Table.Th />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {(secretList?.secrets || []).map((s: any) => (
                      <Table.Tr key={s.name}>
                        <Table.Td><Code>{s.name}</Code></Table.Td>
                        <Table.Td>{s.description}</Table.Td>
                        <Table.Td>{s.updated_by} {s.updated_at || ''}</Table.Td>
                        <Table.Td>
                          <ActionIcon color="red" variant="subtle" onClick={async () => {
                            try {
                              await config.deleteClusterSecret(s.name);
                              refetchSecrets();
                            } catch (e: any) {
                              notifications.show({ title: 'Delete failed', message: e.message, color: 'red' });
                            }
                          }}>
                            <IconTrash size={16} />
                          </ActionIcon>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
              <Group align="flex-end">
                <TextInput label="Secret name" value={secretName} onChange={(e) => setSecretName(e.currentTarget.value)} placeholder="gui_db_password" />
                <PasswordInput label="Value" value={secretValue} onChange={(e) => setSecretValue(e.currentTarget.value)} />
                <TextInput label="Description" value={secretDesc} onChange={(e) => setSecretDesc(e.currentTarget.value)} />
                <Button variant="light" onClick={async () => {
                  if (!secretName || !secretValue) return;
                  try {
                    await config.upsertClusterSecret({ name: secretName, value: secretValue, description: secretDesc });
                    setSecretName(''); setSecretValue(''); setSecretDesc('');
                    refetchSecrets();
                    notifications.show({ title: 'Secret saved', message: secretName, color: 'green' });
                  } catch (e: any) {
                    notifications.show({ title: 'Secret save failed', message: e.message, color: 'red' });
                  }
                }}>Save secret</Button>
              </Group>
            </>
          )}
          <Button color="#0D6EFD" loading={saving} onClick={handleSave}>
            Save cluster configuration
          </Button>
        </Stack>
      </Card>
    </Stack>
  );
}

/* ────────────────────── LDAP Configuration Panel ────────────────────── */
/** Only these keys are editable form fields (never spread API meta into form). */
const LDAP_FORM_KEYS = [
  'enabled', 'server_url', 'use_ssl', 'use_starttls', 'ssl_verify', 'ssl_ca_cert',
  'connection_timeout', 'bind_dn', 'user_base_dn', 'user_search_filter',
  'user_attr_username', 'user_attr_email', 'user_attr_display_name',
  'group_base_dn', 'group_search_filter', 'group_member_attr', 'group_attr_name',
  'admin_group', 'operator_group', 'viewer_group', 'default_role',
  'ad_domain', 'use_ad_upn',
] as const;

function pickLdapForm(data: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const k of LDAP_FORM_KEYS) {
    if (data[k] !== undefined && data[k] !== null) out[k] = data[k];
  }
  return out;
}

function LdapConfigPanel() {
  const [ldapConfig, setLdapConfig] = useState<any>(null);
  const [passwordSet, setPasswordSet] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Form state — bind_password is never loaded from the API (leave blank = keep).
  const [form, setForm] = useState({
    enabled: false,
    server_url: 'ldap://localhost:389',
    use_ssl: false,
    use_starttls: false,
    ssl_verify: true,
    ssl_ca_cert: '',
    connection_timeout: 30,
    bind_dn: '',
    bind_password: '',
    user_base_dn: 'dc=example,dc=com',
    user_search_filter: '(uid={username})',
    user_attr_username: 'uid',
    user_attr_email: 'mail',
    user_attr_display_name: 'cn',
    group_base_dn: '',
    group_search_filter: '(objectClass=groupOfNames)',
    group_member_attr: 'member',
    group_attr_name: 'cn',
    admin_group: '',
    operator_group: '',
    viewer_group: '',
    default_role: 'viewer',
    ad_domain: '',
    use_ad_upn: false,
  });

  useEffect(() => {
    ldap.getConfig().then((data: any) => {
      if (data.configured) {
        setForm((prev) => ({
          ...prev,
          ...pickLdapForm(data),
          bind_password: '', // never pre-fill; blank means keep stored secret
          ssl_ca_cert: data.ssl_ca_cert || '',
          bind_dn: data.bind_dn || '',
          group_base_dn: data.group_base_dn || '',
          group_search_filter: data.group_search_filter || '(objectClass=groupOfNames)',
          admin_group: data.admin_group || '',
          operator_group: data.operator_group || '',
          viewer_group: data.viewer_group || '',
          ad_domain: data.ad_domain || '',
        }));
        setLdapConfig(data);
        setPasswordSet(!!data.bind_password_set);
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const updateField = (field: string, value: any) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const payload: Record<string, any> = pickLdapForm(form);
      // Only send bind_password when the operator typed a new value.
      // Empty field → omit key → backend keeps encrypted secret on disk.
      const typed = (form.bind_password || '').trim();
      if (typed) {
        payload.bind_password = typed;
      }
      const saveResult = await ldap.saveConfig(payload);
      notifications.show({
        title: 'LDAP Configuration Saved',
        message: form.enabled
          ? 'LDAP authentication is now enabled.'
          : 'LDAP configuration saved (currently disabled).',
        color: 'green',
      });
      const updated = await ldap.getConfig();
      setLdapConfig(updated);
      setPasswordSet(Boolean(
        updated?.bind_password_set
        || saveResult?.bind_password_set
        || typed
        || passwordSet,
      ));
      // Clear the password field after successful save (value is now on the server)
      setForm((prev) => ({ ...prev, bind_password: '' }));
    } catch (err: any) {
      const msg = err?.message || String(err);
      setSaveError(msg);
      notifications.show({
        title: 'LDAP save failed',
        message: msg.length > 180 ? `${msg.slice(0, 180)}… (see details below)` : msg,
        color: 'red',
        autoClose: 12000,
      });
    } finally { setSaving(false); }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const typed = (form.bind_password || '').trim();
      const result = await ldap.testConnection({
        server_url: form.server_url,
        use_ssl: form.use_ssl,
        use_starttls: form.use_starttls,
        ssl_verify: form.ssl_verify,
        ssl_ca_cert: form.ssl_ca_cert || null,
        connection_timeout: form.connection_timeout,
        bind_dn: form.bind_dn || null,
        // Omit password when blank so the API uses the stored secret
        bind_password: typed || null,
        user_base_dn: form.user_base_dn || null,
      });
      setTestResult(result);
      if (result.success) {
        notifications.show({ title: 'Connection Successful', message: result.message, color: 'green' });
      } else {
        notifications.show({ title: 'Connection Failed', message: result.message, color: 'red' });
      }
    } catch (err: any) {
      setTestResult({ success: false, message: err.message });
      notifications.show({ title: 'Test Failed', message: err.message, color: 'red' });
    } finally { setTesting(false); }
  };

  const applyPreset = (preset: string) => {
    switch (preset) {
      case 'openldap':
        updateField('user_search_filter', '(uid={username})');
        updateField('user_attr_username', 'uid');
        updateField('use_ad_upn', false);
        break;
      case '389ds':
        updateField('user_search_filter', '(uid={username})');
        updateField('user_attr_username', 'uid');
        updateField('use_ad_upn', false);
        break;
      case 'ad':
        updateField('user_search_filter', '(sAMAccountName={username})');
        updateField('user_attr_username', 'sAMAccountName');
        updateField('user_attr_display_name', 'displayName');
        updateField('use_ad_upn', true);
        break;
    }
    notifications.show({ title: 'Preset Applied', message: `${preset === 'ad' ? 'Active Directory' : preset === '389ds' ? '389 Directory Server / Red Hat DS' : 'OpenLDAP'} defaults applied. Review and adjust as needed.`, color: 'blue' });
  };

  if (loading) return <Center h={200}><Loader size="lg" /></Center>;

  return (
    <Card withBorder shadow="sm" padding="lg">
      <Group justify="space-between" mb="md">
        <Group gap="sm">
          <IconPlugConnected size={22} />
          <Title order={4}>LDAP / Active Directory</Title>
        </Group>
        <Switch
          label={form.enabled ? 'Enabled' : 'Disabled'}
          checked={form.enabled}
          onChange={(e) => updateField('enabled', e.currentTarget.checked)}
          size="md"
          color="green"
        />
      </Group>

      <Text size="sm" c="dimmed" mb="md">
        Configure LDAP authentication to allow users to sign in with their corporate credentials.
        Local accounts (for service accounts etc.) continue to work alongside LDAP.
        <Text span fw={500}> User roles (Admin, Operator, Certops, Viewer) are managed in the User Manager tab — not here.</Text>
      </Text>

      {/* Directory Type Presets */}
      <Group mb="md">
        <Text size="sm" fw={500}>Quick Presets:</Text>
        <Button variant="light" size="xs" onClick={() => applyPreset('openldap')}>OpenLDAP</Button>
        <Button variant="light" size="xs" onClick={() => applyPreset('389ds')}>389 DS / Red Hat DS</Button>
        <Button variant="light" size="xs" onClick={() => applyPreset('ad')}>Active Directory</Button>
      </Group>

      <Divider mb="md" label="Connection" labelPosition="left" />

      <Grid>
        <Grid.Col span={{ base: 12, md: 8 }}>
          <TextInput
            label="Server URL"
            description="LDAP server address. Use ldaps:// for SSL (port 636)."
            placeholder="ldap://ldap.example.com:389"
            value={form.server_url}
            onChange={(e) => {
              const url = e.currentTarget.value;
              updateField('server_url', url);
              // Auto-toggle SSL when user types ldaps://
              if (url.toLowerCase().startsWith('ldaps://') && !form.use_ssl) {
                updateField('use_ssl', true);
              }
            }}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 4 }}>
          <TextInput
            label="Timeout (seconds)"
            type="number"
            value={form.connection_timeout}
            onChange={(e) => updateField('connection_timeout', parseInt(e.currentTarget.value) || 10)}
          />
        </Grid.Col>
      </Grid>

      <Group mt="sm" gap="xl">
        <Switch label="Use SSL (LDAPS)" checked={form.use_ssl} onChange={(e) => updateField('use_ssl', e.currentTarget.checked)} />
        <Switch label="Use STARTTLS" checked={form.use_starttls} onChange={(e) => updateField('use_starttls', e.currentTarget.checked)} />
        <Switch label="Verify SSL Certificate" checked={form.ssl_verify} onChange={(e) => updateField('ssl_verify', e.currentTarget.checked)} />
      </Group>

      <Collapse expanded={form.use_ssl || form.use_starttls}>
        <TextInput mt="sm" label="CA Certificate Path" description="Path to CA certificate file for SSL verification (optional)"
          placeholder="/etc/ssl/certs/ldap-ca.pem" value={form.ssl_ca_cert}
          onChange={(e) => updateField('ssl_ca_cert', e.currentTarget.value)} />
      </Collapse>

      <Divider my="md" label="Bind Credentials" labelPosition="left" />
      <Text size="xs" c="dimmed" mb="sm">Service account used to search for users in LDAP. For Active Directory with UPN mode, this is optional.</Text>
      <Grid>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <TextInput label="Bind DN" placeholder="cn=admin,dc=example,dc=com" value={form.bind_dn}
            onChange={(e) => updateField('bind_dn', e.currentTarget.value)} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <PasswordInput
            label="Bind Password"
            description={
              passwordSet
                ? 'A password is already stored. Leave blank to keep it when testing or saving other fields. Type a new value only to replace it.'
                : 'Required for service-account bind (unless using AD UPN without a bind DN).'
            }
            placeholder={passwordSet ? '••••••••  (stored — leave blank to keep)' : 'Enter bind password'}
            value={form.bind_password}
            onChange={(e) => updateField('bind_password', e.currentTarget.value)}
          />
          {passwordSet && !form.bind_password && (
            <Text size="xs" c="teal" mt={4}>Using stored bind password</Text>
          )}
        </Grid.Col>
      </Grid>

      <Divider my="md" label="User Search" labelPosition="left" />
      <Grid>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <TextInput label="User Base DN" description="Where to search for user accounts" placeholder="ou=people,dc=example,dc=com"
            value={form.user_base_dn} onChange={(e) => updateField('user_base_dn', e.currentTarget.value)} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <TextInput label="User Search Filter" description="Use {username} as placeholder" placeholder="(uid={username})"
            value={form.user_search_filter} onChange={(e) => updateField('user_search_filter', e.currentTarget.value)} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 4 }}>
          <TextInput label="Username Attribute" placeholder="uid" value={form.user_attr_username}
            onChange={(e) => updateField('user_attr_username', e.currentTarget.value)} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 4 }}>
          <TextInput label="Email Attribute" placeholder="mail" value={form.user_attr_email}
            onChange={(e) => updateField('user_attr_email', e.currentTarget.value)} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 4 }}>
          <TextInput label="Display Name Attribute" placeholder="cn" value={form.user_attr_display_name}
            onChange={(e) => updateField('user_attr_display_name', e.currentTarget.value)} />
        </Grid.Col>
      </Grid>

      <Divider my="md" label="Active Directory Settings" labelPosition="left" />
      <Group gap="xl">
        <Switch label="Use AD User Principal Name (UPN) for bind" checked={form.use_ad_upn}
          onChange={(e) => updateField('use_ad_upn', e.currentTarget.checked)} />
      </Group>
      <Collapse expanded={form.use_ad_upn}>
        <TextInput mt="sm" label="AD Domain" description="Domain for UPN bind (username@domain)" placeholder="corp.example.com"
          value={form.ad_domain} onChange={(e) => updateField('ad_domain', e.currentTarget.value)} style={{ maxWidth: 400 }} />
      </Collapse>

      {/* Test Result */}
      {testResult && (
        <Alert mt="md" color={testResult.success ? 'green' : 'red'} title={testResult.success ? 'Connection Successful' : 'Connection Failed'} withCloseButton onClose={() => setTestResult(null)}>
          <Text size="sm">{testResult.message}</Text>
          {testResult.hints && testResult.hints.length > 0 && (
            <Stack gap={4} mt="xs">
              {testResult.hints.map((hint: string, i: number) => (
                <Text key={i} size="xs" c="yellow">💡 {hint}</Text>
              ))}
            </Stack>
          )}
          {testResult.user_base_dn_valid === false && <Text size="xs" c="orange" mt="xs">⚠ {testResult.user_base_dn_warning}</Text>}
          {testResult.user_base_dn_valid === true && <Text size="xs" c="green" mt="xs">✓ User Base DN is valid</Text>}
        </Alert>
      )}

      {saveError && (
        <Alert
          mt="md"
          color="red"
          title="Save failed"
          withCloseButton
          onClose={() => setSaveError(null)}
        >
          <ScrollArea.Autosize mah={220} type="auto" offsetScrollbars>
            <Text
              size="sm"
              ff="monospace"
              style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
            >
              {saveError}
            </Text>
          </ScrollArea.Autosize>
        </Alert>
      )}

      <Divider my="md" />

      <Group justify="space-between">
        <Button variant="outline" leftSection={<IconTestPipe size={16} />} onClick={handleTest} loading={testing}
          disabled={!form.server_url}>
          Test Connection
        </Button>
        <Button leftSection={<IconDeviceFloppy size={16} />} onClick={handleSave} loading={saving}>
          Save LDAP Configuration
        </Button>
      </Group>
    </Card>
  );
}

/* ────────────────────── Auth Settings Tab ────────────────────── */
function AuthSettingsTab() {
  const { data: appData } = useApi(config.getApp);

  return (
    <Stack>
      {/* Authentication Source Summary */}
      <Card withBorder shadow="sm">
        <Text fw={700} mb="sm">Authentication</Text>
        <Group>
          <Text size="sm" c="dimmed">Backend:</Text>
          <Badge color={appData?.auth_backend === 'none' ? 'yellow' : 'green'} size="lg">{appData?.auth_backend || 'none'}</Badge>
        </Group>
        <Text size="xs" c="dimmed" mt="sm">
          Each user can authenticate via LDAP (corporate credentials) or local accounts (service accounts, break-glass).
          The authentication source is selectable per user. <Text span fw={500}>Roles (Admin, Operator, Viewer) are assigned and managed exclusively in the User Manager tab.</Text>
        </Text>
      </Card>

      {/* LDAP Configuration */}
      <LdapConfigPanel />
    </Stack>
  );
}

/* ────────────────────── User Manager Tab ────────────────────── */
function UserManagerTab() {
  const { user: currentUser } = useAuth();
  const { isRobots } = useAppTheme();
  const [userList, setUserList] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<string>('operator');
  const [newAuthSource, setNewAuthSource] = useState<string>('ldap');
  const [addLoading, setAddLoading] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [pwUser, setPwUser] = useState('');
  const [pwValue, setPwValue] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  const [roleOpen, setRoleOpen] = useState(false);
  const [roleUser, setRoleUser] = useState('');
  const [roleValue, setRoleValue] = useState<string>('viewer');
  const [roleLoading, setRoleLoading] = useState(false);
  const [authSrcOpen, setAuthSrcOpen] = useState(false);
  const [authSrcUser, setAuthSrcUser] = useState('');
  const [authSrcValue, setAuthSrcValue] = useState<string>('ldap');
  const [authSrcLoading, setAuthSrcLoading] = useState(false);
  const [deleteUser, setDeleteUser] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await users.list();
      setUserList(Array.isArray(data) ? data : []);
    } catch (err: any) { setError(err.message || 'Failed to load users'); }
    finally { setLoading(false); }
  }, []);

  useState(() => { loadUsers(); });

  const handleAddUser = async () => {
    if (!newUsername) return;
    if (newAuthSource === 'local' && !newPassword) return;
    setAddLoading(true);
    try {
      await users.create({ username: newUsername, password: newPassword, role: newRole, auth_source: newAuthSource });
      notifications.show({ title: 'User Created', message: `User '${newUsername}' created (${newAuthSource}, role: ${newRole})`, color: 'green' });
      setNewUsername(''); setNewPassword(''); setNewRole('operator'); setNewAuthSource('ldap'); loadUsers();
    } catch (err: any) { notifications.show({ title: 'Error', message: err.message, color: 'red' }); }
    finally { setAddLoading(false); }
  };

  const handleDeleteUser = async (username: string) => {
    setDeleteLoading(true);
    try {
      await users.remove(username);
      notifications.show({ title: 'User Deleted', message: `User '${username}' removed`, color: 'green' });
      setDeleteUser(null);
      loadUsers();
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
    setDeleteLoading(false);
  };

  const handleChangePassword = async () => {
    if (!pwValue) return;
    setPwLoading(true);
    try {
      await users.changePassword(pwUser, pwValue);
      notifications.show({ title: 'Password Changed', message: `Password updated for '${pwUser}'`, color: 'green' });
      setPwOpen(false); setPwValue('');
    } catch (err: any) { notifications.show({ title: 'Error', message: err.message, color: 'red' }); }
    finally { setPwLoading(false); }
  };

  const handleChangeRole = async () => {
    setRoleLoading(true);
    try {
      await users.changeRole(roleUser, roleValue);
      notifications.show({ title: 'Role Changed', message: `Role updated to '${roleValue}' for '${roleUser}'`, color: 'green' });
      setRoleOpen(false); loadUsers();
    } catch (err: any) { notifications.show({ title: 'Error', message: err.message, color: 'red' }); }
    finally { setRoleLoading(false); }
  };

  const handleChangeAuthSource = async () => {
    setAuthSrcLoading(true);
    try {
      await users.changeAuthSource(authSrcUser, authSrcValue);
      notifications.show({ title: 'Auth Source Changed', message: `'${authSrcUser}' now authenticates via ${authSrcValue.toUpperCase()}`, color: 'green' });
      setAuthSrcOpen(false); loadUsers();
    } catch (err: any) { notifications.show({ title: 'Error', message: err.message, color: 'red' }); }
    finally { setAuthSrcLoading(false); }
  };

  if (loading) return <Center h={300}><Loader size="xl" /></Center>;
  if (error) return <Alert color="red" title="Error">{error}</Alert>;

  return (
    <Stack>
      {/* Add User */}
      <Grid align="flex-start">
        {isRobots && (
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Card withBorder shadow="sm" padding="sm" style={{ overflow: 'hidden' }}><PeopleProcessingMachine /></Card>
          </Grid.Col>
        )}
        <Grid.Col span={{ base: 12, md: isRobots ? 6 : 12 }}>
          <Card withBorder shadow="sm" padding="lg">
            <Group gap="sm" mb="md">
              <IconPlus size={18} />
              <Title order={4}>Add User</Title>
            </Group>
            <Text size="xs" c="dimmed" mb="sm">
              Create a new user. LDAP users authenticate with their directory credentials. Local users use a password stored in this application.
            </Text>
            <Stack gap="sm">
              <TextInput label="Username" placeholder="Enter username" value={newUsername} onChange={(e) => setNewUsername(e.currentTarget.value)} />
              <Select label="Authentication Source" description="LDAP users authenticate with corporate credentials. Local users use a stored password."
                data={[
                  { value: 'ldap', label: 'LDAP / Active Directory' },
                  { value: 'local', label: 'Local' },
                ]} value={newAuthSource} onChange={(v) => { setNewAuthSource(v || 'ldap'); if (v === 'ldap') setNewPassword(''); }} />
              <Collapse expanded={newAuthSource === 'local'}>
                <PasswordInput label="Password" placeholder="Enter password" value={newPassword} onChange={(e) => setNewPassword(e.currentTarget.value)} />
              </Collapse>
              <Select label="Role" data={ROLE_SELECT_DATA}
                value={newRole} onChange={(v) => setNewRole(v || 'viewer')} />
              <Button leftSection={<IconPlus size={16} />} onClick={handleAddUser} loading={addLoading}
                disabled={!newUsername || (newAuthSource === 'local' && !newPassword)}>Create User</Button>
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>

      {/* User Table */}
      <Card withBorder shadow="sm">
        <Text fw={700} mb="sm">All Users</Text>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Username</Table.Th>
              <Table.Th>Role</Table.Th>
              <Table.Th>Source</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {userList.map((u) => (
              <Table.Tr key={u.username}>
                <Table.Td><Text fw={500}>{u.username}</Text></Table.Td>
                <Table.Td><Badge color={roleBadgeColor[u.role] || 'gray'} variant="light">{u.role}</Badge></Table.Td>
                <Table.Td>
                  <Badge
                    color={authSourceColor[u.auth_source || 'local'] || 'gray'}
                    variant="outline"
                    size="sm"
                    leftSection={u.auth_source === 'ldap' ? <IconWorld size={10} /> : <IconLock size={10} />}
                  >
                    {u.auth_source || 'local'}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Group gap="xs" justify="flex-end">
                    {(u.auth_source || 'local') === 'local' && (
                      <Tooltip label="Change password">
                        <ActionIcon variant="subtle" color="blue" onClick={() => { setPwUser(u.username); setPwValue(''); setPwOpen(true); }}>
                          <IconKey size={16} />
                        </ActionIcon>
                      </Tooltip>
                    )}
                    <Tooltip label="Change auth source">
                      <ActionIcon variant="subtle" color="grape" onClick={() => { setAuthSrcUser(u.username); setAuthSrcValue(u.auth_source || 'local'); setAuthSrcOpen(true); }}>
                        <IconSwitchHorizontal size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Change role"><ActionIcon variant="subtle" color="orange" onClick={() => { setRoleUser(u.username); setRoleValue(u.role); setRoleOpen(true); }}><IconShield size={16} /></ActionIcon></Tooltip>
                    {u.username !== currentUser?.username && (<Tooltip label="Delete user"><ActionIcon variant="subtle" color="red" onClick={() => setDeleteUser(u.username)}><IconTrash size={16} /></ActionIcon></Tooltip>)}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
            {userList.length === 0 && (<Table.Tr><Table.Td colSpan={4}><Text c="dimmed" ta="center" py="lg">No users found</Text></Table.Td></Table.Tr>)}
          </Table.Tbody>
        </Table>
      </Card>

      <Modal opened={pwOpen} onClose={() => setPwOpen(false)} title={`Change Password \u2014 ${pwUser}`} centered>
        <Stack>
          <PasswordInput label="New Password" placeholder="Enter new password" value={pwValue} onChange={(e) => setPwValue(e.currentTarget.value)} required />
          <Button onClick={handleChangePassword} loading={pwLoading} fullWidth>Update Password</Button>
        </Stack>
      </Modal>
      <Modal opened={roleOpen} onClose={() => setRoleOpen(false)} title={`Change Role \u2014 ${roleUser}`} centered>
        <Stack>
          <Select label="Role" data={ROLE_SELECT_DATA}
            value={roleValue} onChange={(v) => setRoleValue(v || 'viewer')} />
          <Button onClick={handleChangeRole} loading={roleLoading} fullWidth>Update Role</Button>
        </Stack>
      </Modal>
      <Modal opened={authSrcOpen} onClose={() => setAuthSrcOpen(false)} title={`Change Auth Source \u2014 ${authSrcUser}`} centered>
        <Stack>
          <Select label="Authentication Source" description="LDAP: credentials validated against your directory server. Local: password stored in this application."
            data={[
              { value: 'ldap', label: 'LDAP / Active Directory' },
              { value: 'local', label: 'Local' },
            ]} value={authSrcValue} onChange={(v) => setAuthSrcValue(v || 'ldap')} />
          {authSrcValue === 'ldap' && (
            <Alert variant="light" color="blue" title="Note">
              Switching to LDAP will invalidate this user's local password. They will need to authenticate using their LDAP/AD credentials.
            </Alert>
          )}
          <Button onClick={handleChangeAuthSource} loading={authSrcLoading} fullWidth>Update Auth Source</Button>
        </Stack>
      </Modal>
      <ConfirmModal
        opened={!!deleteUser}
        onClose={() => !deleteLoading && setDeleteUser(null)}
        onConfirm={() => deleteUser && handleDeleteUser(deleteUser)}
        title="Delete user?"
        body={`Delete user '${deleteUser}'? This cannot be undone.`}
        details={deleteUser ? [deleteUser] : undefined}
        confirmLabel="Delete user"
        danger
        loading={deleteLoading}
      />
    </Stack>
  );
}

/* ────────────────────── Proxy Configuration Tab ────────────────────── */

function ProxyTab() {
  const { data, loading, error, refetch } = useApi(config.getApp);
  const [httpProxy, setHttpProxy] = useState('');
  const [httpsProxy, setHttpsProxy] = useState('');
  const [noProxy, setNoProxy] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (data && !initialized) {
      setHttpProxy(data.http_proxy || '');
      setHttpsProxy(data.https_proxy || '');
      setNoProxy(data.no_proxy || '');
      setInitialized(true);
    }
  }, [data, initialized]);

  const isDirty =
    data &&
    (httpProxy !== (data.http_proxy || '') ||
     httpsProxy !== (data.https_proxy || '') ||
     noProxy !== (data.no_proxy || ''));

  const handleSave = async () => {
    setSaving(true);
    try {
      await config.updateApp('http_proxy', httpProxy);
      await config.updateApp('https_proxy', httpsProxy);
      await config.updateApp('no_proxy', noProxy);
      notifications.show({
        title: 'Proxy settings saved',
        message: 'Restart the openvox-gui service and repo-sync timer for changes to take effect.',
        color: 'green',
      });
      setInitialized(false);
      refetch();
    } catch (err: any) {
      notifications.show({
        title: 'Failed to save proxy settings',
        message: err.message || String(err),
        color: 'red',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await config.testProxy();
      notifications.show({
        title: res.success ? 'Connection successful' : 'Connection failed',
        message: `${res.message} (proxy: ${res.proxy_used})`,
        color: res.success ? 'green' : 'red',
      });
    } catch (err: any) {
      notifications.show({
        title: 'Test failed',
        message: err.message || String(err),
        color: 'red',
      });
    } finally {
      setTesting(false);
    }
  };

  if (loading) return <Center h={200}><Loader size="lg" /></Center>;
  if (error) return <Alert color="red" title="Error">{error}</Alert>;

  return (
    <Card withBorder shadow="sm">
      <Stack>
        <div>
          <Text fw={700} size="lg">Proxy Configuration</Text>
          <Text size="sm" c="dimmed">
            Configure HTTP proxy settings for outbound connections. Used by mirror sync,
            upstream distribution discovery, and package downloads. Leave fields empty if
            no proxy is needed.
          </Text>
        </div>

        <Divider />

        <Grid gap="md">
          <Grid.Col span={{ base: 12, md: 6 }}>
            <TextInput
              label="HTTP Proxy"
              description="Proxy URL for HTTP connections"
              placeholder="http://proxy.example.com:3128"
              value={httpProxy}
              onChange={(e) => setHttpProxy(e.currentTarget.value)}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <TextInput
              label="HTTPS Proxy"
              description="Proxy URL for HTTPS connections (often the same as HTTP)"
              placeholder="http://proxy.example.com:3128"
              value={httpsProxy}
              onChange={(e) => setHttpsProxy(e.currentTarget.value)}
            />
          </Grid.Col>
          <Grid.Col span={12}>
            <Textarea
              label="No Proxy"
              description="Comma-separated list of hostnames, domains, or IP patterns to bypass the proxy"
              placeholder="localhost,127.0.0.1,10.*,*.local,*.corp"
              value={noProxy}
              onChange={(e) => setNoProxy(e.currentTarget.value)}
              minRows={3}
              autosize
            />
          </Grid.Col>
        </Grid>

        <Group justify="space-between">
          <Text size="xs" c="dimmed">
            After saving, restart the openvox-gui service and the repo-sync timer for changes to take effect.
          </Text>
          <Group gap="xs">
            <Button
              variant="light"
              leftSection={<IconTestPipe size={14} />}
              onClick={handleTest}
              loading={testing}
            >
              Test Connection
            </Button>
            <Button
              leftSection={<IconDeviceFloppy size={14} />}
              onClick={handleSave}
              loading={saving}
              disabled={!isDirty}
            >
              Save
            </Button>
          </Group>
        </Group>
      </Stack>
    </Card>
  );
}

/* ────────────────────── Main Page ────────────────────── */
export function ConfigAppPage() {
  const [activeTab, setActiveTab] = useState<string | null>('settings');

  return (
    <Stack>
      <Title order={2}>Settings</Title>
      <Tabs value={activeTab} onChange={setActiveTab} variant="outline">
        <Tabs.List>
          <Tabs.Tab value="settings" leftSection={<IconSettings size={16} />}>Application Settings</Tabs.Tab>
          <Tabs.Tab value="cluster" leftSection={<IconServer size={16} />}>Cluster</Tabs.Tab>
          <Tabs.Tab value="services" leftSection={<IconServer size={16} />}>Services</Tabs.Tab>
          <Tabs.Tab value="users" leftSection={<IconUsers size={16} />}>User Manager</Tabs.Tab>
          <Tabs.Tab value="auth" leftSection={<IconPlugConnected size={16} />}>Auth Settings</Tabs.Tab>
          <Tabs.Tab value="ssl" leftSection={<IconLock size={16} />}>SSL Configuration</Tabs.Tab>
          <Tabs.Tab value="proxy" leftSection={<IconWorld size={16} />}>Proxy Configuration</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="settings" pt="md"><ApplicationTab onSwitchToServices={() => setActiveTab('services')} /></Tabs.Panel>
        <Tabs.Panel value="cluster" pt="md"><ClusterTab /></Tabs.Panel>
        <Tabs.Panel value="services" pt="md"><ServicesTab /></Tabs.Panel>
        <Tabs.Panel value="auth" pt="md"><AuthSettingsTab /></Tabs.Panel>
        <Tabs.Panel value="users" pt="md"><UserManagerTab /></Tabs.Panel>
        <Tabs.Panel value="ssl" pt="md"><ConfigSSLPage /></Tabs.Panel>
        <Tabs.Panel value="proxy" pt="md"><ProxyTab /></Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
