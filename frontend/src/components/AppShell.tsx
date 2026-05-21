/**
 * OpenVox GUI - AppShell.tsx
 * 
 * Component documentation to be expanded.
 */
import { useState, useEffect, ReactNode } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  AppShell as MantineAppShell,
  NavLink,
  Title,
  Group,
  Text,
  Burger,
  ScrollArea,
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
  IconDownload,
  IconFileText,
  IconTool,
  IconChartBar,
  IconHeartRateMonitor,
  IconTimeline,
  IconChartPie,
  IconBinaryTree,
  IconTopologyRing,
  IconActivity,
  IconGridDots,
  IconWorld as IconWorldNav,
  IconStack2,
} from '@tabler/icons-react';
import { useAuth } from '../hooks/AuthContext';
import { useAppTheme } from '../hooks/ThemeContext';
import { dashboard, config } from '../services/api';
import { APP_VERSION } from '../version';

// Navigation item type (supports nested sub-items)
interface NavItem {
  label: string;
  icon: any;
  path: string;
  children?: NavItem[];
}

const dashboardNav: NavItem[] = [
  { label: 'Overview', icon: IconDashboard, path: '/' },
  { label: 'Nodes', icon: IconServer, path: '/nodes' },
];

// Infrastructure was promoted from a sub-group of Monitoring to a
// top-level nav group of its own, parallel to Monitoring / Code /
// Data / Information / Settings (3.3.5-8+).
const infrastructureNav: NavItem[] = [
  { label: 'Certificate Authority', icon: IconCertificate, path: '/certificates' },
  { label: 'Orchestration', icon: IconBolt, path: '/orchestration' },
  { label: 'Agent Install', icon: IconDownload, path: '/installer' },
];

const codeNav: NavItem[] = [
  { label: 'Classification', icon: IconHierarchy2, path: '/enc' },
  { label: 'Deployment', icon: IconRocket, path: '/deployment' },
];

const dataNav: NavItem[] = [
  { label: 'Hiera Data Files', icon: IconPackage, path: '/data/hiera' },
  { label: 'Hiera Lookup', icon: IconSearch, path: '/data/lookup' },
];

const explorerNav: NavItem[] = [
  { label: 'PQL Console', icon: IconTerminal, path: '/pql' },
  { label: 'Fact Explorer', icon: IconSearch, path: '/facts' },
  { label: 'Resource Explorer', icon: IconPackage, path: '/resources' },
  { label: 'Package Inventory', icon: IconPackage, path: '/packages' },
  { label: 'Certificate Audit', icon: IconCertificate, path: '/cert-audit' },
];

const metricsNav: NavItem[] = [
  { label: 'Fleet Compliance', icon: IconHeartRateMonitor, path: '/metrics/compliance' },
  { label: 'Run Performance', icon: IconActivity, path: '/metrics/performance' },
  { label: 'Change Timeline', icon: IconTimeline, path: '/metrics/timeline' },
  { label: 'Fact Distribution', icon: IconChartPie, path: '/metrics/facts' },
  { label: 'Classification Tree', icon: IconBinaryTree, path: '/metrics/classification' },
  { label: 'Catalog Graph', icon: IconTopologyRing, path: '/metrics/catalog' },
  { label: 'PuppetDB Health', icon: IconHeartRateMonitor, path: '/metrics/health' },
  { label: 'Node Heatmap', icon: IconGridDots, path: '/metrics/heatmap' },
  { label: 'Environments', icon: IconWorldNav, path: '/metrics/environments' },
  { label: 'Class Coverage', icon: IconStack2, path: '/metrics/classes' },
];

const logsNav: NavItem[] = [
  { label: 'Log Viewer', icon: IconFileText, path: '/logs' },
  { label: 'Reports', icon: IconFileReport, path: '/reports' },
];

const configNav: NavItem[] = [
  { label: 'OpenVox Configuration', icon: IconNetwork, path: '/config/puppet' },
  { label: 'Application Configuration', icon: IconSettings, path: '/config/app' },
];

export function AppShellLayout() {
  const [opened, setOpened] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const { isFormal } = useAppTheme();
  const [activeSessions, setActiveSessions] = useState<any>(null);
  const [appName, setAppName] = useState('OpenVox GUI');
  // Track which nav groups are expanded (keyed by label)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

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
  // Recursive navigation renderer — supports nested children
  const renderNavItem = (item: NavItem, depth: number = 0): ReactNode => {
    const ItemIcon = item.icon;
    const isActive = item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path);
    const hasChildren = item.children && item.children.length > 0;
    const indent = depth * 20;

    if (hasChildren) {
      const isOpen = openGroups[item.label] ?? false;

      const handleClick = () => {
        navigate(item.path);
        setOpened(false);
        setOpenGroups((prev) => ({ ...prev, [item.label]: true }));
      };

      return (
        <NavLink
          key={item.path}
          label={item.label}
          leftSection={<ItemIcon size={18} />}
          childrenOffset={24}
          opened={isOpen}
          onChange={(opened) => setOpenGroups((prev) => ({ ...prev, [item.label]: opened }))}
          onClick={handleClick}
          variant="filled"
          mb={1}
          pl={depth > 0 ? `${indent}px` : undefined}
        >
          {item.children!.map((child) => renderNavItem(child, depth + 1))}
        </NavLink>
      );
    }

    // Leaf item — navigate directly
    return (
      <NavLink
        key={item.path}
        label={item.label}
        leftSection={<ItemIcon size={depth > 0 ? 16 : 18} />}
        active={isActive}
        onClick={() => { navigate(item.path); setOpened(false); }}
        variant="filled"
        mb={1}
        pl={depth > 0 ? `${indent + 4}px` : undefined}
      />
    );
  };

  // Render a top-level nav group (label + items)
  const renderNavGroup = (label: string, icon: any, items: NavItem[], color?: string) => {
    const GroupIcon = icon;
    const iconColor = color || undefined;

    // Single-item group without children — render directly
    if (items.length === 1 && !items[0].children) {
      const item = items[0];
      const ItemIcon = item.icon;
      return (
        <NavLink
          key={item.path}
          label={label}
          leftSection={<ItemIcon size={18} color={iconColor} />}
          active={item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path)}
          onClick={() => { navigate(item.path); setOpened(false); }}
          variant="filled"
          mb={2}
        />
      );
    }

    // Multi-item or nested groups — collapsed by default
    const isOpen = openGroups[label] ?? false;

    const handleParentClick = () => {
      // Navigate to first child item (e.g., Dashboard for Monitoring) and toggle expand
      if (items.length > 0) {
        navigate(items[0].path);
      }
      setOpenGroups((prev) => ({ ...prev, [label]: !isOpen }));
      setOpened(false);
    };

    return (
      <NavLink
        label={label}
        leftSection={<GroupIcon size={18} color={iconColor} />}
        childrenOffset={24}
        opened={isOpen}
        onChange={(opened) => setOpenGroups((prev) => ({ ...prev, [label]: opened }))}
        onClick={handleParentClick}
        variant="filled"
        mb={2}
      >
        {items.map((item) => renderNavItem(item, 0))}
      </NavLink>
    );
  };

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
          {renderNavGroup('Dashboard', IconDashboard, dashboardNav, '#3498db')}
          {renderNavGroup('Infrastructure', IconCertificate, infrastructureNav, '#e67e22')}
          {renderNavGroup('Code', IconRocket, codeNav, '#2ecc71')}
          {renderNavGroup('Data', IconPackage, dataNav, '#9b59b6')}
          {renderNavGroup('Metrics', IconChartBar, metricsNav, '#1abc9c')}
          {renderNavGroup('Tools', IconTool, explorerNav, '#f39c12')}
          {renderNavGroup('Logs', IconFileText, logsNav, '#e74c3c')}
          {renderNavGroup('Settings', IconSettings, configNav, '#95a5a6')}
        </MantineAppShell.Section>

        <MantineAppShell.Section>
          <Box p="sm">
            <Text size="xs" c="dimmed">OpenVox GUI v{APP_VERSION}</Text>
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
