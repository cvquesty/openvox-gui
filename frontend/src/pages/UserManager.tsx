import { useState, useCallback } from 'react';
import {
  Title, Stack, Card, Table, Group, Button, TextInput, PasswordInput,
  Select, ActionIcon, Badge, Alert, Modal, Text, Tooltip, Loader, Center,
  Grid,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconPlus, IconTrash, IconKey, IconShield, IconUsers,
} from '@tabler/icons-react';
import { users } from '../services/api';
import { useAuth } from '../hooks/AuthContext';

interface User {
  username: string;
  role: string;
}

const roleBadgeColor: Record<string, string> = {
  admin: 'red',
  operator: 'blue',
  viewer: 'gray',
};

/* ── People Processing Machine SVG ───────────────────────── */
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
        <linearGradient id="pm-pipe" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#445566" />
          <stop offset="100%" stopColor="#667788" />
        </linearGradient>
      </defs>

      <rect width="500" height="320" fill="url(#pm-sky)" rx="8" />

      {/* Ground */}
      <rect x="0" y="260" width="500" height="60" fill="#1a1a2e" />
      <rect x="0" y="260" width="500" height="2" fill="#333355" />

      {/* ── Conveyor belt ── */}
      <rect x="30" y="240" width="440" height="12" fill="#334455" rx="6" />
      {/* Belt rollers */}
      <circle cx="50" cy="246" r="5" fill="#445566" stroke="#556677" strokeWidth="1">
        <animateTransform attributeName="transform" type="rotate" values="0 50 246;360 50 246" dur="2s" repeatCount="indefinite" />
      </circle>
      <circle cx="450" cy="246" r="5" fill="#445566" stroke="#556677" strokeWidth="1">
        <animateTransform attributeName="transform" type="rotate" values="0 450 246;360 450 246" dur="2s" repeatCount="indefinite" />
      </circle>
      {/* Belt dots moving */}
      <circle r="2" fill="#556677">
        <animateMotion dur="4s" repeatCount="indefinite" path="M30,246 L470,246" />
      </circle>
      <circle r="2" fill="#556677">
        <animateMotion dur="4s" repeatCount="indefinite" path="M30,246 L470,246" begin="1s" />
      </circle>
      <circle r="2" fill="#556677">
        <animateMotion dur="4s" repeatCount="indefinite" path="M30,246 L470,246" begin="2s" />
      </circle>
      <circle r="2" fill="#556677">
        <animateMotion dur="4s" repeatCount="indefinite" path="M30,246 L470,246" begin="3s" />
      </circle>

      {/* ── Unprocessed stick figures (left side, on belt) ── */}
      {/* Figure 1 - confused, question mark */}
      <g>
        <animateMotion dur="6s" repeatCount="indefinite" path="M0,0 L80,0" />
        <circle cx="55" cy="208" r="8" fill="none" stroke="#aabbcc" strokeWidth="2" />
        <line x1="55" y1="216" x2="55" y2="232" stroke="#aabbcc" strokeWidth="2" />
        <line x1="55" y1="222" x2="45" y2="228" stroke="#aabbcc" strokeWidth="2" />
        <line x1="55" y1="222" x2="65" y2="228" stroke="#aabbcc" strokeWidth="2" />
        <line x1="55" y1="232" x2="48" y2="242" stroke="#aabbcc" strokeWidth="2" />
        <line x1="55" y1="232" x2="62" y2="242" stroke="#aabbcc" strokeWidth="2" />
        {/* Question mark */}
        <text x="67" y="206" fill="#ffaa44" fontSize="14" fontWeight="bold">?</text>
        {/* Confused eyes */}
        <circle cx="52" cy="206" r="1" fill="#aabbcc" />
        <circle cx="58" cy="206" r="1" fill="#aabbcc" />
        <path d="M51,211 Q55,213 59,211" fill="none" stroke="#aabbcc" strokeWidth="0.8" />
      </g>

      {/* Figure 2 - panicking */}
      <g>
        <animateMotion dur="6s" repeatCount="indefinite" path="M0,0 L80,0" begin="2s" />
        <circle cx="90" cy="208" r="8" fill="none" stroke="#ccbbaa" strokeWidth="2" />
        <line x1="90" y1="216" x2="90" y2="232" stroke="#ccbbaa" strokeWidth="2" />
        <line x1="90" y1="222" x2="78" y2="216" stroke="#ccbbaa" strokeWidth="2" />
        <line x1="90" y1="222" x2="102" y2="216" stroke="#ccbbaa" strokeWidth="2" />
        <line x1="90" y1="232" x2="83" y2="242" stroke="#ccbbaa" strokeWidth="2" />
        <line x1="90" y1="232" x2="97" y2="242" stroke="#ccbbaa" strokeWidth="2" />
        {/* Exclamation */}
        <text x="102" y="206" fill="#ff6644" fontSize="14" fontWeight="bold">!</text>
        {/* Worried eyes */}
        <circle cx="87" cy="206" r="1.5" fill="#ccbbaa" />
        <circle cx="93" cy="206" r="1.5" fill="#ccbbaa" />
        <path d="M86,212 Q90,210 94,212" fill="none" stroke="#ccbbaa" strokeWidth="0.8" />
      </g>

      {/* Figure 3 - stumbling */}
      <g>
        <animateMotion dur="6s" repeatCount="indefinite" path="M0,0 L80,0" begin="4s" />
        <circle cx="125" cy="210" r="8" fill="none" stroke="#bbaacc" strokeWidth="2" />
        <line x1="125" y1="218" x2="128" y2="232" stroke="#bbaacc" strokeWidth="2" />
        <line x1="125" y1="224" x2="115" y2="220" stroke="#bbaacc" strokeWidth="2" />
        <line x1="125" y1="224" x2="136" y2="226" stroke="#bbaacc" strokeWidth="2" />
        <line x1="128" y1="232" x2="120" y2="242" stroke="#bbaacc" strokeWidth="2" />
        <line x1="128" y1="232" x2="136" y2="242" stroke="#bbaacc" strokeWidth="2" />
        {/* Dizzy stars */}
        <text x="135" y="206" fill="#ffdd44" fontSize="8">*</text>
        <text x="113" y="208" fill="#ffdd44" fontSize="8">*</text>
      </g>

      {/* ── THE MACHINE ── */}
      {/* Main body */}
      <rect x="175" y="120" width="150" height="128" fill="url(#pm-machine)" rx="6" stroke="#7788aa" strokeWidth="1.5" />

      {/* Input funnel (top) */}
      <polygon points="210,120 290,120 270,95 230,95" fill="#667788" stroke="#7788aa" strokeWidth="1" />
      <text x="250" y="113" textAnchor="middle" fill="#aabbcc" fontSize="7" fontFamily="monospace">INPUT</text>

      {/* Machine label */}
      <rect x="195" y="140" width="110" height="22" fill="#334455" rx="3" />
      <text x="250" y="155" textAnchor="middle" fill="#44aaff" fontSize="9" fontFamily="monospace" fontWeight="bold">
        USER-O-MATIC 3000
      </text>

      {/* Gears */}
      <circle cx="215" cy="180" r="14" fill="none" stroke="#88aacc" strokeWidth="2" strokeDasharray="4 3">
        <animateTransform attributeName="transform" type="rotate" values="0 215 180;360 215 180" dur="3s" repeatCount="indefinite" />
      </circle>
      <circle cx="215" cy="180" r="5" fill="#445566" stroke="#88aacc" strokeWidth="1" />
      <circle cx="285" cy="180" r="14" fill="none" stroke="#88aacc" strokeWidth="2" strokeDasharray="4 3">
        <animateTransform attributeName="transform" type="rotate" values="360 285 180;0 285 180" dur="3s" repeatCount="indefinite" />
      </circle>
      <circle cx="285" cy="180" r="5" fill="#445566" stroke="#88aacc" strokeWidth="1" />

      {/* Small gear between */}
      <circle cx="250" cy="185" r="8" fill="none" stroke="#7799bb" strokeWidth="1.5" strokeDasharray="3 2">
        <animateTransform attributeName="transform" type="rotate" values="0 250 185;360 250 185" dur="2s" repeatCount="indefinite" />
      </circle>

      {/* Status lights */}
      <circle cx="195" cy="210" r="4" fill="#44ff44">
        <animate attributeName="fill" values="#44ff44;#22aa22;#44ff44" dur="1.5s" repeatCount="indefinite" />
      </circle>
      <circle cx="207" cy="210" r="4" fill="#ffaa22">
        <animate attributeName="fill" values="#ffaa22;#cc8811;#ffaa22" dur="2s" repeatCount="indefinite" />
      </circle>
      <circle cx="219" cy="210" r="4" fill="#44aaff">
        <animate attributeName="fill" values="#44aaff;#2288cc;#44aaff" dur="1.8s" repeatCount="indefinite" />
      </circle>

      {/* Smoke stack */}
      <rect x="295" y="90" width="16" height="35" fill="#556677" rx="2" />
      {/* Smoke puffs */}
      <circle cx="303" cy="85" r="6" fill="#667788" opacity="0.5">
        <animate attributeName="cy" values="85;55;25" dur="3s" repeatCount="indefinite" />
        <animate attributeName="r" values="6;12;16" dur="3s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.5;0.2;0" dur="3s" repeatCount="indefinite" />
      </circle>
      <circle cx="303" cy="85" r="5" fill="#667788" opacity="0.4">
        <animate attributeName="cy" values="85;50;20" dur="3s" repeatCount="indefinite" begin="1s" />
        <animate attributeName="r" values="5;10;14" dur="3s" repeatCount="indefinite" begin="1s" />
        <animate attributeName="opacity" values="0.4;0.15;0" dur="3s" repeatCount="indefinite" begin="1s" />
      </circle>
      <circle cx="303" cy="85" r="4" fill="#778899" opacity="0.3">
        <animate attributeName="cy" values="85;60;30" dur="3.5s" repeatCount="indefinite" begin="2s" />
        <animate attributeName="r" values="4;9;13" dur="3.5s" repeatCount="indefinite" begin="2s" />
        <animate attributeName="opacity" values="0.3;0.1;0" dur="3.5s" repeatCount="indefinite" begin="2s" />
      </circle>

      {/* Output chute */}
      <rect x="290" y="220" width="40" height="12" fill="#556677" rx="2" />
      <text x="310" y="218" textAnchor="middle" fill="#aabbcc" fontSize="7" fontFamily="monospace">OUTPUT</text>

      {/* ── Processed figures (right side) - neat, with badges ── */}
      {/* Admin figure - red badge, standing tall */}
      <g>
        <circle cx="370" cy="208" r="8" fill="none" stroke="#66dd66" strokeWidth="2" />
        <line x1="370" y1="216" x2="370" y2="232" stroke="#66dd66" strokeWidth="2" />
        <line x1="370" y1="222" x2="360" y2="228" stroke="#66dd66" strokeWidth="2" />
        <line x1="370" y1="222" x2="380" y2="228" stroke="#66dd66" strokeWidth="2" />
        <line x1="370" y1="232" x2="364" y2="242" stroke="#66dd66" strokeWidth="2" />
        <line x1="370" y1="232" x2="376" y2="242" stroke="#66dd66" strokeWidth="2" />
        {/* Happy face */}
        <circle cx="367" cy="206" r="1" fill="#66dd66" />
        <circle cx="373" cy="206" r="1" fill="#66dd66" />
        <path d="M366,210 Q370,213 374,210" fill="none" stroke="#66dd66" strokeWidth="0.8" />
        {/* Admin badge */}
        <rect x="358" y="216" width="24" height="8" fill="#ff4444" rx="2" opacity="0.9" />
        <text x="370" y="223" textAnchor="middle" fill="white" fontSize="5" fontFamily="monospace">ADMIN</text>
        {/* Crown */}
        <polygon points="364,200 367,196 370,199 373,196 376,200" fill="#ffdd44" stroke="#ddaa22" strokeWidth="0.5" />
        {/* Checkmark */}
        <text x="382" y="208" fill="#44ff44" fontSize="10">&#10003;</text>
      </g>

      {/* Operator figure - blue badge */}
      <g>
        <circle cx="420" cy="208" r="8" fill="none" stroke="#66bbdd" strokeWidth="2" />
        <line x1="420" y1="216" x2="420" y2="232" stroke="#66bbdd" strokeWidth="2" />
        <line x1="420" y1="222" x2="410" y2="228" stroke="#66bbdd" strokeWidth="2" />
        <line x1="420" y1="222" x2="430" y2="228" stroke="#66bbdd" strokeWidth="2" />
        <line x1="420" y1="232" x2="414" y2="242" stroke="#66bbdd" strokeWidth="2" />
        <line x1="420" y1="232" x2="426" y2="242" stroke="#66bbdd" strokeWidth="2" />
        {/* Happy face */}
        <circle cx="417" cy="206" r="1" fill="#66bbdd" />
        <circle cx="423" cy="206" r="1" fill="#66bbdd" />
        <path d="M416,210 Q420,213 424,210" fill="none" stroke="#66bbdd" strokeWidth="0.8" />
        {/* Operator badge */}
        <rect x="410" y="216" width="20" height="8" fill="#4488ff" rx="2" opacity="0.9" />
        <text x="420" y="223" textAnchor="middle" fill="white" fontSize="5" fontFamily="monospace">OPS</text>
        {/* Wrench */}
        <text x="432" y="205" fill="#66bbdd" fontSize="9">&#9881;</text>
        {/* Checkmark */}
        <text x="432" y="215" fill="#44ff44" fontSize="8">&#10003;</text>
      </g>

      {/* Viewer figure - gray badge, waving */}
      <g>
        <circle cx="465" cy="208" r="8" fill="none" stroke="#99aabb" strokeWidth="2" />
        <line x1="465" y1="216" x2="465" y2="232" stroke="#99aabb" strokeWidth="2" />
        <line x1="465" y1="222" x2="455" y2="228" stroke="#99aabb" strokeWidth="2" />
        <line x1="465" y1="222" x2="478" y2="214" stroke="#99aabb" strokeWidth="2" />
        <line x1="465" y1="232" x2="459" y2="242" stroke="#99aabb" strokeWidth="2" />
        <line x1="465" y1="232" x2="471" y2="242" stroke="#99aabb" strokeWidth="2" />
        {/* Happy face */}
        <circle cx="462" cy="206" r="1" fill="#99aabb" />
        <circle cx="468" cy="206" r="1" fill="#99aabb" />
        <path d="M461,210 Q465,213 469,210" fill="none" stroke="#99aabb" strokeWidth="0.8" />
        {/* Viewer badge */}
        <rect x="453" y="216" width="24" height="8" fill="#778899" rx="2" opacity="0.9" />
        <text x="465" y="223" textAnchor="middle" fill="white" fontSize="5" fontFamily="monospace">VIEWER</text>
        {/* Glasses */}
        <circle cx="462" cy="205" r="3" fill="none" stroke="#99aabb" strokeWidth="0.6" />
        <circle cx="468" cy="205" r="3" fill="none" stroke="#99aabb" strokeWidth="0.6" />
        <line x1="465" y1="205" x2="465" y2="205" stroke="#99aabb" strokeWidth="0.5" />
      </g>

      {/* Arrow showing flow */}
      <text x="160" y="238" fill="#556677" fontSize="16">&#8594;</text>
      <text x="335" y="238" fill="#556677" fontSize="16">&#8594;</text>

      {/* Caption */}
      <text x="250" y="282" textAnchor="middle" fill="#8899aa" fontSize="11" fontFamily="monospace">
        The People Processing Machine
      </text>
      <text x="250" y="298" textAnchor="middle" fill="#556677" fontSize="9" fontFamily="monospace">
        unsorted humans in &#8594; authorized users out
      </text>
      <text x="250" y="310" textAnchor="middle" fill="#445566" fontSize="7" fontFamily="monospace">
        (no humans were harmed in the making of this feature)
      </text>
    </svg>
  );
}

export function UserManagerPage() {
  const { user: currentUser } = useAuth();
  const [userList, setUserList] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add user modal
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<string>('viewer');
  const [addLoading, setAddLoading] = useState(false);

  // Change password modal
  const [pwOpen, setPwOpen] = useState(false);
  const [pwUser, setPwUser] = useState('');
  const [pwValue, setPwValue] = useState('');
  const [pwLoading, setPwLoading] = useState(false);

  // Change role modal
  const [roleOpen, setRoleOpen] = useState(false);
  const [roleUser, setRoleUser] = useState('');
  const [roleValue, setRoleValue] = useState<string>('viewer');
  const [roleLoading, setRoleLoading] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await users.list();
      setUserList(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  // Load on mount
  useState(() => { loadUsers(); });

  const handleAddUser = async () => {
    if (!newUsername || !newPassword) return;
    setAddLoading(true);
    try {
      await users.create({ username: newUsername, password: newPassword, role: newRole });
      notifications.show({ title: 'User Created', message: `User '${newUsername}' created with role '${newRole}'`, color: 'green' });
      setNewUsername('');
      setNewPassword('');
      setNewRole('viewer');
      loadUsers();
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    } finally {
      setAddLoading(false);
    }
  };

  const handleDeleteUser = async (username: string) => {
    if (!confirm(`Delete user '${username}'? This cannot be undone.`)) return;
    try {
      await users.remove(username);
      notifications.show({ title: 'User Deleted', message: `User '${username}' removed`, color: 'green' });
      loadUsers();
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  };

  const handleChangePassword = async () => {
    if (!pwValue) return;
    setPwLoading(true);
    try {
      await users.changePassword(pwUser, pwValue);
      notifications.show({ title: 'Password Changed', message: `Password updated for '${pwUser}'`, color: 'green' });
      setPwOpen(false);
      setPwValue('');
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    } finally {
      setPwLoading(false);
    }
  };

  const handleChangeRole = async () => {
    setRoleLoading(true);
    try {
      await users.changeRole(roleUser, roleValue);
      notifications.show({ title: 'Role Changed', message: `Role updated to '${roleValue}' for '${roleUser}'`, color: 'green' });
      setRoleOpen(false);
      loadUsers();
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    } finally {
      setRoleLoading(false);
    }
  };

  if (loading) return <Center h={400}><Loader size="xl" /></Center>;
  if (error) return <Alert color="red" title="Error">{error}</Alert>;

  return (
    <Stack>
      <Group gap="sm">
        <IconUsers size={28} />
        <Title order={2}>User Manager</Title>
      </Group>

      <Grid align="flex-start">
        {/* Left: People Processing Machine */}
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Card withBorder shadow="sm" padding="sm" style={{ overflow: 'hidden' }}>
            <PeopleProcessingMachine />
          </Card>
        </Grid.Col>

        {/* Right: Management controls */}
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Stack>
            {/* Add User */}
            <Card withBorder shadow="sm" padding="lg">
              <Title order={4} mb="md">Add User</Title>
              <Stack gap="sm">
                <TextInput
                  label="Username"
                  placeholder="Enter username"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.currentTarget.value)}
                />
                <PasswordInput
                  label="Password"
                  placeholder="Enter password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.currentTarget.value)}
                />
                <Select
                  label="Role"
                  data={[
                    { value: 'admin', label: 'Admin \u2014 Full access' },
                    { value: 'operator', label: 'Operator \u2014 Deploy & manage' },
                    { value: 'viewer', label: 'Viewer \u2014 Read only' },
                  ]}
                  value={newRole}
                  onChange={(v) => setNewRole(v || 'viewer')}
                />
                <Button
                  leftSection={<IconPlus size={16} />}
                  onClick={handleAddUser}
                  loading={addLoading}
                  disabled={!newUsername || !newPassword}
                >
                  Create User
                </Button>
              </Stack>
            </Card>

          </Stack>
        </Grid.Col>
      </Grid>

      <Card withBorder shadow="sm">
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Username</Table.Th>
              <Table.Th>Role</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {userList.map((u) => (
              <Table.Tr key={u.username}>
                <Table.Td>
                  <Text fw={500}>{u.username}</Text>
                </Table.Td>
                <Table.Td>
                  <Badge color={roleBadgeColor[u.role] || 'gray'} variant="light">
                    {u.role}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Group gap="xs" justify="flex-end">
                    <Tooltip label="Change password">
                      <ActionIcon
                        variant="subtle"
                        color="blue"
                        onClick={() => { setPwUser(u.username); setPwValue(''); setPwOpen(true); }}
                      >
                        <IconKey size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Change role">
                      <ActionIcon
                        variant="subtle"
                        color="orange"
                        onClick={() => { setRoleUser(u.username); setRoleValue(u.role); setRoleOpen(true); }}
                      >
                        <IconShield size={16} />
                      </ActionIcon>
                    </Tooltip>
                    {u.username !== currentUser?.username && (
                      <Tooltip label="Delete user">
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          onClick={() => handleDeleteUser(u.username)}
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Tooltip>
                    )}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
            {userList.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={3}>
                  <Text c="dimmed" ta="center" py="lg">No users found</Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Card>

      {/* Change Password Modal */}
      <Modal opened={pwOpen} onClose={() => setPwOpen(false)} title={`Change Password \u2014 ${pwUser}`} centered>
        <Stack>
          <PasswordInput label="New Password" placeholder="Enter new password" value={pwValue}
            onChange={(e) => setPwValue(e.currentTarget.value)} required />
          <Button onClick={handleChangePassword} loading={pwLoading} fullWidth>Update Password</Button>
        </Stack>
      </Modal>

      {/* Change Role Modal */}
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
