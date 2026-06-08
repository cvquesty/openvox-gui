/**
 * OpenVox GUI - CertAudit.tsx
 *
 * Certificate Audit tool — cross-references signed CA certificates
 * against PuppetDB nodes to find orphaned certs from decommissioned,
 * renamed, or never-reported nodes. Allows individual or bulk cleanup.
 */
import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Title, Card, Stack, Group, Text, Alert, Loader, Center,
  Table, Badge, Button, ActionIcon, Tooltip, Collapse, Paper,
  Modal, Checkbox, ScrollArea,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconShieldCheck, IconAlertTriangle, IconTrash, IconRefresh,
  IconChevronDown, IconChevronRight, IconCheck,
} from '@tabler/icons-react';
import { certificates } from '../services/api';

const STATUS_CONFIG: Record<string, { label: string; color: string; description: string }> = {
  orphaned_never_reported: {
    label: 'Never Reported',
    color: 'red',
    description: 'Certificate was signed but this node has never submitted a report to PuppetDB',
  },
  orphaned_deactivated: {
    label: 'Deactivated',
    color: 'orange',
    description: 'Node was deactivated in PuppetDB but its certificate was not cleaned from the CA',
  },
  orphaned_expired: {
    label: 'Expired',
    color: 'yellow',
    description: 'Node record expired in PuppetDB (exceeded node-ttl) but the certificate remains',
  },
};

export function CertAuditPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [cleaning, setCleaning] = useState<Record<string, boolean>>({});
  const [showHealthy, setShowHealthy] = useState(false);
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkCleaning, setBulkCleaning] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSelected(new Set());
    try {
      const result = await certificates.audit();
      setData(result);
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  }, []);

  const toggleSelect = (certname: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(certname)) next.delete(certname);
      else next.add(certname);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const orphans = data?.orphaned || [];
    if (selected.size === orphans.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(orphans.map((c: any) => c.certname)));
    }
  };

  useEffect(() => { load(); }, [load]);

  const handleClean = async (certname: string) => {
    if (!confirm(`Clean certificate for "${certname}"? This removes the cert from the CA, deactivates the node in PuppetDB, and removes it from the ENC.`)) return;
    setCleaning(prev => ({ ...prev, [certname]: true }));
    try {
      await certificates.clean(certname);
      notifications.show({ title: 'Cleaned', message: `Certificate for "${certname}" has been removed`, color: 'green' });
      load();
    } catch (e: any) {
      notifications.show({ title: 'Error', message: e.message, color: 'red' });
    }
    setCleaning(prev => ({ ...prev, [certname]: false }));
  };

  const handleBulkClean = async () => {
    setBulkConfirmOpen(false);
    setBulkCleaning(true);
    const toClean = selected.size > 0
      ? (data?.orphaned || []).filter((c: any) => selected.has(c.certname))
      : (data?.orphaned || []);
    let cleaned = 0;
    let failed = 0;

    for (const cert of toClean) {
      try {
        await certificates.clean(cert.certname);
        cleaned++;
      } catch {
        failed++;
      }
    }

    notifications.show({
      title: 'Bulk Clean Complete',
      message: `${cleaned} cleaned, ${failed} failed`,
      color: failed > 0 ? 'orange' : 'green',
    });
    setBulkCleaning(false);
    load();
  };

  if (loading) return <Center h={400}><Loader size="xl" /></Center>;
  if (error) return <Alert color="red" title="Error">{error}</Alert>;

  const orphaned = data?.orphaned || [];
  const active = data?.active || [];

  return (
    <Stack>
      <Group>
        <IconShieldCheck size={28} />
        <Title order={2}>Certificate Audit</Title>
      </Group>

      {/* Summary */}
      <Group grow>
        <Paper withBorder p="md" ta="center">
          <Text size="xl" fw={700}>{data?.total_signed || 0}</Text>
          <Text size="sm" c="dimmed">Signed Certificates</Text>
        </Paper>
        <Paper withBorder p="md" ta="center">
          <Text size="xl" fw={700} c="green">{data?.total_active_nodes || 0}</Text>
          <Text size="sm" c="dimmed">Active Nodes</Text>
        </Paper>
        <Paper withBorder p="md" ta="center">
          <Text size="xl" fw={700} c={orphaned.length > 0 ? 'red' : 'green'}>{data?.total_orphaned || 0}</Text>
          <Text size="sm" c="dimmed">Orphaned Certificates</Text>
        </Paper>
      </Group>

      {/* Orphaned Certificates */}
      <Card withBorder shadow="sm" padding="md">
        <Group justify="space-between" mb="md">
          <Group gap="xs">
            <IconAlertTriangle size={20} color="var(--mantine-color-orange-6)" />
            <Title order={4}>Orphaned Certificates ({orphaned.length})</Title>
          </Group>
          <Group gap="xs">
            <Button size="xs" leftSection={<IconRefresh size={14} />} variant="light" onClick={load}>
              Refresh
            </Button>
            {orphaned.length > 0 && selected.size > 0 && (
              <Button size="xs" color="red" leftSection={<IconTrash size={14} />}
                onClick={() => setBulkConfirmOpen(true)} loading={bulkCleaning}>
                Clean Selected ({selected.size})
              </Button>
            )}
            {orphaned.length > 0 && selected.size === 0 && (
              <Button size="xs" color="red" variant="light" leftSection={<IconTrash size={14} />}
                onClick={() => setBulkConfirmOpen(true)} loading={bulkCleaning}>
                Clean All ({orphaned.length})
              </Button>
            )}
          </Group>
        </Group>

        {orphaned.length === 0 ? (
          <Alert color="green" icon={<IconCheck size={16} />}>
            All signed certificates have a matching active node in PuppetDB. No cleanup needed.
          </Alert>
        ) : (
          <>
            <Alert variant="light" color="orange" mb="md">
              These certificates are signed in the CA but have no active node in PuppetDB.
              They may belong to decommissioned servers, renamed hosts, or nodes that were
              signed but never completed a Puppet run. Cleaning removes the certificate from
              the CA, deactivates the node in PuppetDB, and removes it from the ENC.
            </Alert>
            <ScrollArea style={{ maxHeight: 500 }} type="auto" offsetScrollbars scrollbarSize={6}>
              <Table striped highlightOnHover withTableBorder>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th style={{ width: 40 }}>
                        <Checkbox
                          checked={selected.size === orphaned.length && orphaned.length > 0}
                          indeterminate={selected.size > 0 && selected.size < orphaned.length}
                          onChange={toggleSelectAll}
                        />
                      </Table.Th>
                      <Table.Th>Certname</Table.Th>
                      <Table.Th>Status</Table.Th>
                      <Table.Th>Reason</Table.Th>
                      <Table.Th>Fingerprint</Table.Th>
                      <Table.Th style={{ textAlign: 'right' }}>Actions</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                {orphaned.map((cert: any) => {
                  const cfg = STATUS_CONFIG[cert.status] || { label: cert.status, color: 'gray', description: '' };
                  return (
                    <Table.Tr key={cert.certname}>
                      <Table.Td>
                        <Checkbox
                          checked={selected.has(cert.certname)}
                          onChange={() => toggleSelect(cert.certname)}
                        />
                      </Table.Td>
                      <Table.Td><Text fw={500} size="sm" c="blue" style={{ cursor: 'pointer', textDecoration: 'underline' }}
                        onClick={() => navigate(`/nodes/${cert.certname}`)}>{cert.certname}</Text></Table.Td>
                      <Table.Td>
                        <Tooltip label={cfg.description} multiline maw={300}>
                          <Badge color={cfg.color} variant="filled" size="sm" style={{ cursor: 'help' }}>
                            {cfg.label}
                          </Badge>
                        </Tooltip>
                      </Table.Td>
                      <Table.Td><Text size="xs" c="dimmed">{cert.reason}</Text></Table.Td>
                      <Table.Td><Text size="xs" ff="monospace" c="dimmed">{cert.fingerprint?.substring(0, 20)}...</Text></Table.Td>
                      <Table.Td>
                        <Group gap="xs" justify="flex-end">
                          <Tooltip label="Clean this certificate">
                            <Button size="compact-xs" color="red" variant="light"
                              loading={cleaning[cert.certname]}
                              onClick={() => handleClean(cert.certname)}
                              leftSection={<IconTrash size={12} />}>
                              Clean
                            </Button>
                          </Tooltip>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
            </ScrollArea>
          </>
        )}
      </Card>

      {/* Healthy Certificates (collapsible) */}
      <Card withBorder shadow="sm" padding="md">
        <Group style={{ cursor: 'pointer' }} onClick={() => setShowHealthy(!showHealthy)}>
          <ActionIcon variant="subtle" size="sm">
            {showHealthy ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
          </ActionIcon>
          <Title order={4}>Healthy Certificates ({active.length})</Title>
          <Text size="sm" c="dimmed">Signed certs with matching active PuppetDB nodes</Text>
        </Group>
        <Collapse in={showHealthy}>
          <ScrollArea style={{ maxHeight: 500 }} mt="md" type="auto" offsetScrollbars scrollbarSize={6}>
            <Table striped highlightOnHover withTableBorder>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Certname</Table.Th>
                    <Table.Th>Node Status</Table.Th>
                    <Table.Th>Last Report</Table.Th>
                    <Table.Th>Fingerprint</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {active.map((cert: any) => (
                <Table.Tr key={cert.certname}>
                  <Table.Td><Text fw={500} size="sm" c="blue" style={{ cursor: 'pointer', textDecoration: 'underline' }}
                    onClick={() => navigate(`/nodes/${cert.certname}`)}>{cert.certname}</Text></Table.Td>
                  <Table.Td>
                    <Badge color={cert.latest_report_status === 'changed' ? 'blue' : cert.latest_report_status === 'failed' ? 'red' : 'green'} variant="light" size="sm">
                      {cert.latest_report_status || 'unknown'}
                    </Badge>
                  </Table.Td>
                  <Table.Td><Text size="xs" c="dimmed">{cert.report_timestamp ? new Date(cert.report_timestamp).toLocaleString() : 'Never'}</Text></Table.Td>
                  <Table.Td><Text size="xs" ff="monospace" c="dimmed">{cert.fingerprint?.substring(0, 20)}...</Text></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
              </Table>
            </ScrollArea>
        </Collapse>
      </Card>

      {/* Bulk clean confirmation modal */}
      <Modal opened={bulkConfirmOpen} onClose={() => setBulkConfirmOpen(false)}
        title={selected.size > 0 ? `Clean ${selected.size} Selected Certificates` : 'Clean All Orphaned Certificates'}>
        {(() => {
          const toClean = selected.size > 0
            ? orphaned.filter((c: any) => selected.has(c.certname))
            : orphaned;
          return (
            <Stack>
              <Alert color="red" icon={<IconAlertTriangle size={16} />}>
                This will remove <strong>{toClean.length}</strong> certificate{toClean.length !== 1 ? 's' : ''} from the CA,
                deactivate their nodes in PuppetDB, and remove them from the ENC.
                This action cannot be undone.
              </Alert>
              <Text size="sm">Certificates to be cleaned:</Text>
              <Table withTableBorder>
                <Table.Tbody>
                  {toClean.slice(0, 15).map((c: any) => (
                    <Table.Tr key={c.certname}>
                      <Table.Td><Text size="xs">{c.certname}</Text></Table.Td>
                      <Table.Td><Badge size="xs" color={STATUS_CONFIG[c.status]?.color || 'gray'}>{STATUS_CONFIG[c.status]?.label || c.status}</Badge></Table.Td>
                    </Table.Tr>
                  ))}
                  {toClean.length > 15 && (
                    <Table.Tr><Table.Td colSpan={2}><Text size="xs" c="dimmed">...and {toClean.length - 15} more</Text></Table.Td></Table.Tr>
                  )}
                </Table.Tbody>
              </Table>
              <Group justify="flex-end">
                <Button variant="subtle" onClick={() => setBulkConfirmOpen(false)}>Cancel</Button>
                <Button color="red" onClick={handleBulkClean}>Clean {toClean.length} Certificate{toClean.length !== 1 ? 's' : ''}</Button>
              </Group>
            </Stack>
          );
        })()}
      </Modal>
    </Stack>
  );
}
