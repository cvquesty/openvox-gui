import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Title, Table, Card, Loader, Center, Alert, TextInput, Stack, Group, Text, Grid, Box,
  Select,
} from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import { useApi } from '../hooks/useApi';
import { reports } from '../services/api';
import { StatusBadge } from '../components/StatusBadge';


/* ── REPORT-O-SCOPE 9000 — report analysis machine ──────── */
function ReportOScope() {
  return (
    <svg viewBox="0 0 500 300" width="100%" style={{ maxHeight: 340 }}>
      <defs>
        <linearGradient id="rpt-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1a1b2e" />
          <stop offset="100%" stopColor="#252540" />
        </linearGradient>
        <linearGradient id="rpt-machine" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#556677" />
          <stop offset="100%" stopColor="#3d4d5d" />
        </linearGradient>
        <linearGradient id="rpt-screen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0a1a2a" />
          <stop offset="100%" stopColor="#112233" />
        </linearGradient>
      </defs>

      <rect width="500" height="300" fill="url(#rpt-sky)" />

      {/* Stars */}
      <circle cx="40" cy="20" r="1" fill="#fff" opacity="0.6" />
      <circle cx="120" cy="12" r="1.5" fill="#fff" opacity="0.5" />
      <circle cx="200" cy="28" r="1" fill="#fff" opacity="0.7" />
      <circle cx="350" cy="15" r="1.5" fill="#fff" opacity="0.4" />
      <circle cx="460" cy="22" r="1" fill="#fff" opacity="0.6" />
      <circle cx="80" cy="40" r="1" fill="#fff" opacity="0.3" />
      <circle cx="420" cy="8" r="1" fill="#fff" opacity="0.5" />

      {/* Ground */}
      <rect x="0" y="245" width="500" height="55" fill="#1a1a2e" />
      <rect x="0" y="245" width="500" height="2" fill="#333355" />

      {/* ── THE MACHINE ── */}
      <rect x="140" y="90" width="220" height="150" fill="url(#rpt-machine)" rx="8" stroke="#7788aa" strokeWidth="1.5" />

      {/* Machine label */}
      <rect x="170" y="100" width="160" height="20" fill="#334455" rx="3" />
      <text x="250" y="114" textAnchor="middle" fill="#44aaff" fontSize="9" fontFamily="monospace" fontWeight="bold">
        REPORT-O-SCOPE 9000
      </text>

      {/* Screen */}
      <rect x="160" y="128" width="180" height="80" fill="url(#rpt-screen)" rx="4" stroke="#44aaff" strokeWidth="1" opacity="0.8" />

      {/* Scrolling report lines on screen */}
      <g>
        <rect x="168" y="135" width="80" height="6" fill="#335566" rx="1" opacity="0.6">
          <animate attributeName="x" values="168;168;168" dur="3s" repeatCount="indefinite" />
        </rect>
        <rect x="260" y="135" width="16" height="6" fill="#44cc44" rx="1" opacity="0.8" />
        <text x="268" y="140" textAnchor="middle" fill="#fff" fontSize="5">✓</text>
      </g>
      <g>
        <rect x="168" y="146" width="65" height="6" fill="#335566" rx="1" opacity="0.5" />
        <rect x="260" y="146" width="16" height="6" fill="#44cc44" rx="1" opacity="0.8" />
        <text x="268" y="151" textAnchor="middle" fill="#fff" fontSize="5">✓</text>
      </g>
      <g>
        <rect x="168" y="157" width="90" height="6" fill="#335566" rx="1" opacity="0.6" />
        <rect x="260" y="157" width="16" height="6" fill="#ff4444" rx="1" opacity="0.9">
          <animate attributeName="opacity" values="0.9;0.4;0.9" dur="1.5s" repeatCount="indefinite" />
        </rect>
        <text x="268" y="162" textAnchor="middle" fill="#fff" fontSize="5">✗</text>
      </g>
      <g>
        <rect x="168" y="168" width="72" height="6" fill="#335566" rx="1" opacity="0.5" />
        <rect x="260" y="168" width="16" height="6" fill="#ffaa22" rx="1" opacity="0.8" />
        <text x="268" y="173" textAnchor="middle" fill="#fff" fontSize="5">△</text>
      </g>
      <g>
        <rect x="168" y="179" width="85" height="6" fill="#335566" rx="1" opacity="0.6" />
        <rect x="260" y="179" width="16" height="6" fill="#44cc44" rx="1" opacity="0.8" />
        <text x="268" y="184" textAnchor="middle" fill="#fff" fontSize="5">✓</text>
      </g>
      <g>
        <rect x="168" y="190" width="60" height="6" fill="#335566" rx="1" opacity="0.4" />
        <rect x="260" y="190" width="16" height="6" fill="#ffaa22" rx="1" opacity="0.8" />
        <text x="268" y="195" textAnchor="middle" fill="#fff" fontSize="5">△</text>
      </g>

      {/* Scan line */}
      <rect x="160" y="135" width="180" height="2" fill="#44aaff" opacity="0.3">
        <animate attributeName="y" values="128;206;128" dur="3s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.3;0.6;0.3" dur="3s" repeatCount="indefinite" />
      </rect>

      {/* Screen reflection */}
      <rect x="160" y="128" width="180" height="20" fill="#ffffff" opacity="0.03" rx="4" />

      {/* Status lights */}
      <circle cx="170" cy="220" r="4" fill="#44ff44">
        <animate attributeName="fill" values="#44ff44;#22aa22;#44ff44" dur="1.5s" repeatCount="indefinite" />
      </circle>
      <circle cx="183" cy="220" r="4" fill="#ffaa22">
        <animate attributeName="fill" values="#ffaa22;#cc8811;#ffaa22" dur="2s" repeatCount="indefinite" />
      </circle>
      <circle cx="196" cy="220" r="4" fill="#ff4444">
        <animate attributeName="fill" values="#ff4444;#cc2222;#ff4444" dur="2.5s" repeatCount="indefinite" />
      </circle>

      {/* Data readout panel */}
      <rect x="220" y="212" width="120" height="22" fill="#223344" rx="3" stroke="#445566" strokeWidth="0.5" />
      <text x="228" y="226" fill="#44ff44" fontSize="8" fontFamily="monospace">
        <animate attributeName="textContent" values="ANALYZING...;PROCESSING...;SCANNING..." dur="4s" repeatCount="indefinite" />
        ANALYZING...
      </text>

      {/* ── Magnifying glass / telescope arm ── */}
      {/* Arm extending left */}
      <rect x="60" y="148" width="84" height="10" fill="#667788" rx="3" />
      <circle cx="142" cy="153" r="8" fill="#556677" stroke="#7788aa" strokeWidth="1" />

      {/* Magnifying glass */}
      <circle cx="42" cy="140" r="28" fill="none" stroke="#88aacc" strokeWidth="4" />
      <circle cx="42" cy="140" r="24" fill="#112233" opacity="0.6" />
      {/* Lens glare */}
      <ellipse cx="34" cy="130" rx="8" ry="5" fill="#ffffff" opacity="0.1" transform="rotate(-20,34,130)" />

      {/* Report page being examined */}
      <rect x="28" y="126" width="28" height="28" fill="#ddeeff" rx="2" opacity="0.15" />
      <rect x="31" y="130" width="18" height="2" fill="#88aacc" opacity="0.3" />
      <rect x="31" y="134" width="14" height="2" fill="#88aacc" opacity="0.3" />
      <rect x="31" y="138" width="20" height="2" fill="#88aacc" opacity="0.3" />
      <rect x="31" y="142" width="12" height="2" fill="#88aacc" opacity="0.3" />
      <rect x="31" y="146" width="16" height="2" fill="#88aacc" opacity="0.3" />

      {/* Lens pulse */}
      <circle cx="42" cy="140" r="24" fill="none" stroke="#44aaff" strokeWidth="1" opacity="0.4">
        <animate attributeName="r" values="22;26;22" dur="2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.4;0.1;0.4" dur="2s" repeatCount="indefinite" />
      </circle>

      {/* ── Printer arm extending right ── */}
      <rect x="358" y="148" width="60" height="10" fill="#667788" rx="3" />
      <circle cx="360" cy="153" r="8" fill="#556677" stroke="#7788aa" strokeWidth="1" />

      {/* Printed reports coming out */}
      <g>
        <rect x="415" y="120" width="30" height="38" fill="#ddeeff" rx="2" opacity="0.9">
          <animate attributeName="y" values="140;120;120" dur="4s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0;0.9;0.9" dur="4s" repeatCount="indefinite" />
        </rect>
        <rect x="419" y="128" width="18" height="2" fill="#667788" opacity="0.5">
          <animate attributeName="y" values="148;128;128" dur="4s" repeatCount="indefinite" />
        </rect>
        <rect x="419" y="133" width="14" height="2" fill="#667788" opacity="0.4">
          <animate attributeName="y" values="153;133;133" dur="4s" repeatCount="indefinite" />
        </rect>
        <rect x="419" y="138" width="20" height="2" fill="#667788" opacity="0.5">
          <animate attributeName="y" values="158;138;138" dur="4s" repeatCount="indefinite" />
        </rect>
        {/* Checkmark stamp */}
        <text x="430" y="150" textAnchor="middle" fill="#44cc44" fontSize="12" opacity="0.8">
          <animate attributeName="y" values="170;150;150" dur="4s" repeatCount="indefinite" />
          ✓
        </text>
      </g>

      {/* Stacked finished reports */}
      <rect x="440" y="210" width="30" height="35" fill="#ccddee" rx="2" opacity="0.3" />
      <rect x="443" y="213" width="24" height="29" fill="#ddeeff" rx="1" opacity="0.4" />
      <rect x="446" y="216" width="18" height="23" fill="#eef4ff" rx="1" opacity="0.5" />

      {/* ── Little robot operator ── */}
      {/* Body */}
      <rect x="380" y="210" width="20" height="28" fill="#667788" rx="3" />
      {/* Head */}
      <rect x="383" y="198" width="14" height="14" fill="#778899" rx="2" />
      {/* Eyes */}
      <rect x="386" y="202" width="3" height="3" fill="#44aaff" rx="0.5">
        <animate attributeName="fill" values="#44aaff;#88ccff;#44aaff" dur="2s" repeatCount="indefinite" />
      </rect>
      <rect x="391" y="202" width="3" height="3" fill="#44aaff" rx="0.5">
        <animate attributeName="fill" values="#44aaff;#88ccff;#44aaff" dur="2s" repeatCount="indefinite" />
      </rect>
      {/* Antenna */}
      <line x1="390" y1="198" x2="390" y2="190" stroke="#8899bb" strokeWidth="1.5" />
      <circle cx="390" cy="188" r="2.5" fill="#44aaff">
        <animate attributeName="fill" values="#44aaff;#88ccff;#44aaff" dur="1.5s" repeatCount="indefinite" />
      </circle>
      {/* Arms */}
      <line x1="380" y1="218" x2="370" y2="225" stroke="#667788" strokeWidth="2" />
      <line x1="400" y1="218" x2="415" y2="215" stroke="#667788" strokeWidth="2" />
      {/* Legs */}
      <line x1="385" y1="238" x2="382" y2="247" stroke="#667788" strokeWidth="2" />
      <line x1="395" y1="238" x2="398" y2="247" stroke="#667788" strokeWidth="2" />

      {/* Clipboard in hand */}
      <rect x="365" y="222" width="10" height="14" fill="#bbccdd" rx="1" />
      <rect x="367" y="225" width="6" height="1.5" fill="#667788" opacity="0.6" />
      <rect x="367" y="228" width="4" height="1.5" fill="#667788" opacity="0.5" />
      <rect x="367" y="231" width="5" height="1.5" fill="#667788" opacity="0.6" />

      {/* ── Gears ── */}
      <circle cx="155" cy="100" r="10" fill="none" stroke="#88aacc" strokeWidth="1.5" strokeDasharray="3 2">
        <animateTransform attributeName="transform" type="rotate" values="0 155 100;360 155 100" dur="4s" repeatCount="indefinite" />
      </circle>
      <circle cx="155" cy="100" r="3.5" fill="#445566" />
      <circle cx="345" cy="100" r="10" fill="none" stroke="#88aacc" strokeWidth="1.5" strokeDasharray="3 2">
        <animateTransform attributeName="transform" type="rotate" values="360 345 100;0 345 100" dur="4s" repeatCount="indefinite" />
      </circle>
      <circle cx="345" cy="100" r="3.5" fill="#445566" />

      {/* Caption */}
      <text x="250" y="267" textAnchor="middle" fill="#8899aa" fontSize="11" fontFamily="monospace">
        The Report-O-Scope 9000
      </text>
      <text x="250" y="283" textAnchor="middle" fill="#556677" fontSize="9" fontFamily="monospace">
        cataloging puppet runs so you don&#39;t have to
      </text>
    </svg>
  );
}

export function ReportsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const { data: reportList, loading, error } = useApi(
    () => reports.list({ status: statusFilter || undefined, limit: 50 }),
    [statusFilter]
  );

  if (loading) return <Center h={400}><Loader size="xl" /></Center>;
  if (error) return <Alert color="red" title="Error">{error}</Alert>;

  const filtered = reportList?.filter(
    (r) => r.certname.toLowerCase().includes(search.toLowerCase())
  ) || [];

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Reports ({filtered.length})</Title>
        <Group>
          <Select
            placeholder="Filter by status"
            data={[
              { value: '', label: 'All' },
              { value: 'changed', label: 'Changed' },
              { value: 'unchanged', label: 'Unchanged' },
              { value: 'failed', label: 'Failed' },
            ]}
            value={statusFilter}
            onChange={setStatusFilter}
            clearable
            style={{ width: 160 }}
          />
          <TextInput
            placeholder="Search by certname..."
            leftSection={<IconSearch size={16} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            style={{ width: 250 }}
          />
        </Group>
      </Group>

      {/* Report-O-Scope illustration */}
      <Card withBorder shadow="sm" padding={0} style={{ overflow: 'hidden', backgroundColor: '#1a1b2e' }}>
        <ReportOScope />
      </Card>

      <Card withBorder shadow="sm">
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Certname</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Environment</Table.Th>
              <Table.Th>Start Time</Table.Th>
              <Table.Th>End Time</Table.Th>
              <Table.Th>Puppet Version</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {filtered.map((report) => (
              <Table.Tr
                key={report.hash}
                style={{ cursor: 'pointer' }}
                onClick={() => navigate(`/reports/${report.hash}`)}
              >
                <Table.Td><Text fw={500}>{report.certname}</Text></Table.Td>
                <Table.Td><StatusBadge status={report.status} /></Table.Td>
                <Table.Td>{report.environment || '—'}</Table.Td>
                <Table.Td>{report.start_time ? new Date(report.start_time).toLocaleString() : '—'}</Table.Td>
                <Table.Td>{report.end_time ? new Date(report.end_time).toLocaleString() : '—'}</Table.Td>
                <Table.Td>{report.puppet_version || '—'}</Table.Td>
              </Table.Tr>
            ))}
            {filtered.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={6}><Text c="dimmed" ta="center">No reports found</Text></Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Card>
    </Stack>
  );
}
