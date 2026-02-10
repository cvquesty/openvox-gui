import { useState, useCallback } from 'react';
import {
  Title, Stack, Card, Table, Group, Button, TextInput, PasswordInput,
  Select, ActionIcon, Badge, Alert, Modal, Text, Tooltip, Loader, Center,
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

export function UserManagerPage() {
  const { user: currentUser } = useAuth();
  const [userList, setUserList] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add user modal
  const [addOpen, setAddOpen] = useState(false);
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
      setAddOpen(false);
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
      <Group justify="space-between">
        <Group gap="sm">
          <IconUsers size={28} />
          <Title order={2}>User Manager</Title>
        </Group>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setAddOpen(true)}>
          Add User
        </Button>
      </Group>

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

      {/* Add User Modal */}
      <Modal opened={addOpen} onClose={() => setAddOpen(false)} title="Add User" centered>
        <Stack>
          <TextInput label="Username" placeholder="Enter username" value={newUsername}
            onChange={(e) => setNewUsername(e.currentTarget.value)} required />
          <PasswordInput label="Password" placeholder="Enter password" value={newPassword}
            onChange={(e) => setNewPassword(e.currentTarget.value)} required />
          <Select label="Role" data={[
            { value: 'admin', label: 'Admin — Full access' },
            { value: 'operator', label: 'Operator — Deploy & manage' },
            { value: 'viewer', label: 'Viewer — Read only' },
          ]} value={newRole} onChange={(v) => setNewRole(v || 'viewer')} />
          <Button onClick={handleAddUser} loading={addLoading} fullWidth>Create User</Button>
        </Stack>
      </Modal>

      {/* Change Password Modal */}
      <Modal opened={pwOpen} onClose={() => setPwOpen(false)} title={`Change Password — ${pwUser}`} centered>
        <Stack>
          <PasswordInput label="New Password" placeholder="Enter new password" value={pwValue}
            onChange={(e) => setPwValue(e.currentTarget.value)} required />
          <Button onClick={handleChangePassword} loading={pwLoading} fullWidth>Update Password</Button>
        </Stack>
      </Modal>

      {/* Change Role Modal */}
      <Modal opened={roleOpen} onClose={() => setRoleOpen(false)} title={`Change Role — ${roleUser}`} centered>
        <Stack>
          <Select label="Role" data={[
            { value: 'admin', label: 'Admin — Full access' },
            { value: 'operator', label: 'Operator — Deploy & manage' },
            { value: 'viewer', label: 'Viewer — Read only' },
          ]} value={roleValue} onChange={(v) => setRoleValue(v || 'viewer')} />
          <Button onClick={handleChangeRole} loading={roleLoading} fullWidth>Update Role</Button>
        </Stack>
      </Modal>
    </Stack>
  );
}
