import { useState, useCallback, useEffect } from 'react';
import {
  Title, Card, Stack, Group, Text, Button, Alert, Loader, Center,
  Table, Badge, Code, Modal, ActionIcon, Tooltip, ScrollArea, Grid,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconCertificate, IconCheck, IconX, IconTrash, IconRefresh, IconInfoCircle,
} from '@tabler/icons-react';
import { certificates } from '../services/api';
import { useAppTheme } from '../hooks/ThemeContext';

/* ═══════════════════════════════════════════════════════════════
   CERT-O-STAMP 3000 — the certificate stamping machine
   ═══════════════════════════════════════════════════════════════ */
function CertOStamp() {
  return (
    <svg viewBox="0 0 520 280" width="100%" style={{ maxHeight: 300 }}>
      <defs>
        <linearGradient id="cs-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1a1b2e" />
          <stop offset="100%" stopColor="#252540" />
        </linearGradient>
      </defs>
      <rect width="520" height="280" fill="url(#cs-sky)" rx="8" />

      {/* Stars */}
      <circle cx="45" cy="18" r="1" fill="#fff" opacity="0.4" />
      <circle cx="250" cy="12" r="0.9" fill="#fff" opacity="0.3" />
      <circle cx="480" cy="25" r="1.1" fill="#fff" opacity="0.5" />
      <circle cx="150" cy="30" r="0.7" fill="#fff" opacity="0.4" />
      <circle cx="400" cy="15" r="0.8" fill="#fff" opacity="0.3" />

      {/* Ground */}
      <rect x="0" y="235" width="520" height="45" fill="#1a1a2e" />
      <rect x="0" y="235" width="520" height="2" fill="#333355" />

      {/* The big rubber stamp with pressing animation */}
      <g>
        <animateTransform attributeName="transform" type="translate" values="0,0;0,45;0,45;0,0" dur="4s" repeatCount="indefinite" keyTimes="0;0.3;0.6;1" />
        {/* Stamp handle */}
        <rect x="240" y="35" width="40" height="18" fill="#778899" rx="4" />
        {/* Stamp body */}
        <rect x="220" y="50" width="80" height="35" fill="#556677" rx="3" stroke="#778899" strokeWidth="1" />
        <text x="260" y="72" textAnchor="middle" fill="#aabbcc" fontSize="7" fontFamily="monospace">STAMP</text>
        {/* Stamp bottom (rubber) */}
        <rect x="228" y="85" width="64" height="6" fill="#884422" rx="1" />
      </g>

      {/* Certificate document below stamp */}
      <rect x="210" y="150" width="100" height="65" fill="#ddd8cc" rx="2" stroke="#bbaa88" strokeWidth="1" opacity="0.9" />
      <text x="260" y="168" textAnchor="middle" fill="#554433" fontSize="7" fontFamily="monospace" fontWeight="bold">CERTIFICATE</text>
      <line x1="222" y1="174" x2="298" y2="174" stroke="#bbaa88" strokeWidth="0.5" />
      <text x="260" y="185" textAnchor="middle" fill="#776655" fontSize="5" fontFamily="monospace">web01.example.com</text>
      <text x="260" y="195" textAnchor="middle" fill="#776655" fontSize="5" fontFamily="monospace">SHA256: a4:f2:c8:9b...</text>
      <text x="260" y="205" textAnchor="middle" fill="#776655" fontSize="5" fontFamily="monospace">Valid: 2025-2030</text>

      {/* SIGNED stamp mark (appears on document after stamp hits) */}
      <g opacity="0">
        <animate attributeName="opacity" values="0;0;0.8;0.8" dur="4s" repeatCount="indefinite" keyTimes="0;0.28;0.35;1" />
        <text x="260" y="192" textAnchor="middle" fill="#22aa22" fontSize="14" fontFamily="monospace" fontWeight="bold" transform="rotate(-15 260 188)" opacity="0.7">SIGNED</text>
        <circle cx="288" cy="200" r="9" fill="none" stroke="#22aa22" strokeWidth="1.5" opacity="0.7" />
        <text x="288" y="203" textAnchor="middle" fill="#22aa22" fontSize="6" fontFamily="monospace" fontWeight="bold">CA</text>
      </g>

      {/* Pending certs queue (left) */}
      <rect x="35" y="120" width="85" height="60" fill="#223344" rx="3" stroke="#445566" strokeWidth="1" />
      <text x="77" y="137" textAnchor="middle" fill="#ffaa22" fontSize="7" fontFamily="monospace" fontWeight="bold">PENDING</text>
      <line x1="42" y1="141" x2="112" y2="141" stroke="#334455" strokeWidth="0.5" />
      <rect x="42" y="146" width="70" height="9" fill="#334455" rx="1" />
      <text x="77" y="153" textAnchor="middle" fill="#ffaa44" fontSize="5" fontFamily="monospace">node03.lab ?</text>
      <rect x="42" y="159" width="70" height="9" fill="#334455" rx="1" />
      <text x="77" y="166" textAnchor="middle" fill="#ffaa44" fontSize="5" fontFamily="monospace">node04.lab ?</text>

      {/* Arrows */}
      <text x="140" y="155" fill="#556677" fontSize="16">{"\u2192"}</text>

      {/* Signed certs vault (right) */}
      <rect x="400" y="110" width="90" height="80" fill="#223344" rx="3" stroke="#44aa44" strokeWidth="1" />
      <text x="445" y="127" textAnchor="middle" fill="#44ff44" fontSize="7" fontFamily="monospace" fontWeight="bold">SIGNED VAULT</text>
      <line x1="407" y1="131" x2="483" y2="131" stroke="#334455" strokeWidth="0.5" />
      <rect x="407" y="136" width="76" height="9" fill="#334455" rx="1" />
      <text x="445" y="143" textAnchor="middle" fill="#44ff88" fontSize="5" fontFamily="monospace">web01.lab {"\u2713"}</text>
      <rect x="407" y="149" width="76" height="9" fill="#334455" rx="1" />
      <text x="445" y="156" textAnchor="middle" fill="#44ff88" fontSize="5" fontFamily="monospace">db01.lab {"\u2713"}</text>
      <rect x="407" y="162" width="76" height="9" fill="#334455" rx="1" />
      <text x="445" y="169" textAnchor="middle" fill="#44ff88" fontSize="5" fontFamily="monospace">puppet.lab {"\u2713"}</text>
      <rect x="407" y="175" width="76" height="9" fill="#334455" rx="1" />
      <text x="445" y="182" textAnchor="middle" fill="#44ff88" fontSize="5" fontFamily="monospace">app01.lab {"\u2713"}</text>

      {/* Arrow to vault */}
      <text x="345" y="170" fill="#556677" fontSize="16">{"\u2192"}</text>

      {/* Lock on vault */}
      <rect x="435" y="98" width="20" height="14" fill="#556677" rx="3" stroke="#667788" strokeWidth="1" />
      <circle cx="445" cy="106" r="3" fill="#334455" stroke="#667788" strokeWidth="1" />
      <rect x="443" y="106" width="4" height="5" fill="#667788" rx="1" />

      {/* Label plate */}
      <rect x="195" y="218" width="130" height="14" fill="#334455" rx="2" />
      <text x="260" y="228" textAnchor="middle" fill="#EC8622" fontSize="7" fontFamily="monospace" fontWeight="bold">CERT-O-STAMP 3000</text>

      {/* Status lights */}
      <circle cx="205" cy="240" r="3" fill="#44ff44">
        <animate attributeName="fill" values="#44ff44;#22aa22;#44ff44" dur="1.5s" repeatCount="indefinite" />
      </circle>
      <circle cx="215" cy="240" r="3" fill="#ffaa22" />
      <circle cx="225" cy="240" r="3" fill="#44aaff" />

      {/* Caption */}
      <text x="260" y="255" textAnchor="middle" fill="#8899aa" fontSize="10" fontFamily="monospace">The Certificate Authority</text>
      <text x="260" y="269" textAnchor="middle" fill="#556677" fontSize="8" fontFamily="monospace">trust nobody. sign everything.</text>
    </svg>
  );
}

export function CertificatesPage() {
  const { isFormal } = useAppTheme();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailData, setDetailData] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await certificates.list();
      setData(d);
      if (d.error) setError(d.error);
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSign = async (certname: string) => {
    if (!confirm(`Sign certificate for "${certname}"?`)) return;
    try {
      await certificates.sign(certname);
      notifications.show({ title: 'Signed', message: `Certificate signed for ${certname}`, color: 'green' });
      load();
    } catch (e: any) {
      notifications.show({ title: 'Error', message: e.message, color: 'red' });
    }
  };

  const handleRevoke = async (certname: string) => {
    if (!confirm(`Revoke certificate for "${certname}"? This cannot be undone.`)) return;
    try {
      await certificates.revoke(certname);
      notifications.show({ title: 'Revoked', message: `Certificate revoked for ${certname}`, color: 'yellow' });
      load();
    } catch (e: any) {
      notifications.show({ title: 'Error', message: e.message, color: 'red' });
    }
  };

  const handleClean = async (certname: string) => {
    if (!confirm(`Clean (permanently delete) certificate for "${certname}"?`)) return;
    try {
      await certificates.clean(certname);
      notifications.show({ title: 'Cleaned', message: `Certificate removed for ${certname}`, color: 'green' });
      load();
    } catch (e: any) {
      notifications.show({ title: 'Error', message: e.message, color: 'red' });
    }
  };

  const handleInfo = async (certname: string) => {
    setDetailLoading(true);
    setDetailOpen(true);
    setDetailData(null);
    try {
      const info = await certificates.info(certname);
      setDetailData(info);
    } catch (e: any) {
      setDetailData({ certname, error: e.message });
    }
    setDetailLoading(false);
  };

  if (loading) return <Center h={400}><Loader size="xl" /></Center>;

  const requested = data?.requested || [];
  const signed = data?.signed || [];

  return (
    <Stack>
      <Group justify="space-between">
        <Group>
          <IconCertificate size={28} />
          <Title order={2}>Certificate Authority</Title>
        </Group>
        <Button variant="outline" leftSection={<IconRefresh size={16} />} onClick={load}>
          Refresh
        </Button>
      </Group>

      {error && (
        <Alert color="yellow" title="CA Warning">
          {error}
        </Alert>
      )}

      <Alert variant="light" color="blue">
        Manage Puppet CA certificates. Sign pending requests, revoke compromised certs,
        or clean removed nodes. This interfaces with <Code>puppetserver ca</Code>.
      </Alert>

      {/* Casual illustration */}
      {!isFormal && (
        <Card withBorder shadow="sm" padding="sm" style={{ overflow: 'hidden' }}>
          <CertOStamp />
        </Card>
      )}

      {/* Pending Requests */}
      <Card withBorder shadow="sm" padding="md">
        <Group mb="md">
          <Title order={4}>Pending Requests</Title>
          <Badge color={requested.length > 0 ? 'yellow' : 'green'} size="lg">
            {requested.length}
          </Badge>
        </Group>
        {requested.length > 0 ? (
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Certname</Table.Th>
                <Table.Th>Fingerprint</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {requested.map((cert: any) => (
                <Table.Tr key={cert.name}>
                  <Table.Td><Text fw={500}>{cert.name}</Text></Table.Td>
                  <Table.Td><Code>{cert.fingerprint || 'N/A'}</Code></Table.Td>
                  <Table.Td>
                    <Group gap="xs" justify="flex-end">
                      <Button size="xs" color="green" leftSection={<IconCheck size={14} />}
                        onClick={() => handleSign(cert.name)}>
                        Sign
                      </Button>
                      <Button size="xs" color="red" variant="outline" leftSection={<IconTrash size={14} />}
                        onClick={() => handleClean(cert.name)}>
                        Reject
                      </Button>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        ) : (
          <Text c="dimmed" ta="center" py="lg">No pending certificate requests</Text>
        )}
      </Card>

      {/* Signed Certificates */}
      <Card withBorder shadow="sm" padding="md">
        <Group mb="md">
          <Title order={4}>Signed Certificates</Title>
          <Badge color="green" size="lg">{signed.length}</Badge>
        </Group>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Certname</Table.Th>
              <Table.Th>Fingerprint</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {signed.map((cert: any) => (
              <Table.Tr key={cert.name}>
                <Table.Td><Text fw={500}>{cert.name}</Text></Table.Td>
                <Table.Td><Code style={{ fontSize: 11 }}>{cert.fingerprint || 'N/A'}</Code></Table.Td>
                <Table.Td>
                  <Group gap="xs" justify="flex-end">
                    <Tooltip label="Certificate details">
                      <ActionIcon variant="subtle" color="blue" onClick={() => handleInfo(cert.name)}>
                        <IconInfoCircle size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Revoke certificate">
                      <ActionIcon variant="subtle" color="yellow" onClick={() => handleRevoke(cert.name)}>
                        <IconX size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Clean certificate">
                      <ActionIcon variant="subtle" color="red" onClick={() => handleClean(cert.name)}>
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
            {signed.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={3}><Text c="dimmed" ta="center" py="lg">No signed certificates found</Text></Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Card>

      <Modal opened={detailOpen} onClose={() => setDetailOpen(false)}
        title={`Certificate Details \u2014 ${detailData?.certname || ''}`} size="lg">
        {detailLoading ? (
          <Center h={200}><Loader /></Center>
        ) : detailData?.error ? (
          <Alert color="red">{detailData.error}</Alert>
        ) : (
          <ScrollArea style={{ maxHeight: 500 }}>
            <Code block style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>
              {detailData?.details || 'No details available'}
            </Code>
          </ScrollArea>
        )}
      </Modal>
    </Stack>
  );
}
