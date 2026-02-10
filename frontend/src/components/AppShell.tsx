import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  AppShell as MantineAppShell,
  NavLink,
  Title,
  Group,
  ThemeIcon,
  Text,
  Burger,
  ScrollArea,
  Divider,
  Box,
} from '@mantine/core';
import {
  IconDashboard,
  IconServer,
  IconFileReport,
  IconCategory,
  IconSettings,
  IconNetwork,
  IconDatabase,
  IconAppWindow,
  IconHierarchy2,
  IconRuler,
  IconTags,
} from '@tabler/icons-react';

const mainNav = [
  { label: 'Dashboard', icon: IconDashboard, path: '/' },
  { label: 'Nodes', icon: IconServer, path: '/nodes' },
  { label: 'Reports', icon: IconFileReport, path: '/reports' },
];

const encNav = [
  { label: 'Node Groups', icon: IconHierarchy2, path: '/enc/groups' },
  { label: 'Classifications', icon: IconTags, path: '/enc/classifications' },
  { label: 'Rules', icon: IconRuler, path: '/enc/rules' },
];

const configNav = [
  { label: 'PuppetServer', icon: IconNetwork, path: '/config/puppet' },
  { label: 'PuppetDB', icon: IconDatabase, path: '/config/puppetdb' },
  { label: 'Application', icon: IconAppWindow, path: '/config/app' },
];

export function AppShellLayout() {
  const [opened, setOpened] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <MantineAppShell
      header={{ height: 60 }}
      navbar={{ width: 260, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <MantineAppShell.Header>
        <Group h="100%" px="md">
          <Burger opened={opened} onClick={() => setOpened(!opened)} hiddenFrom="sm" size="sm" />
          <Group gap="xs">
            <ThemeIcon size="lg" variant="gradient" gradient={{ from: 'violet', to: 'cyan' }}>
              <IconCategory size={20} />
            </ThemeIcon>
            <Title order={3} style={{ fontWeight: 700 }}>
              OpenVox GUI
            </Title>
          </Group>
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
            Configuration
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
            <Text size="xs" c="dimmed">OpenVox GUI v0.1.0</Text>
          </Box>
        </MantineAppShell.Section>
      </MantineAppShell.Navbar>

      <MantineAppShell.Main>
        <Outlet />
      </MantineAppShell.Main>
    </MantineAppShell>
  );
}
