import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Title, Table, Card, Loader, Center, Alert, TextInput, Stack, Group, Text,
  ActionIcon, Tooltip, Grid,
} from '@mantine/core';
import { IconSearch, IconEye } from '@tabler/icons-react';
import { useApi } from '../hooks/useApi';
import { nodes } from '../services/api';
import { StatusBadge } from '../components/StatusBadge';
import { useAppTheme } from '../hooks/ThemeContext';
import type { NodeSummary } from '../types';

/* ═══════════════════════════════════════════════════════════════
   NODE-O-VISION 6000 — the server rack X-ray machine
   ═══════════════════════════════════════════════════════════════ */
function NodeOVision() {
  return (
    <svg viewBox="0 0 520 220" width="100%" style={{ maxHeight: 240 }}>
      <defs>
        <linearGradient id="nv-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1a1b2e" />
          <stop offset="100%" stopColor="#252540" />
        </linearGradient>
      </defs>
      <rect width="520" height="220" fill="url(#nv-sky)" rx="8" />

      {/* Stars */}
      <circle cx="30" cy="15" r="1" fill="#fff" opacity="0.5" />
      <circle cx="170" cy="22" r="0.8" fill="#fff" opacity="0.3" />
      <circle cx="350" cy="12" r="1.1" fill="#fff" opacity="0.4" />
      <circle cx="490" cy="20" r="0.7" fill="#fff" opacity="0.5" />

      {/* Ground */}
      <rect x="0" y="185" width="520" height="35" fill="#1a1a2e" />
      <rect x="0" y="185" width="520" height="2" fill="#333355" />

      {/* Server rack 1 */}
      <rect x="40" y="70" width="50" height="110" fill="#3d4d5d" rx="3" stroke="#667788" strokeWidth="1" />
      <rect x="45" y="76" width="40" height="12" fill="#223344" rx="1" />
      <circle cx="52" cy="82" r="2.5" fill="#44ff44">
        <animate attributeName="fill" values="#44ff44;#22aa22;#44ff44" dur="2s" repeatCount="indefinite" />
      </circle>
      <text x="60" y="85" fill="#44ff88" fontSize="5" fontFamily="monospace">web01</text>
      <rect x="45" y="92" width="40" height="12" fill="#223344" rx="1" />
      <circle cx="52" cy="98" r="2.5" fill="#44ff44">
        <animate attributeName="fill" values="#44ff44;#22aa22;#44ff44" dur="2s" repeatCount="indefinite" begin="0.3s" />
      </circle>
      <text x="60" y="101" fill="#44ff88" fontSize="5" fontFamily="monospace">web02</text>
      <rect x="45" y="108" width="40" height="12" fill="#223344" rx="1" />
      <circle cx="52" cy="114" r="2.5" fill="#ffaa22" />
      <text x="60" y="117" fill="#ffaa44" fontSize="5" fontFamily="monospace">web03</text>
      <rect x="45" y="124" width="40" height="12" fill="#223344" rx="1" />
      <circle cx="52" cy="130" r="2.5" fill="#ff4444">
        <animate attributeName="fill" values="#ff4444;#cc2222;#ff4444" dur="1s" repeatCount="indefinite" />
      </circle>
      <text x="60" y="133" fill="#ff6666" fontSize="5" fontFamily="monospace">web04</text>
      <rect x="45" y="140" width="40" height="12" fill="#223344" rx="1" />
      <circle cx="52" cy="146" r="2.5" fill="#44ff44" />
      <text x="60" y="149" fill="#44ff88" fontSize="5" fontFamily="monospace">web05</text>

      {/* Server rack 2 */}
      <rect x="110" y="85" width="50" height="95" fill="#3d4d5d" rx="3" stroke="#667788" strokeWidth="1" />
      <rect x="115" y="91" width="40" height="12" fill="#223344" rx="1" />
      <circle cx="122" cy="97" r="2.5" fill="#44ff44">
        <animate attributeName="fill" values="#44ff44;#22aa22;#44ff44" dur="2s" repeatCount="indefinite" begin="0.5s" />
      </circle>
      <text x="130" y="100" fill="#44ff88" fontSize="5" fontFamily="monospace">db01</text>
      <rect x="115" y="107" width="40" height="12" fill="#223344" rx="1" />
      <circle cx="122" cy="113" r="2.5" fill="#44ff44" />
      <text x="130" y="116" fill="#44ff88" fontSize="5" fontFamily="monospace">db02</text>
      <rect x="115" y="123" width="40" height="12" fill="#223344" rx="1" />
      <circle cx="122" cy="129" r="2.5" fill="#44aaff" />
      <text x="130" y="132" fill="#44aaff" fontSize="5" fontFamily="monospace">db03</text>

      {/* Scanning beam across the racks */}
      <rect x="35" y="75" width="130" height="2" fill="#44aaff" opacity="0.6">
        <animate attributeName="y" values="75;175;75" dur="3s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.6;0.2;0.6" dur="3s" repeatCount="indefinite" />
      </rect>

      {/* Central monitor */}
      <rect x="200" y="50" width="120" height="90" fill="#223344" rx="5" stroke="#445566" strokeWidth="1.5" />
      <rect x="208" y="58" width="104" height="65" fill="#0a1628" rx="3" />
      {/* Monitor content */}
      <text x="260" y="72" textAnchor="middle" fill="#44aaff" fontSize="6" fontFamily="monospace">FLEET OVERVIEW</text>
      <line x1="215" y1="76" x2="305" y2="76" stroke="#334455" strokeWidth="0.5" />
      <text x="218" y="86" fill="#44ff44" fontSize="5" fontFamily="monospace">{"\u25CF"} 7 online</text>
      <text x="218" y="95" fill="#ffaa22" fontSize="5" fontFamily="monospace">{"\u25CF"} 1 changed</text>
      <text x="218" y="104" fill="#ff4444" fontSize="5" fontFamily="monospace">{"\u25CF"} 1 failed</text>
      <text x="218" y="113" fill="#44aaff" fontSize="5" fontFamily="monospace">{"\u25CF"} 1 noop</text>
      {/* Blinking cursor */}
      <rect x="218" y="117" width="4" height="1" fill="#44ff88">
        <animate attributeName="opacity" values="1;0;1" dur="1s" repeatCount="indefinite" />
      </rect>
      {/* Monitor stand */}
      <rect x="250" y="140" width="20" height="10" fill="#445566" />
      <rect x="240" y="148" width="40" height="4" fill="#556677" rx="2" />

      {/* Label */}
      <rect x="210" y="155" width="100" height="14" fill="#334455" rx="2" />
      <text x="260" y="165" textAnchor="middle" fill="#EC8622" fontSize="7" fontFamily="monospace" fontWeight="bold">NODE-O-VISION 6000</text>

      {/* Network connections (right side) */}
      <rect x="370" y="60" width="120" height="75" fill="#223344" rx="4" stroke="#445566" strokeWidth="1" />
      <text x="430" y="75" textAnchor="middle" fill="#888" fontSize="6" fontFamily="monospace">CONNECTIONS</text>
      <line x1="377" y1="79" x2="483" y2="79" stroke="#334455" strokeWidth="0.5" />
      {/* Network lines with data flowing */}
      <line x1="385" y1="90" x2="470" y2="90" stroke="#334455" strokeWidth="1" />
      <circle cx="385" cy="90" r="2" fill="#44ff44">
        <animate attributeName="cx" values="385;470;385" dur="2s" repeatCount="indefinite" />
      </circle>
      <text x="475" y="93" fill="#667788" fontSize="5" fontFamily="monospace">SSH</text>

      <line x1="385" y1="103" x2="470" y2="103" stroke="#334455" strokeWidth="1" />
      <circle cx="385" cy="103" r="2" fill="#44aaff">
        <animate attributeName="cx" values="385;470;385" dur="2.5s" repeatCount="indefinite" begin="0.5s" />
      </circle>
      <text x="475" y="106" fill="#667788" fontSize="5" fontFamily="monospace">PDB</text>

      <line x1="385" y1="116" x2="470" y2="116" stroke="#334455" strokeWidth="1" />
      <circle cx="385" cy="116" r="2" fill="#ffaa22">
        <animate attributeName="cx" values="385;470;385" dur="3s" repeatCount="indefinite" begin="1s" />
      </circle>
      <text x="475" y="119" fill="#667788" fontSize="5" fontFamily="monospace">API</text>

      {/* Caption */}
      <text x="260" y="198" textAnchor="middle" fill="#8899aa" fontSize="10" fontFamily="monospace">The Fleet Scanner</text>
      <text x="260" y="212" textAnchor="middle" fill="#556677" fontSize="8" fontFamily="monospace">watching your servers so you don't have to</text>
    </svg>
  );
}

function timeAgo(timestamp: string | null): string {
  if (!timestamp) return 'Never';
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function NodesPage() {
  const { isFormal } = useAppTheme();
  const [search, setSearch] = useState('');
  const { data: nodeList, loading, error } = useApi<NodeSummary[]>(nodes.list);
  const navigate = useNavigate();

  if (loading) return <Center h={400}><Loader size="xl" /></Center>;
  if (error) return <Alert color="red" title="Error">{error}</Alert>;

  const filtered = nodeList?.filter(
    (n) => n.certname.toLowerCase().includes(search.toLowerCase())
  ) || [];

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Nodes ({filtered.length})</Title>
        <TextInput
          placeholder="Search nodes..."
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          style={{ width: 300 }}
        />
      </Group>

      {/* Casual illustration */}
      {!isFormal && (
        <Card withBorder shadow="sm" padding="sm" style={{ overflow: 'hidden' }}>
          <NodeOVision />
        </Card>
      )}

      <Card withBorder shadow="sm">
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Certname</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Environment</Table.Th>
              <Table.Th>Last Report</Table.Th>
              <Table.Th>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {filtered.map((node) => (
              <Table.Tr key={node.certname} style={{ cursor: 'pointer' }}
                onClick={() => navigate(`/nodes/${node.certname}`)}>
                <Table.Td>
                  <Text fw={500}>{node.certname}</Text>
                </Table.Td>
                <Table.Td>
                  <StatusBadge status={node.latest_report_status} />
                </Table.Td>
                <Table.Td>{node.report_environment || '\u2014'}</Table.Td>
                <Table.Td>{timeAgo(node.report_timestamp)}</Table.Td>
                <Table.Td>
                  <Tooltip label="View details">
                    <ActionIcon variant="subtle" onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/nodes/${node.certname}`);
                    }}>
                      <IconEye size={18} />
                    </ActionIcon>
                  </Tooltip>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>
    </Stack>
  );
}
