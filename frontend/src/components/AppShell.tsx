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
  Stack,
} from '@mantine/core';
import {
  IconDashboard,
  IconServer,
  IconFileReport,
  IconNetwork,
  IconAppWindow,
  IconSettings,
  IconHierarchy2,
  IconRocket,
  IconBolt,
  IconLogout,
  IconUser,
  IconUsers,
  IconTerminal,
  IconCertificate,
  IconSearch,
  IconPackage,
} from '@tabler/icons-react';
import { useAuth } from '../hooks/AuthContext';
import { useAppTheme } from '../hooks/ThemeContext';
import { dashboard, config } from '../services/api';

const monitoringNav = [
  { label: 'Dashboard', icon: IconDashboard, path: '/' },
  { label: 'Nodes', icon: IconServer, path: '/nodes' },
  { label: 'Reports', icon: IconFileReport, path: '/reports' },
];

const deployNav = [
  { label: 'Code Deployment', icon: IconRocket, path: '/deployment' },
];

const encNav = [
  { label: 'Node Classifier', icon: IconHierarchy2, path: '/enc' },
];

const orchNav = [
  { label: 'Orchestration', icon: IconBolt, path: '/orchestration' },
];

const explorerNav = [
  { label: 'PQL Console', icon: IconTerminal, path: '/pql' },
  { label: 'Fact Explorer', icon: IconSearch, path: '/facts' },
  { label: 'Resource Explorer', icon: IconPackage, path: '/resources' },
];

const infraNav = [
  { label: 'Certificates', icon: IconCertificate, path: '/certificates' },
];

const configNav = [
  { label: 'Puppet Configuration', icon: IconNetwork, path: '/config/puppet' },
  { label: 'Settings', icon: IconSettings, path: '/config/app' },
];

export function AppShellLayout() {
  const [opened, setOpened] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const { isFormal } = useAppTheme();
  const [activeSessions, setActiveSessions] = useState<any>(null);
  const [appName, setAppName] = useState('OpenVox GUI');

  useEffect(() => {
    config.getAppName().then((data: any) => {
      if (data?.app_name) { setAppName(data.app_name); document.title = data.app_name; }
    }).catch(() => {});
  }, []);

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

  // Theme-dependent styles
  const headerBg = isFormal ? '#ffffff' : '#1a1b2e';
  const headerBorder = isFormal ? '1px solid #dee2e6' : 'none';
  const navBg = isFormal ? '#f8f9fa' : '#141421';
  const navBorder = isFormal ? '1px solid #dee2e6' : 'none';
  const titleColor = isFormal ? '#212529' : undefined;
  const logoSrc = isFormal ? '/openvox-logo.svg' : '/openvox-logo-orange.svg';
  const sectionLabelColor = isFormal ? '#868e96' : 'dimmed';

  const renderNavGroup = (label: string, items: typeof monitoringNav) => (
    <>
      <Divider my="sm" />
      <Text size="xs" fw={700} c={sectionLabelColor} tt="uppercase" mb="xs" ml="sm">
        {label}
      </Text>
      {items.map((item) => (
        <NavLink
          key={item.path}
          label={item.label}
          leftSection={<item.icon size={18} />}
          active={item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path)}
          onClick={() => { navigate(item.path); setOpened(false); }}
          variant="filled"
          mb={2}
        />
      ))}
    </>
  );

  return (
    <MantineAppShell
      header={{ height: 60 }}
      navbar={{ width: 260, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <MantineAppShell.Header style={{ backgroundColor: headerBg, borderBottom: headerBorder }}>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="xs">
            <Burger opened={opened} onClick={() => setOpened(!opened)} hiddenFrom="sm" size="sm" />
            <Group gap={16} wrap="nowrap" style={{ cursor: 'pointer' }} onClick={() => navigate('/')}>
              <img src={logoSrc} alt="OpenVox" style={{ height: 36, width: 36, flexShrink: 0, display: 'block' }} />
              <Title order={3} c={titleColor} style={{ fontWeight: 700, whiteSpace: 'nowrap', lineHeight: 1 }}>
                {appName}
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

      <MantineAppShell.Navbar p="xs" style={{ backgroundColor: navBg, borderRight: navBorder }}>
        <MantineAppShell.Section grow component={ScrollArea}>
          <Text size="xs" fw={700} c={sectionLabelColor} tt="uppercase" mb="xs" mt="xs" ml="sm">
            Monitoring
          </Text>
          {monitoringNav.map((item) => (
            <NavLink
              key={item.path}
              label={item.label}
              leftSection={<item.icon size={18} />}
              active={item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path)}
              onClick={() => { navigate(item.path); setOpened(false); }}
              variant="filled"
              mb={2}
            />
          ))}

          {renderNavGroup('Code Deployment', deployNav)}
          {renderNavGroup('Node Classifier', encNav)}
          {renderNavGroup('Orchestration', orchNav)}
          {renderNavGroup('PuppetDB Explorer', explorerNav)}
          {renderNavGroup('Infrastructure', infraNav)}
          {renderNavGroup('Settings', configNav)}
        </MantineAppShell.Section>

        <MantineAppShell.Section>
          <Box p="sm">
            <Text size="xs" c="dimmed">OpenVox GUI v1.2.0</Text>
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
