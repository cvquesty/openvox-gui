/**
 * ⌘K / Ctrl+K command palette (sruiux1 P0 #2).
 */
import { useEffect, useMemo, useState } from 'react';
import { Modal, TextInput, ScrollArea, UnstyledButton, Text, Group, Kbd, Stack } from '@mantine/core';
import { useNavigate } from 'react-router-dom';
import { IconSearch } from '@tabler/icons-react';

export type PaletteAction = {
  id: string;
  label: string;
  keywords?: string;
  path?: string;
  run?: () => void;
};

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
  { id: 'insights-hub', label: 'Insights hub', path: '/insights', keywords: 'metrics catalog launcher health' },
  { id: 'insights-compliance', label: 'Fleet Compliance', path: '/insights/compliance', keywords: 'metrics health' },
  { id: 'insights-node-health', label: 'Node Health', path: '/insights/node-health', keywords: 'metrics' },
];

const RECENT_KEY = 'openvox-gui-palette-recent';

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
}: {
  opened: boolean;
  onClose: () => void;
  extraActions?: PaletteAction[];
}) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [recent, setRecent] = useState<PaletteAction[]>([]);
  const actions = useMemo(() => {
    const base = [...DEFAULT_ACTIONS, ...extraActions];
    if (!q.trim() && recent.length > 0) {
      const recentTagged = recent.map((r) => ({ ...r, id: `recent-${r.id}`, label: `Recent: ${r.label}` }));
      return [...recentTagged, ...base.filter((a) => !recent.some((r) => r.id === a.id || r.path === a.path))];
    }
    return base.filter((a) => fuzzy(q, a));
  }, [q, extraActions, recent]);

  useEffect(() => {
    if (opened) {
      setQ('');
      setRecent(loadRecent());
    }
  }, [opened]);

  const go = (a: PaletteAction) => {
    const store = { ...a, id: a.id.replace(/^recent-/, '') };
    pushRecent(store);
    if (a.run) a.run();
    else if (a.path) navigate(a.path);
    onClose();
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
          leftSection={<IconSearch size={16} />}
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          data-autofocus
          onKeyDown={(e) => {
            if (e.key === 'Enter' && actions[0]) {
              e.preventDefault();
              go(actions[0]);
            }
          }}
        />
        <ScrollArea h={320} type="auto">
          <Stack gap={4}>
            {actions.length === 0 && (
              <Text size="sm" c="dimmed" ta="center" py="md">
                No matches
              </Text>
            )}
            {actions.map((a) => (
              <UnstyledButton
                key={a.id}
                onClick={() => go(a)}
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
          Tip: press Enter to open the first result. Close with Esc.
        </Text>
      </Stack>
    </Modal>
  );
}
