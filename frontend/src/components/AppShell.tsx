import { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  AppShell as MantineAppShell,
  NavLink,
  Title,
  Group,
  Text,
  Burger,
  ScrollArea,
  Divider,
  Box,
  Badge,
  ActionIcon,
  Tooltip,
  HoverCard,
  ThemeIcon,
  Stack,
} from '@mantine/core';
import {
  IconDashboard,
  IconServer,
  IconFileReport,
  IconNetwork,
  IconDatabase,
  IconAppWindow,
  IconHierarchy2,
  IconRuler,
  IconTags,
  IconRocket,
  IconLogout,
  IconUser,
  IconUsers,
} from '@tabler/icons-react';
import { useAuth } from '../hooks/AuthContext';
import { dashboard } from '../services/api';

const mainNav = [
  { label: 'Dashboard', icon: IconDashboard, path: '/' },
  { label: 'Reports', icon: IconFileReport, path: '/reports' },
];

const deployNav = [
  { label: 'Code Deployment', icon: IconRocket, path: '/deployment' },
];

const encNav = [
  { label: 'Node Groups', icon: IconHierarchy2, path: '/enc/groups' },
  { label: 'Classifications', icon: IconTags, path: '/enc/classifications' },
  { label: 'Rules', icon: IconRuler, path: '/enc/rules' },
];

const configNav = [
  { label: 'Puppet Configuration', icon: IconNetwork, path: '/config/puppet' },
  { label: 'Application', icon: IconAppWindow, path: '/config/app' },
];


const adminNav = [
  { label: 'User Manager', icon: IconUsers, path: '/users' },
];
export function AppShellLayout() {
  const [opened, setOpened] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const [activeSessions, setActiveSessions] = useState<any>(null);

  useEffect(() => {
    const fetchSessions = () => {
      dashboard.getActiveSessions()
        .then(setActiveSessions)
        .catch(() => {});
    };
    fetchSessions();
    const interval = setInterval(fetchSessions, 30000);
    return () => clearInterval(interval);
  }, []);

  const activeCount = activeSessions?.active_count || 0;
  const activeUsersList = activeSessions?.users || [];

  return (
    <MantineAppShell
      header={{ height: 60 }}
      navbar={{ width: 260, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <MantineAppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="xs">
            <Burger opened={opened} onClick={() => setOpened(!opened)} hiddenFrom="sm" size="sm" />
            <Group gap={16} wrap="nowrap">
              <img src="/openvox-logo.svg" alt="OpenVox" style={{ height: 36, width: 36, flexShrink: 0, display: 'block' }} />
              <Title order={3} style={{ fontWeight: 700, whiteSpace: 'nowrap', lineHeight: 1 }}>
                OpenVox GUI
              </Title>
            </Group>
          </Group>
          {user && (
            <Group gap="sm">
              <Badge variant="outline" color="gray" size="sm">
                <Group gap={4}>
                  <IconUser size={12} />
                  {user.username} ({user.role})
                </Group>
              </Badge>
              <Tooltip label="Sign out">
                <ActionIcon variant="subtle" color="gray" onClick={logout}>
                  <IconLogout size={18} />
                </ActionIcon>
              </Tooltip>
            </Group>
          )}
        </Group>
      </MantineAppShell.Header>

      <MantineAppShell.Navbar p="xs">
        <MantineAppShell.Section grow component={ScrollArea}>
          <Text size="xs" fw={700} c="dimmed" tt="uppercase" mb="xs" mt="xs" ml="sm">
            Monitoring
          </Text>
          {mainNav.map((item) => (
            <NavLink
              key={item.path}
              label={item.label}
              leftSection={<item.icon size={18} />}
              active={location.pathname === item.path}
              onClick={() => { navigate(item.path); setOpened(false); }}
              variant="filled"
              mb={2}
            />
          ))}

          <Divider my="sm" />
          <Text size="xs" fw={700} c="dimmed" tt="uppercase" mb="xs" ml="sm">
            Code Deployment
          </Text>
          {deployNav.map((item) => (
            <NavLink
              key={item.path}
              label={item.label}
              leftSection={<item.icon size={18} />}
              active={location.pathname === item.path}
              onClick={() => { navigate(item.path); setOpened(false); }}
              variant="filled"
              mb={2}
            />
          ))}

          <Divider my="sm" />
          <Text size="xs" fw={700} c="dimmed" tt="uppercase" mb="xs" ml="sm">
            Node Classifier
          </Text>
          {encNav.map((item) => (
            <NavLink
              key={item.path}
              label={item.label}
              leftSection={<item.icon size={18} />}
              active={location.pathname === item.path}
              onClick={() => { navigate(item.path); setOpened(false); }}
              variant="filled"
              mb={2}
            />
          ))}

          <Divider my="sm" />
          <Text size="xs" fw={700} c="dimmed" tt="uppercase" mb="xs" ml="sm">
            Administration
          </Text>
          {adminNav.map((item) => (
            <NavLink
              key={item.path}
              label={item.label}
              leftSection={<item.icon size={18} />}
              active={location.pathname === item.path}
              onClick={() => { navigate(item.path); setOpened(false); }}
              variant="filled"
              mb={2}
            />
          ))}

          <Divider my="sm" />
          <Text size="xs" fw={700} c="dimmed" tt="uppercase" mb="xs" ml="sm">
            Settings
          </Text>
          {configNav.map((item) => (
            <NavLink
              key={item.path}
              label={item.label}
              leftSection={<item.icon size={18} />}
              active={location.pathname === item.path}
              onClick={() => { navigate(item.path); setOpened(false); }}
              variant="filled"
              mb={2}
            />
          ))}
        </MantineAppShell.Section>

        <MantineAppShell.Section>
          <Box p="sm">
            <Text size="xs" c="dimmed">OpenVox GUI v0.2.19</Text>
            <HoverCard width={220} shadow="md" position="right" withArrow openDelay={200}>
              <HoverCard.Target>
                <Text size="xs" c="dimmed" style={{ cursor: 'pointer' }}>
                  <IconUsers size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                  {activeCount} active {activeCount === 1 ? 'user' : 'users'}
                </Text>
              </HoverCard.Target>
              <HoverCard.Dropdown>
                <Text fw={600} size="xs" mb={4}>Active (last 15 min)</Text>
                {activeUsersList.length === 0 ? (
                  <Text c="dimmed" size="xs">None</Text>
                ) : (
                  <Stack gap={2}>
                    {activeUsersList.map((u: any) => (
                      <Text key={u.username} size="xs">{u.username}{u.ip_address ? ` (${u.ip_address})` : ''}</Text>
                    ))}
                  </Stack>
                )}
              </HoverCard.Dropdown>
            </HoverCard>
          </Box>
        </MantineAppShell.Section>
      </MantineAppShell.Navbar>

      <MantineAppShell.Main>
        <Outlet />
      </MantineAppShell.Main>
    </MantineAppShell>
  );
}
