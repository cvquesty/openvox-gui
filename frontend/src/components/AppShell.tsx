/**
 * OpenVox GUI - AppShell.tsx
 * 
 * Component documentation to be expanded.
 */
import { useState, useEffect, ReactNode } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router';
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
  IconSun,
  IconMoon,
  IconMoodSmile,
} from '@tabler/icons-react';
import { useAuth } from '../hooks/AuthContext';
import { useAppTheme, type AppTheme } from '../hooks/ThemeContext';
import { useActivity } from '../hooks/ActivityContext';
import { useInsightsTrickle } from '../hooks/useInsightsTrickle';
import { useAppWarmup } from '../hooks/useAppWarmup';
import { canAccessPath } from '../utils/canAccess';
import { prefetchRoute } from '../utils/routePrefetch';
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
  { label: 'Reports', icon: IconFileReport, path: '/reports' },
];

const infrastructureNav: NavItem[] = [
  { label: 'Certificate Authority', icon: IconCertificate, path: '/certificates' },
  { label: 'Orchestration', icon: IconBolt, path: '/orchestration' },
  { label: 'Agent Install', icon: IconDownload, path: '/installer' },
  { label: 'Certificate Audit', icon: IconListDetails, path: '/cert-audit' },
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
  { label: 'Resource Explorer', icon: IconStack2, path: '/resources' },
  { label: 'Package Inventory', icon: IconPackage, path: '/packages' },
];

/** Monitoring wallboard + catalog. Metric pages live in the catalog, not the sidebar. */
const insightsNav: NavItem[] = [
  { label: 'Monitoring', icon: IconHeartbeat, path: '/insights' },
  { label: 'Insights catalog', icon: IconGridDots, path: '/insights/all' },
  { label: 'Inventory', icon: IconListDetails, path: '/inventory' },
  { label: 'Log Viewer', icon: IconFileText, path: '/logs' },
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

/** Viewers may read fleet/metrics; mutating Play/Deploy/Settings stay hidden. */
function filterNavForRole(items: NavItem[], role?: string): NavItem[] {
  return items.flatMap((item) => {
    if (!canAccessPath(item.path, role)) return [];
    if (!item.children?.length) return [item];
    return [{ ...item, children: filterNavForRole(item.children, role) }];
  });
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
  const { isDark, theme, setTheme } = useAppTheme();
  const [activeSessions, setActiveSessions] = useState<any>(null);
  const [appName, setAppName] = useState('OpenVox GUI');
  const [nodeNames, setNodeNames] = useState<string[]>([]);
  /** Which console backend served this session (footer under active users). */
  const [consoleHost, setConsoleHost] = useState<string>('');
  const [consoleIp, setConsoleIp] = useState<string>('');
  // Sidebar sections: persist expand/collapse; not locked open while on a child page
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => ({
    ...loadStoredNavGroups(),
    ...groupsForPathname(typeof window !== 'undefined' ? window.location.pathname : '/'),
  }));
  const { items: activityItems } = useActivity();
  const runningCount = activityItems.filter((i) => i.status === 'running').length;
  useInsightsTrickle(45000);
  useAppWarmup();

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
    // Public /api/version — hostname + facter-style ipaddress for this console
    fetch('/api/version', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        if (data.hostname) setConsoleHost(String(data.hostname));
        if (data.ipaddress) setConsoleIp(String(data.ipaddress));
      })
      .catch(() => {});
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

  const titleColor = !isDark ? '#0f172a' : undefined;
  const logoSrc = !isDark ? '/openvox-logo.svg' : '/openvox-logo-orange.svg';
  const cycleTheme = () => {
    const order: AppTheme[] = ['light', 'dark', 'robots'];
    const next = order[(order.indexOf(theme) + 1) % order.length];
    setTheme(next);
  };
  const ThemeIcon = theme === 'light' ? IconSun : theme === 'dark' ? IconMoon : IconMoodSmile;
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
          onMouseEnter={() => {
            prefetchRoute(item.path);
            item.children?.forEach((child) => prefetchRoute(child.path));
          }}
          onFocus={() => prefetchRoute(item.path)}
          mb={4}
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
        onMouseEnter={() => prefetchRoute(item.path)}
        onFocus={() => prefetchRoute(item.path)}
        mb={1}
        pl={depth > 0 ? `${indent + 4}px` : undefined}
      />
    );
  };

  // Render a top-level nav group (label + items)
  const renderNavGroup = (label: string, icon: any, items: NavItem[]) => {
    if (items.length === 0) return null;
    const GroupIcon = icon;
    const groupHasActive = pathBelongsToGroup(location.pathname, items);

    // Single-item group without children — render directly
    if (items.length === 1 && !items[0].children) {
      const item = items[0];
      const ItemIcon = item.icon;
      return (
        <NavLink
          key={item.path}
          label={label}
          leftSection={<ItemIcon size={18} stroke={1.6} />}
          active={navItemMatchesPath(location.pathname, item.path)}
          onClick={() => { navigate(item.path); setOpened(false); }}
          onMouseEnter={() => prefetchRoute(item.path)}
          onFocus={() => prefetchRoute(item.path)}
          mb={4}
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
      setGroupOpen(!currentlyOpen);
    };

    return (
      <NavLink
        label={label}
        leftSection={<GroupIcon size={18} stroke={1.6} />}
        childrenOffset={24}
        opened={isOpen}
        active={parentActive}
        onChange={(o) => {
          // Chevron: allow expand and collapse freely
          setGroupOpen(o);
        }}
        onClick={handleParentClick}
        onMouseEnter={() => items.forEach((item) => prefetchRoute(item.path))}
        mb={4}
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
      header={{ height: 56 }}
      navbar={{ width: 248, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="lg"
    >
      <MantineAppShell.Header className="ov-app-header">
        <Group h="100%" px="lg" justify="space-between">
          <Group gap="xs">
            <Burger opened={opened} onClick={() => setOpened(!opened)} hiddenFrom="sm" size="sm" />
            <Group gap={12} wrap="nowrap" style={{ cursor: 'pointer' }} onClick={() => navigate('/')}>
              <img src={logoSrc} alt="OpenVox" style={{ height: 30, width: 30, flexShrink: 0, display: 'block' }} />
              <Title order={4} c={titleColor} style={{ fontWeight: 650, whiteSpace: 'nowrap', letterSpacing: '-0.02em' }}>
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
              <Tooltip label={`Theme: ${theme === 'robots' ? 'Robots!!' : theme}`}>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  onClick={cycleTheme}
                  aria-label="Cycle theme"
                >
                  <ThemeIcon size={18} stroke={1.6} />
                </ActionIcon>
              </Tooltip>
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
                  <IconKeyboard size={18} stroke={1.6} />
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

      <MantineAppShell.Navbar p="sm" className="ov-app-nav">
        <MantineAppShell.Section grow component={ScrollArea}>
          {renderNavGroup('Overview', IconDashboard, overviewNav)}
          {renderNavGroup('Infrastructure', IconCertificate, filterNavForRole(infrastructureNav, user?.role))}
          {renderNavGroup('Classification & Code', IconRocket, filterNavForRole(classificationCodeNav, user?.role))}
          {renderNavGroup('Data', IconPackage, filterNavForRole(dataNav, user?.role))}
          {renderNavGroup('Explore', IconTool, exploreNav)}
          {renderNavGroup('Insights', IconChartBar, insightsNav)}
          {renderNavGroup('Settings', IconSettings, filterNavForRole(configNav, user?.role))}
        </MantineAppShell.Section>

        <MantineAppShell.Section>
          <Box pt="sm" px="xs">
            <Text size="xs" c="dimmed" fw={500}>v{APP_VERSION}</Text>
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
            {(consoleHost || consoleIp) && (
              <Tooltip
                label="This OpenVox GUI console (backend host). Behind a VIP, this is the node that served the page."
                multiline
                maw={280}
              >
                <Text
                  size="xs"
                  c="dimmed"
                  mt={4}
                  ff="monospace"
                  style={{ lineHeight: 1.35, wordBreak: 'break-all' }}
                >
                  {consoleHost || 'console'}
                  {consoleIp ? (
                    <>
                      <br />
                      {consoleIp}
                    </>
                  ) : null}
                </Text>
              </Tooltip>
            )}
          </Box>
        </MantineAppShell.Section>
      </MantineAppShell.Navbar>

      <MantineAppShell.Main className="ov-app-main">
        <Outlet />
      </MantineAppShell.Main>

      <CommandPalette
        opened={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        extraActions={paletteExtra}
        role={user?.role}
      />
    </MantineAppShell>
  );
}
