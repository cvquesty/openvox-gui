/**
 * ⌘K / Ctrl+K command palette (sruiux1 P0 #2).
 */
import { useEffect, useMemo, useState } from 'react';
import { Modal, TextInput, ScrollArea, UnstyledButton, Text, Group, Kbd, Stack } from '@mantine/core';
import { useNavigate } from 'react-router';
import { IconSearch } from '@tabler/icons-react';
import { canAccessPaletteAction } from '../utils/canAccess';
import { stepPaletteIndex } from '../utils/paletteKeyboard';
import { prefetchRoute } from '../utils/routePrefetch';

export type PaletteAction = {
  id: string;
  label: string;
  keywords?: string;
  path?: string;
  run?: () => void;
};

/** Catalog of metric pages. /insights itself is the monitoring wallboard. */
export const INSIGHTS_HUB_PALETTE_PATH = '/insights/all';

const DEFAULT_ACTIONS: PaletteAction[] = [
  { id: 'dash', label: 'Dashboard', path: '/', keywords: 'home overview' },
  { id: 'nodes', label: 'Nodes', path: '/nodes', keywords: 'fleet agents' },
  { id: 'orch', label: 'Orchestration (Bolt)', path: '/orchestration', keywords: 'bolt command task plan' },
  { id: 'deploy', label: 'Code Deployment (r10k)', path: '/deployment', keywords: 'r10k deploy environment code' },
  { id: 'pql', label: 'PQL Console', path: '/pql', keywords: 'query puppetdb' },
  { id: 'facts', label: 'Fact Explorer', path: '/facts', keywords: 'facter facts' },
  { id: 'resources', label: 'Resource Explorer', path: '/resources', keywords: 'catalog resources' },
  { id: 'enc', label: 'Node Classifier (ENC)', path: '/enc', keywords: 'classify groups classes' },
  { id: 'certs', label: 'Certificate Authority', path: '/certificates', keywords: 'sign revoke ca' },
  { id: 'reports', label: 'Reports', path: '/reports', keywords: 'runs history' },
  { id: 'logs', label: 'Logs', path: '/logs', keywords: 'journalctl' },
  { id: 'inventory', label: 'Inventory', path: '/inventory', keywords: 'fleet inventory' },
  { id: 'installer', label: 'Agent Installer', path: '/installer', keywords: 'bootstrap packages' },
  { id: 'cert-audit', label: 'Certificate Audit', path: '/cert-audit', keywords: 'stale certs clean' },
  { id: 'hiera', label: 'Hiera Data Files', path: '/data/hiera', keywords: 'yaml data' },
  { id: 'lookup', label: 'Hiera Lookup', path: '/data/lookup', keywords: 'explain' },
  { id: 'config-puppet', label: 'OpenVox Configuration', path: '/config/puppet', keywords: 'puppet.conf hiera' },
  { id: 'config-app', label: 'Application Configuration', path: '/config/app', keywords: 'settings users ldap' },
  { id: 'insights-monitor', label: 'Monitoring dashboard', path: '/insights', keywords: 'noc wallboard trends metrics health pane' },
  { id: 'insights-catalog', label: 'Insights catalog', path: '/insights/all', keywords: 'metrics catalog launcher health' },
  { id: 'puppetfile', label: 'Puppetfile Manager', path: '/insights/puppetfile', keywords: 'forge modules versions staging commit' },
  { id: 'insights-compliance', label: 'Fleet Compliance', path: '/insights/compliance', keywords: 'metrics health' },
  { id: 'insights-node-health', label: 'Node Health', path: '/insights/node-health', keywords: 'metrics' },
];

const RECENT_KEY = 'openvox-gui-palette-recent';
const LIST_ID = 'ov-command-palette-list';

function optionDomId(id: string): string {
  return `ov-palette-opt-${id.replace(/[^A-Za-z0-9_-]/g, '-')}`;
}

function loadRecent(): PaletteAction[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as PaletteAction[];
  } catch {
    return [];
  }
}

function pushRecent(action: PaletteAction) {
  try {
    const prev = loadRecent().filter((a) => a.id !== action.id);
    const next = [{ id: action.id, label: action.label, path: action.path, keywords: action.keywords }, ...prev].slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
}

function fuzzy(q: string, action: PaletteAction): boolean {
  if (!q.trim()) return true;
  const hay = `${action.label} ${action.keywords || ''} ${action.path || ''}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .every((tok) => hay.includes(tok));
}

export function CommandPalette({
  opened,
  onClose,
  extraActions = [],
  role,
}: {
  opened: boolean;
  onClose: () => void;
  extraActions?: PaletteAction[];
  /** Current GUI role. Viewer-hidden paths are omitted, including recents. */
  role?: string | null;
}) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<PaletteAction[]>([]);
  const actions = useMemo(() => {
    const allow = (a: PaletteAction) => canAccessPaletteAction(a, role);
    const base = [...DEFAULT_ACTIONS, ...extraActions].filter(allow);
    const visibleRecent = recent.filter(allow);
    if (!q.trim() && visibleRecent.length > 0) {
      const recentTagged = visibleRecent.map((r) => ({ ...r, id: `recent-${r.id}`, label: `Recent: ${r.label}` }));
      return [...recentTagged, ...base.filter((a) => !visibleRecent.some((r) => r.id === a.id || r.path === a.path))];
    }
    return base.filter((a) => fuzzy(q, a));
  }, [q, extraActions, recent, role]);

  useEffect(() => {
    if (opened) {
      setQ('');
      setActive(0);
      setRecent(loadRecent());
    }
  }, [opened]);

  useEffect(() => {
    setActive(0);
  }, [q]);

  const index = actions.length === 0 ? 0 : Math.min(active, actions.length - 1);
  const activeId = actions[index] ? optionDomId(actions[index].id) : undefined;

  useEffect(() => {
    if (!opened || !activeId) return;
    const node = document.getElementById(activeId);
    if (node && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'nearest' });
    }
  }, [opened, activeId]);

  const go = (a: PaletteAction) => {
    if (a.path && !canAccessPaletteAction(a, role)) {
      onClose();
      return;
    }
    const store = { ...a, id: a.id.replace(/^recent-/, '') };
    pushRecent(store);
    if (a.run) a.run();
    else if (a.path) navigate(a.path);
    onClose();
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const next = stepPaletteIndex(index, actions.length, e.key);
    if (next != null) {
      e.preventDefault();
      setActive(next);
      return;
    }
    if (e.key === 'Enter' && actions[index]) {
      e.preventDefault();
      go(actions[index]);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <Text fw={600}>Command palette</Text>
          <Kbd size="xs">⌘</Kbd>
          <Text size="xs" c="dimmed">
            K
          </Text>
        </Group>
      }
      size="lg"
      padding="md"
    >
      <Stack gap="sm">
        <TextInput
          placeholder="Go to… (nodes, bolt, pql, deploy…)"
          aria-label="Go to"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={opened}
          aria-controls={LIST_ID}
          aria-activedescendant={activeId}
          leftSection={<IconSearch size={16} />}
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          data-autofocus
          onKeyDown={onInputKeyDown}
        />
        <ScrollArea h={320} type="auto">
          <Stack gap={4} role="listbox" id={LIST_ID} aria-label="Commands">
            {actions.length === 0 && (
              <Text size="sm" c="dimmed" ta="center" py="md">
                No matches
              </Text>
            )}
            {actions.map((a, i) => (
              <UnstyledButton
                key={a.id}
                id={optionDomId(a.id)}
                role="option"
                aria-selected={i === index}
                tabIndex={-1}
                data-active={i === index ? 'true' : 'false'}
                className="ov-palette-option"
                onClick={() => go(a)}
                onMouseEnter={() => {
                  setActive(i);
                  if (a.path) prefetchRoute(a.path);
                }}
                p="sm"
                style={{
                  borderRadius: 8,
                  border: '1px solid var(--mantine-color-default-border)',
                }}
              >
                <Text size="sm" fw={500}>
                  {a.label}
                </Text>
                {a.path && (
                  <Text size="xs" c="dimmed">
                    {a.path}
                  </Text>
                )}
              </UnstyledButton>
            ))}
          </Stack>
        </ScrollArea>
        <Text size="xs" c="dimmed">
          Tip: arrow keys move, Enter opens the highlighted result. Close with Esc.
        </Text>
      </Stack>
    </Modal>
  );
}
