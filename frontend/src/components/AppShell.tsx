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
  Kbd,
} from '@mantine/core';
import { useHotkeys } from '@mantine/hooks';
import { CommandPalette } from './CommandPalette';
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
  IconListDetails,
  IconHeartbeat,
  IconKeyboard,
} from '@tabler/icons-react';
import { useAuth } from '../hooks/AuthContext';
import { useAppTheme } from '../hooks/ThemeContext';
import { useActivity } from '../hooks/ActivityContext';
import { dashboard, config, nodes as nodesApi } from '../services/api';
import { APP_VERSION } from '../version';
import type { PaletteAction } from './CommandPalette';

// Navigation item type (supports nested sub-items)
interface NavItem {
  label: string;
  icon: any;
  path: string;
  children?: NavItem[];
}

// sruiux2 P0-1 — operator mental model: Overview → Infra → Class/Code → Data → Explore → Insights → Settings
const overviewNav: NavItem[] = [
  { label: 'Dashboard', icon: IconDashboard, path: '/' },
  { label: 'Nodes', icon: IconServer, path: '/nodes' },
];

const infrastructureNav: NavItem[] = [
  { label: 'Certificate Authority', icon: IconCertificate, path: '/certificates' },
  { label: 'Orchestration', icon: IconBolt, path: '/orchestration' },
  { label: 'Agent Install', icon: IconDownload, path: '/installer' },
  { label: 'Certificate Audit', icon: IconCertificate, path: '/cert-audit' },
];

const classificationCodeNav: NavItem[] = [
  { label: 'Classification (ENC)', icon: IconHierarchy2, path: '/enc' },
  { label: 'Code Deployment', icon: IconRocket, path: '/deployment' },
];

const dataNav: NavItem[] = [
  { label: 'Hiera Data Files', icon: IconPackage, path: '/data/hiera' },
  { label: 'Hiera Lookup', icon: IconSearch, path: '/data/lookup' },
];

/** Power explorers — promoted from "Tools" (sruiux2) */
const exploreNav: NavItem[] = [
  { label: 'PQL Console', icon: IconTerminal, path: '/pql' },
  { label: 'Fact Explorer', icon: IconSearch, path: '/facts' },
  { label: 'Resource Explorer', icon: IconPackage, path: '/resources' },
  { label: 'Package Inventory', icon: IconPackage, path: '/packages' },
];

/** Analytics + history — Monitoring is the NOC single-pane; catalog lists full pages */
const insightsNav: NavItem[] = [
  { label: 'Monitoring', icon: IconChartBar, path: '/insights' },
  { label: 'Insights catalog', icon: IconChartBar, path: '/insights/all' },
  { label: 'Reports', icon: IconFileReport, path: '/reports' },
  { label: 'Inventory', icon: IconListDetails, path: '/inventory' },
  { label: 'Log Viewer', icon: IconFileText, path: '/logs' },
  { label: 'Fleet Compliance', icon: IconHeartRateMonitor, path: '/insights/compliance' },
  { label: 'Node Health', icon: IconHeartbeat, path: '/insights/node-health' },
  { label: 'Change Timeline', icon: IconTimeline, path: '/insights/timeline' },
];

const configNav: NavItem[] = [
  { label: 'OpenVox Configuration', icon: IconNetwork, path: '/config/puppet' },
  { label: 'Application Configuration', icon: IconSettings, path: '/config/app' },
];

/** Top-level sidebar groups — route→expand mapping and persistence. */
const NAV_GROUP_DEFS: { label: string; items: NavItem[] }[] = [
  { label: 'Overview', items: overviewNav },
  { label: 'Infrastructure', items: infrastructureNav },
  { label: 'Classification & Code', items: classificationCodeNav },
  { label: 'Data', items: dataNav },
  { label: 'Explore', items: exploreNav },
  { label: 'Insights', items: insightsNav },
  { label: 'Settings', items: configNav },
];

const NAV_GROUPS_STORAGE_KEY = 'openvox-gui-nav-groups-v1';

/** Active leaf — Monitoring is exact `/insights` only so sub-routes don't all highlight it. */
function navItemMatchesPath(pathname: string, itemPath: string): boolean {
  if (itemPath === '/') return pathname === '/' || pathname === '';
  if (itemPath === '/insights') {
    return pathname === '/insights' || pathname === '/insights/';
  }
  return pathname === itemPath || pathname.startsWith(`${itemPath}/`);
}

function pathBelongsToGroup(pathname: string, items: NavItem[]): boolean {
  return items.some((item) => navItemMatchesPath(pathname, item.path));
}

function groupsForPathname(pathname: string): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const g of NAV_GROUP_DEFS) {
    if (pathBelongsToGroup(pathname, g.items)) out[g.label] = true;
  }
  return out;
}

function loadStoredNavGroups(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(NAV_GROUPS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function AppShellLayout() {
  const [opened, setOpened] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const { isDark } = useAppTheme();
  const [activeSessions, setActiveSessions] = useState<any>(null);
  const [appName, setAppName] = useState('OpenVox GUI');
  const [nodeNames, setNodeNames] = useState<string[]>([]);
  // Sidebar sections: persist expand/collapse; not locked open while on a child page
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => ({
    ...loadStoredNavGroups(),
    ...groupsForPathname(typeof window !== 'undefined' ? window.location.pathname : '/'),
  }));
  const { items: activityItems } = useActivity();
  const runningCount = activityItems.filter((i) => i.status === 'running').length;

  useHotkeys([
    ['mod+K', () => setPaletteOpen((v) => !v)],
  ]);

  // On route change into a section, expand that section once (deep links / child clicks).
  // Do not re-lock open: user may collapse the header while staying on a child page.
  useEffect(() => {
    const mustOpen = groupsForPathname(location.pathname);
    if (Object.keys(mustOpen).length === 0) return;
    setOpenGroups((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const label of Object.keys(mustOpen)) {
        // Only auto-expand if we have no explicit preference yet (undefined)
        if (next[label] === undefined) {
          next[label] = true;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [location.pathname]);

  useEffect(() => {
    try {
      localStorage.setItem(NAV_GROUPS_STORAGE_KEY, JSON.stringify(openGroups));
    } catch {
      /* ignore quota */
    }
  }, [openGroups]);

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

  useEffect(() => {
    nodesApi.list()
      .then((ns: any[]) => setNodeNames(ns.map((n) => n.certname).filter(Boolean).slice(0, 40)))
      .catch(() => {});
  }, []);

  const paletteExtra: PaletteAction[] = [
    { id: 'insights-hub', label: 'Insights hub (all metrics)', path: '/insights', keywords: 'metrics catalog launcher' },
    ...nodeNames.map((cn) => ({
      id: `node-${cn}`,
      label: `Node: ${cn}`,
      path: `/nodes/${cn}`,
      keywords: `certname fleet ${cn}`,
    })),
  ];

  const activeCount = activeSessions?.active_count || 0;
  const activeUsersList = activeSessions?.users || [];

  // Theme-dependent styles
  const headerBg = !isDark ? '#ffffff' : '#1a1b2e';
  const headerBorder = !isDark ? '1px solid #dee2e6' : 'none';
  const navBg = !isDark ? '#f8f9fa' : '#141421';
  const navBorder = !isDark ? '1px solid #dee2e6' : 'none';
  const titleColor = !isDark ? '#212529' : undefined;
  const logoSrc = !isDark ? '/openvox-logo.svg' : '/openvox-logo-orange.svg';
  // Recursive navigation renderer — supports nested children
  const renderNavItem = (item: NavItem, depth: number = 0): ReactNode => {
    const ItemIcon = item.icon;
    const isActive = navItemMatchesPath(location.pathname, item.path);
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
          onChange={(o) => setOpenGroups((prev) => ({ ...prev, [item.label]: o }))}
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
    const groupHasActive = pathBelongsToGroup(location.pathname, items);

    // Single-item group without children — render directly
    if (items.length === 1 && !items[0].children) {
      const item = items[0];
      const ItemIcon = item.icon;
      return (
        <NavLink
          key={item.path}
          label={label}
          leftSection={<ItemIcon size={18} color={iconColor} />}
          active={navItemMatchesPath(location.pathname, item.path)}
          onClick={() => { navigate(item.path); setOpened(false); }}
          variant="filled"
          mb={2}
        />
      );
    }

    // User-controlled expand; default open when on a child and no preference stored yet
    const isOpen = openGroups[label] ?? groupHasActive;
    const parentActive = groupHasActive;

    const setGroupOpen = (open: boolean) => {
      setOpenGroups((prev) => ({ ...prev, [label]: open }));
    };

    const handleParentClick = () => {
      const currentlyOpen = openGroups[label] ?? groupHasActive;
      if (currentlyOpen) {
        // Collapse child list (accordion-style)
        setGroupOpen(false);
      } else {
        setGroupOpen(true);
        if (items.length > 0) {
          navigate(items[0].path);
        }
      }
      setOpened(false);
    };

    return (
      <NavLink
        label={label}
        leftSection={<GroupIcon size={18} color={iconColor} />}
        childrenOffset={24}
        opened={isOpen}
        active={parentActive}
        onChange={(o) => {
          // Chevron: allow expand and collapse freely
          setGroupOpen(o);
        }}
        onClick={handleParentClick}
        variant="filled"
        mb={2}
      >
        {items.map((item) => (
          <div key={item.path} onClickCapture={() => setGroupOpen(true)}>
            {renderNavItem(item, 0)}
          </div>
        ))}
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
              <HoverCard width={280} shadow="md" position="bottom" withArrow openDelay={150}>
                <HoverCard.Target>
                  <Badge
                    variant={runningCount > 0 ? 'filled' : 'outline'}
                    color={runningCount > 0 ? 'orange' : 'gray'}
                    size="sm"
                    style={{ cursor: 'default' }}
                  >
                    <Group gap={4}>
                      <IconActivity size={12} />
                      {runningCount > 0 ? `${runningCount} running` : 'Activity'}
                    </Group>
                  </Badge>
                </HoverCard.Target>
                <HoverCard.Dropdown>
                  <Text fw={600} size="xs" mb={6}>Recent activity</Text>
                  {activityItems.length === 0 ? (
                    <Text size="xs" c="dimmed">No runs this session yet</Text>
                  ) : (
                    <Stack gap={4}>
                      {activityItems.slice(0, 8).map((a) => (
                        <Text
                          key={a.id}
                          size="xs"
                          c={a.status === 'error' ? 'red' : a.status === 'running' ? 'orange' : undefined}
                          style={a.href ? { cursor: 'pointer', textDecoration: 'underline' } : undefined}
                          onClick={() => a.href && navigate(a.href)}
                        >
                          {a.status === 'running' ? '… ' : a.status === 'error' ? '✗ ' : '✓ '}
                          {a.label}
                          {a.detail ? ` — ${a.detail}` : ''}
                        </Text>
                      ))}
                    </Stack>
                  )}
                </HoverCard.Dropdown>
              </HoverCard>
              <Tooltip
                label={
                  <Group gap={4}>
                    <Text size="xs">Command palette</Text>
                    <Kbd size="xs">⌘</Kbd>
                    <Kbd size="xs">K</Kbd>
                  </Group>
                }
              >
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  onClick={() => setPaletteOpen(true)}
                  aria-label="Open command palette"
                >
                  <IconKeyboard size={18} />
                </ActionIcon>
              </Tooltip>
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
          {renderNavGroup('Overview', IconDashboard, overviewNav, '#3498db')}
          {renderNavGroup('Infrastructure', IconCertificate, infrastructureNav, '#e67e22')}
          {renderNavGroup('Classification & Code', IconRocket, classificationCodeNav, '#2ecc71')}
          {renderNavGroup('Data', IconPackage, dataNav, '#9b59b6')}
          {renderNavGroup('Explore', IconTool, exploreNav, '#f39c12')}
          {renderNavGroup('Insights', IconChartBar, insightsNav, '#1abc9c')}
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

      <CommandPalette
        opened={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        extraActions={paletteExtra}
      />
    </MantineAppShell>
  );
}
