import { useState, useCallback, useEffect } from 'react';
import {
  Title, Loader, Center, Alert, Card, Stack, Text, Code, Table, Badge, Group,
  Tabs, TextInput, PasswordInput, Select, ActionIcon, Modal, Tooltip, Button,
  Grid, SegmentedControl,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconSettings, IconUsers, IconPlus, IconTrash, IconKey, IconShield,
  IconEdit, IconDeviceFloppy, IconX, IconRefresh, IconServer,
} from '@tabler/icons-react';
import { useApi } from '../hooks/useApi';
import { config, users } from '../services/api';
import { useAuth } from '../hooks/AuthContext';
import { useAppTheme } from '../hooks/ThemeContext';
import { StatusBadge } from '../components/StatusBadge';

/* ────────────────────── Types ────────────────────── */
interface User {
  username: string;
  role: string;
}

const roleBadgeColor: Record<string, string> = {
  admin: 'red',
  operator: 'blue',
  viewer: 'gray',
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
    puppet_server_host:  { label: 'PuppetServer Host',   description: 'FQDN of the PuppetServer for API communication', editable: true },
    puppet_server_port:  { label: 'PuppetServer Port',   description: 'PuppetServer HTTPS API port (usually 8140)', editable: true, type: 'number' },
    puppetdb_host:       { label: 'PuppetDB Host',       description: 'FQDN of the PuppetDB server', editable: true },
    puppetdb_port:       { label: 'PuppetDB Port',       description: 'PuppetDB HTTPS API port (usually 8081)', editable: true, type: 'number' },
    debug:               { label: 'Debug Mode',          description: 'Enable verbose debug logging (restart required)', editable: true, type: 'boolean' },
  };

  const entries = data ? Object.entries(data).filter(([key]) => key !== 'auth_backend') : [];

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
      notifications.show({ title: 'Setting Updated', message: `${settingsMeta[key]?.label || key} updated. Go to the Services tab to restart.`, color: 'green' });
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
              Choose the visual style. <Text span fw={500}>Casual</Text> features dark mode with animated illustrations. <Text span fw={500}>Formal</Text> is a clean, light business theme.
            </Text>
          </div>
          <SegmentedControl value={appTheme} onChange={(v) => setTheme(v as any)}
            data={[{ label: 'Casual', value: 'casual' }, { label: 'Formal', value: 'formal' }]} size="md" />
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

/* ────────────────────── Services Tab ────────────────────── */
function ServicesTab() {
  const { data: services, loading, refetch } = useApi(config.getServices);
  const [restarting, setRestarting] = useState<string | null>(null);

  const handleRestart = async (service: string) => {
    setRestarting(service);
    try {
      await config.restartService(service);
      notifications.show({ title: 'Restarting', message: `${service} restart initiated`, color: 'blue' });
      // Wait for service to come back up, then refresh
      setTimeout(() => { refetch(); setRestarting(null); }, 4000);
    } catch (e: any) {
      notifications.show({ title: 'Error', message: e.message, color: 'red' });
      setRestarting(null);
    }
  };

  if (loading) return <Center h={300}><Loader size="xl" /></Center>;

  // Group services by category
  const puppetServices = (services || []).filter((s: any) => ['puppetserver', 'puppetdb', 'puppet'].includes(s.service));
  const appServices = (services || []).filter((s: any) => s.service === 'openvox-gui');

  return (
    <Stack>
      <Alert variant="light" color="blue">
        Manage all services in the OpenVox ecosystem. Restart individual services or the entire Puppet stack in the correct dependency order.
      </Alert>

      {/* Puppet Infrastructure Services */}
      <Card withBorder shadow="sm" padding="md">
        <Text fw={700} mb="sm">Puppet Infrastructure</Text>
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

      {/* Application Service */}
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

/* ────────────────────── User Manager Tab ────────────────────── */
function UserManagerTab() {
  const { user: currentUser } = useAuth();
  const { isFormal } = useAppTheme();
  const { data: appData } = useApi(config.getApp);
  const [userList, setUserList] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<string>('viewer');
  const [addLoading, setAddLoading] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [pwUser, setPwUser] = useState('');
  const [pwValue, setPwValue] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  const [roleOpen, setRoleOpen] = useState(false);
  const [roleUser, setRoleUser] = useState('');
  const [roleValue, setRoleValue] = useState<string>('viewer');
  const [roleLoading, setRoleLoading] = useState(false);

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
    if (!newUsername || !newPassword) return;
    setAddLoading(true);
    try {
      await users.create({ username: newUsername, password: newPassword, role: newRole });
      notifications.show({ title: 'User Created', message: `User '${newUsername}' created with role '${newRole}'`, color: 'green' });
      setNewUsername(''); setNewPassword(''); setNewRole('viewer'); loadUsers();
    } catch (err: any) { notifications.show({ title: 'Error', message: err.message, color: 'red' }); }
    finally { setAddLoading(false); }
  };

  const handleDeleteUser = async (username: string) => {
    if (!confirm(`Delete user '${username}'? This cannot be undone.`)) return;
    try {
      await users.remove(username);
      notifications.show({ title: 'User Deleted', message: `User '${username}' removed`, color: 'green' }); loadUsers();
    } catch (err: any) { notifications.show({ title: 'Error', message: err.message, color: 'red' }); }
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

  if (loading) return <Center h={300}><Loader size="xl" /></Center>;
  if (error) return <Alert color="red" title="Error">{error}</Alert>;

  return (
    <Stack>
      <Card withBorder shadow="sm">
        <Text fw={700} mb="sm">Authentication</Text>
        <Group>
          <Text size="sm" c="dimmed">Current Backend:</Text>
          <Badge color={appData?.auth_backend === 'none' ? 'yellow' : 'green'} size="lg">{appData?.auth_backend || 'none'}</Badge>
        </Group>
        <Text size="xs" c="dimmed" mt="sm">Authentication backend can be changed in /opt/openvox-gui/config/.env.</Text>
      </Card>
      <Grid align="flex-start">
        {!isFormal && (
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Card withBorder shadow="sm" padding="sm" style={{ overflow: 'hidden' }}><PeopleProcessingMachine /></Card>
          </Grid.Col>
        )}
        <Grid.Col span={{ base: 12, md: isFormal ? 12 : 6 }}>
          <Card withBorder shadow="sm" padding="lg">
            <Title order={4} mb="md">Add User</Title>
            <Stack gap="sm">
              <TextInput label="Username" placeholder="Enter username" value={newUsername} onChange={(e) => setNewUsername(e.currentTarget.value)} />
              <PasswordInput label="Password" placeholder="Enter password" value={newPassword} onChange={(e) => setNewPassword(e.currentTarget.value)} />
              <Select label="Role" data={[
                { value: 'admin', label: 'Admin \u2014 Full access' },
                { value: 'operator', label: 'Operator \u2014 Deploy & manage' },
                { value: 'viewer', label: 'Viewer \u2014 Read only' },
              ]} value={newRole} onChange={(v) => setNewRole(v || 'viewer')} />
              <Button leftSection={<IconPlus size={16} />} onClick={handleAddUser} loading={addLoading} disabled={!newUsername || !newPassword}>Create User</Button>
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>
      <Card withBorder shadow="sm">
        <Table striped highlightOnHover>
          <Table.Thead><Table.Tr><Table.Th>Username</Table.Th><Table.Th>Role</Table.Th><Table.Th style={{ textAlign: 'right' }}>Actions</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>
            {userList.map((u) => (
              <Table.Tr key={u.username}>
                <Table.Td><Text fw={500}>{u.username}</Text></Table.Td>
                <Table.Td><Badge color={roleBadgeColor[u.role] || 'gray'} variant="light">{u.role}</Badge></Table.Td>
                <Table.Td>
                  <Group gap="xs" justify="flex-end">
                    <Tooltip label="Change password"><ActionIcon variant="subtle" color="blue" onClick={() => { setPwUser(u.username); setPwValue(''); setPwOpen(true); }}><IconKey size={16} /></ActionIcon></Tooltip>
                    <Tooltip label="Change role"><ActionIcon variant="subtle" color="orange" onClick={() => { setRoleUser(u.username); setRoleValue(u.role); setRoleOpen(true); }}><IconShield size={16} /></ActionIcon></Tooltip>
                    {u.username !== currentUser?.username && (<Tooltip label="Delete user"><ActionIcon variant="subtle" color="red" onClick={() => handleDeleteUser(u.username)}><IconTrash size={16} /></ActionIcon></Tooltip>)}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
            {userList.length === 0 && (<Table.Tr><Table.Td colSpan={3}><Text c="dimmed" ta="center" py="lg">No users found</Text></Table.Td></Table.Tr>)}
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
          <Select label="Role" data={[
            { value: 'admin', label: 'Admin \u2014 Full access' },
            { value: 'operator', label: 'Operator \u2014 Deploy & manage' },
            { value: 'viewer', label: 'Viewer \u2014 Read only' },
          ]} value={roleValue} onChange={(v) => setRoleValue(v || 'viewer')} />
          <Button onClick={handleChangeRole} loading={roleLoading} fullWidth>Update Role</Button>
        </Stack>
      </Modal>
    </Stack>
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
          <Tabs.Tab value="services" leftSection={<IconServer size={16} />}>Services</Tabs.Tab>
          <Tabs.Tab value="users" leftSection={<IconUsers size={16} />}>User Manager</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="settings" pt="md"><ApplicationTab onSwitchToServices={() => setActiveTab('services')} /></Tabs.Panel>
        <Tabs.Panel value="services" pt="md"><ServicesTab /></Tabs.Panel>
        <Tabs.Panel value="users" pt="md"><UserManagerTab /></Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
