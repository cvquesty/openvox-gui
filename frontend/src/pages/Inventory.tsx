/**
 * OpenVox GUI - Inventory.tsx
 *
 * "Live" fleet inventory report page.
 * Located under the Logs nav group (Log Viewer | Reports | Inventory).
 *
 * Displays a table of key system facts pulled live from PuppetDB:
 *   certname, os_name, os_full_release, physical_processors, location,
 *   memory, disks (multi-line), virtual/physical, uptime.
 *
 * Supports:
 *   - Manual refresh (always live)
 *   - CSV export (with proper quoting for multi-line disks cells)
 *   - Additional JSON / formatted-text export via ExportActions
 *   - Responsive scrollable table
 *
 * Whimsical illustration only in "robots" / casual theme to match Reports page style.
 */

import { useMemo } from 'react';
import {
  Title, Card, Loader, Center, Alert, Stack, Group, Text, Button,
  Badge, ActionIcon, Tooltip,
} from '@mantine/core';
import { IconListDetails, IconRefresh, IconDownload } from '@tabler/icons-react';
import { useApi } from '../hooks/useApi';
import { reports } from '../services/api';
import { useAppTheme } from '../hooks/ThemeContext';
import { ExportActions } from '../components/ExportActions';
import { OpsTable, OpsColumn } from '../components/OpsTable';

/* ── INVENTORY-O-MATIC 3000 (casual/robots theme only) ───── */
function InventoryOMatic() {
  return (
    <svg viewBox="0 0 520 220" style={{ maxHeight: 220, display: 'block', margin: '0 auto' }}>
      <defs>
        <linearGradient id="inv-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1a1b2e" />
          <stop offset="100%" stopColor="#252540" />
        </linearGradient>
      </defs>
      <rect width="520" height="220" fill="url(#inv-sky)" rx="6" />

      {/* Stars */}
      <circle cx="30" cy="20" r="1.2" fill="#fff" opacity="0.6" />
      <circle cx="80" cy="35" r="1" fill="#fff" opacity="0.4" />
      <circle cx="140" cy="12" r="1.5" fill="#fff" opacity="0.5" />
      <circle cx="420" cy="25" r="1" fill="#fff" opacity="0.7" />
      <circle cx="480" cy="48" r="1.3" fill="#fff" opacity="0.5" />

      {/* Main box - inventory terminal */}
      <rect x="80" y="40" width="360" height="130" rx="8" fill="#2a2a44" stroke="#556677" strokeWidth="1.5" />
      <rect x="95" y="55" width="330" height="22" rx="3" fill="#1f2438" />
      <text x="260" y="71" textAnchor="middle" fill="#88ccff" fontSize="11" fontFamily="monospace" fontWeight="bold">
        INVENTORY-O-MATIC 3000
      </text>

      {/* Live scan line */}
      <rect x="95" y="82" width="330" height="2" fill="#44aaff" opacity="0.6">
        <animate attributeName="y" values="82;160;82" dur="2.2s" repeatCount="indefinite" />
      </rect>

      {/* Sample rows on "screen" */}
      <g fontSize="8" fontFamily="monospace" fill="#aaddff">
        <text x="100" y="95">node01.questy.org   RHEL 9.4   2 CPU   16 GiB   3 disks   Physical   41d</text>
        <text x="100" y="108" opacity="0.85">node02.questy.org   Ubuntu 22.04   1 CPU   4 GiB   1 disk   Virtual(kvm)   12d</text>
        <text x="100" y="121" opacity="0.7">... (live from PuppetDB facts) ...</text>
      </g>

      {/* Status badge */}
      <rect x="380" y="140" width="52" height="18" rx="3" fill="#223355" />
      <text x="406" y="152" textAnchor="middle" fill="#66ff99" fontSize="8" fontFamily="monospace">LIVE</text>

      {/* Little robot / arm */}
      <rect x="455" y="130" width="18" height="28" rx="3" fill="#556677" />
      <rect x="458" y="120" width="12" height="12" rx="2" fill="#778899" />
      <circle cx="461" cy="115" r="2" fill="#44aaff" />
      <line x1="455" y1="145" x2="440" y2="155" stroke="#667788" strokeWidth="2" />
      <circle cx="438" cy="157" r="4" fill="#445566" />

      {/* Caption */}
      <text x="260" y="200" textAnchor="middle" fill="#8899aa" fontSize="10" fontFamily="monospace">
        One row per node • Always current facts • Exportable
      </text>
    </svg>
  );
}

/* CSV helper — handles embedded newlines (disks column), quotes, commas */
function rowsToCSV(rows: any[]): string {
  if (!rows || rows.length === 0) return '';
  const headers = [
    'certname',
    'os_name',
    'os_full_release',
    'physical_processors',
    'location',
    'memory',
    'disks',
    'virtual_physical',
    'uptime',
  ];
  const esc = (val: unknown): string => {
    if (val === null || val === undefined) return '';
    let s = String(val);
    // Always quote if contains comma, quote, newline, or carriage return
    if (/[",\n\r]/.test(s)) {
      s = '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const out: string[] = [];
  out.push(headers.map(esc).join(','));
  for (const r of rows) {
    out.push(headers.map((h) => esc(r?.[h])).join(','));
  }
  return out.join('\r\n');
}

function triggerCSVDownload(rows: any[], filename = 'inventory-report.csv') {
  const csv = rowsToCSV(rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function InventoryPage() {
  const { isRobots } = useAppTheme();

  const { data, loading, error, refetch } = useApi(
    () => reports.inventory(),
    []
  );

  const rows = data || [];
  const count = rows.length;

  const lastUpdated = useMemo(() => new Date().toLocaleTimeString(), [data]);

  const handleCSV = () => {
    if (rows.length === 0) return;
    triggerCSVDownload(rows, `inventory-${new Date().toISOString().slice(0,10)}.csv`);
  };

  return (
    <Stack>
      <Group justify="space-between" align="center">
        <Group>
          <IconListDetails size={28} />
          <Title order={2}>Inventory</Title>
          <Badge variant="light" color="blue" size="lg">{count} node{count === 1 ? '' : 's'}</Badge>
        </Group>
        <Group gap="xs">
          <Tooltip label="Refresh (live facts from PuppetDB)">
            <Button
              size="sm"
              variant="light"
              leftSection={<IconRefresh size={16} />}
              onClick={refetch}
              loading={loading}
            >
              Refresh
            </Button>
          </Tooltip>
          <Tooltip label="Download as CSV (quoted, multi-line disks preserved)">
            <ActionIcon
              size="lg"
              variant="light"
              onClick={handleCSV}
              disabled={rows.length === 0}
              aria-label="Export CSV"
            >
              <IconDownload size={18} />
            </ActionIcon>
          </Tooltip>
          <ExportActions
            results={rows}
            filenameBase="inventory"
            variant="compact"
            columns={[
              'certname', 'os_name', 'os_full_release', 'physical_processors',
              'location', 'memory', 'disks', 'virtual_physical', 'uptime'
            ]}
          />
        </Group>
      </Group>

      <Text size="sm" c="dimmed">
        Live hardware / OS inventory pulled directly from PuppetDB facts (no cache).
        Disks are listed one per line inside the cell. Location comes from a custom <code>location</code> fact if you have one deployed.
      </Text>

      {/* Whimsical illustration (casual/robots theme) */}
      {isRobots && (
        <Card withBorder shadow="sm" padding={0} style={{ overflow: 'hidden', background: 'linear-gradient(to bottom, #1a1b2e, #252540)' }}>
          <InventoryOMatic />
        </Card>
      )}

      {error && (
        <Alert color="red" title="Error loading inventory" withCloseButton onClose={() => { /* non-fatal */ }}>
          {error}
        </Alert>
      )}

      {loading && rows.length === 0 ? (
        <Center h={300}><Loader size="xl" /></Center>
      ) : rows.length === 0 ? (
        <Card withBorder shadow="sm">
          <Text c="dimmed" ta="center">No inventory data returned. (Nodes may not have reported facts yet.)</Text>
        </Card>
      ) : (
        <Card withBorder shadow="sm" p="xs" style={{ overflow: 'hidden' }}>
          <Group justify="space-between" mb="xs" px="xs">
            <Text size="xs" c="dimmed">Last client refresh: {lastUpdated} — click Refresh for newest facts</Text>
            <Text size="xs" c="dimmed">{count} rows</Text>
          </Group>
          {count > 200 && (
            <Alert color="yellow" variant="light" mb="xs">
              Large inventory ({count} rows). Use OpsTable page size and column sort; server-side inventory paging is a later slice.
            </Alert>
          )}

          <OpsTable<any>
            data={rows}
            rowKey={(row) => row.certname || String(Math.random())}
            defaultPageSize={100}
            maxHeight="calc(100vh - 360px)"
            emptyTitle="No inventory rows"
            columns={[
              {
                key: 'certname',
                header: 'Certname',
                sortValue: (row) => row.certname || '',
                render: (row) => <Text fw={600} size="sm">{row.certname}</Text>,
              },
              {
                key: 'os_name',
                header: 'OS Name',
                sortValue: (row) => row.os_name || '',
                render: (row) => row.os_name || '—',
              },
              {
                key: 'os_full_release',
                header: 'OS Full Release Version',
                sortValue: (row) => row.os_full_release || '',
                render: (row) => row.os_full_release || '—',
              },
              {
                key: 'physical_processors',
                header: 'Physical Processors',
                sortType: 'number',
                sortValue: (row) => Number(row.physical_processors) || 0,
                render: (row) => row.physical_processors || '—',
              },
              {
                key: 'location',
                header: 'System Location',
                sortValue: (row) => row.location || '',
                render: (row) => row.location || '—',
              },
              {
                key: 'memory',
                header: 'System Memory',
                sortValue: (row) => row.memory || '',
                render: (row) => row.memory || '—',
              },
              {
                key: 'disks',
                header: 'Disks',
                sortable: false,
                render: (row) =>
                  row.disks ? (
                    <Text
                      component="div"
                      size="xs"
                      style={{
                        whiteSpace: 'pre-line',
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                        lineHeight: 1.35,
                      }}
                    >
                      {row.disks}
                    </Text>
                  ) : (
                    '—'
                  ),
              },
              {
                key: 'virtual_physical',
                header: 'Virtual or Physical',
                sortValue: (row) => row.virtual_physical || '',
                render: (row) =>
                  row.virtual_physical?.toLowerCase?.().startsWith('virtual') ? (
                    <Badge color="violet" variant="light" size="sm">{row.virtual_physical}</Badge>
                  ) : (
                    <Badge color="teal" variant="light" size="sm">{row.virtual_physical || '—'}</Badge>
                  ),
              },
              {
                key: 'uptime',
                header: 'Total System Uptime',
                sortValue: (row) => row.uptime || '',
                render: (row) => row.uptime || '—',
              },
            ] as OpsColumn<any>[]}
          />
        </Card>
      )}
    </Stack>
  );
}
