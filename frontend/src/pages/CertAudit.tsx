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
  Modal, Checkbox,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconShieldCheck, IconAlertTriangle, IconTrash, IconRefresh,
  IconChevronDown, IconChevronRight, IconCheck,
} from '@tabler/icons-react';
import { certificates } from '../services/api';
import { ConfirmModal } from '../components/ConfirmModal';
import { LoadingState, ErrorState } from '../components/StateComponents';
import { OpsTable, OpsColumn } from '../components/OpsTable';

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
  const [pendingClean, setPendingClean] = useState<string | null>(null);

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
    setCleaning(prev => ({ ...prev, [certname]: true }));
    try {
      await certificates.clean(certname);
      notifications.show({ title: 'Cleaned', message: `Certificate for "${certname}" has been removed`, color: 'green' });
      setPendingClean(null);
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

  if (loading) return <LoadingState label="Auditing certificates…" />;
  if (error && !data) return <ErrorState title="Certificate audit failed" message={error} onRetry={load} />;
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
            <Group mb="xs" gap="sm">
              <Checkbox
                label="Select all on page (use OpsTable pages)"
                checked={selected.size === orphaned.length && orphaned.length > 0}
                indeterminate={selected.size > 0 && selected.size < orphaned.length}
                onChange={toggleSelectAll}
              />
              <Text size="xs" c="dimmed">{selected.size} selected · {orphaned.length} orphaned</Text>
            </Group>
            <OpsTable<any>
              data={orphaned}
              rowKey={(c) => c.certname}
              defaultPageSize={50}
              maxHeight={480}
              emptyTitle="No orphaned certificates"
              columns={[
                {
                  key: 'select',
                  header: '',
                  sortable: false,
                  width: 40,
                  render: (cert) => (
                    <Checkbox
                      checked={selected.has(cert.certname)}
                      onChange={() => toggleSelect(cert.certname)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ),
                },
                {
                  key: 'certname',
                  header: 'Certname',
                  sortValue: (c) => c.certname,
                  render: (cert) => (
                    <Text
                      fw={500}
                      size="sm"
                      c="blue"
                      style={{ cursor: 'pointer', textDecoration: 'underline' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/nodes/${cert.certname}`);
                      }}
                    >
                      {cert.certname}
                    </Text>
                  ),
                },
                {
                  key: 'status',
                  header: 'Status',
                  sortValue: (c) => c.status || '',
                  render: (cert) => {
                    const cfg = STATUS_CONFIG[cert.status] || { label: cert.status, color: 'gray', description: '' };
                    return (
                      <Tooltip label={cfg.description} multiline maw={300}>
                        <Badge color={cfg.color} variant="filled" size="sm" style={{ cursor: 'help' }}>
                          {cfg.label}
                        </Badge>
                      </Tooltip>
                    );
                  },
                },
                {
                  key: 'reason',
                  header: 'Reason',
                  sortValue: (c) => c.reason || '',
                  render: (cert) => <Text size="xs" c="dimmed">{cert.reason}</Text>,
                },
                {
                  key: 'fingerprint',
                  header: 'Fingerprint',
                  sortable: false,
                  render: (cert) => (
                    <Text size="xs" ff="monospace" c="dimmed">
                      {cert.fingerprint?.substring(0, 20)}...
                    </Text>
                  ),
                },
                {
                  key: 'actions',
                  header: 'Actions',
                  sortable: false,
                  render: (cert) => (
                    <Group gap="xs" justify="flex-end" onClick={(e) => e.stopPropagation()}>
                      <Tooltip label="Clean this certificate">
                        <Button
                          size="compact-xs"
                          color="red"
                          variant="light"
                          loading={cleaning[cert.certname]}
                          onClick={() => setPendingClean(cert.certname)}
                          leftSection={<IconTrash size={12} />}
                        >
                          Clean
                        </Button>
                      </Tooltip>
                    </Group>
                  ),
                },
              ] as OpsColumn<any>[]}
            />
          </>
        )}
      </Card>

      {/* Healthy Certificates (collapsible) — OpsTable */}
      <Card withBorder shadow="sm" padding="md" style={{ overflow: 'hidden' }}>
        <Group style={{ cursor: 'pointer' }} onClick={() => setShowHealthy(!showHealthy)}>
          <ActionIcon variant="subtle" size="sm">
            {showHealthy ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
          </ActionIcon>
          <Title order={4}>Healthy Certificates ({active.length})</Title>
          <Text size="sm" c="dimmed">Signed certs with matching active PuppetDB nodes</Text>
        </Group>
        <Collapse in={showHealthy}>
          <OpsTable<any>
            data={active}
            rowKey={(c) => c.certname}
            defaultPageSize={100}
            maxHeight={420}
            emptyTitle="No healthy certificates"
            onRowClick={(cert) => navigate(`/nodes/${cert.certname}`)}
            columns={[
              {
                key: 'certname',
                header: 'Certname',
                sortValue: (c) => c.certname,
                render: (cert) => (
                  <Text fw={500} size="sm" c="blue" style={{ textDecoration: 'underline' }}>
                    {cert.certname}
                  </Text>
                ),
              },
              {
                key: 'latest_report_status',
                header: 'Node Status',
                sortValue: (c) => c.latest_report_status || '',
                render: (cert) => (
                  <Badge
                    color={
                      cert.latest_report_status === 'changed'
                        ? 'blue'
                        : cert.latest_report_status === 'failed'
                          ? 'red'
                          : 'green'
                    }
                    variant="light"
                    size="sm"
                  >
                    {cert.latest_report_status || 'unknown'}
                  </Badge>
                ),
              },
              {
                key: 'report_timestamp',
                header: 'Last Report',
                sortType: 'date',
                sortValue: (c) => c.report_timestamp || '',
                render: (cert) => (
                  <Text size="xs" c="dimmed">
                    {cert.report_timestamp ? new Date(cert.report_timestamp).toLocaleString() : 'Never'}
                  </Text>
                ),
              },
              {
                key: 'fingerprint',
                header: 'Fingerprint',
                sortable: false,
                render: (cert) => (
                  <Text size="xs" ff="monospace" c="dimmed">
                    {cert.fingerprint?.substring(0, 20)}...
                  </Text>
                ),
              },
            ] as OpsColumn<any>[]}
          />
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

      <ConfirmModal
        opened={!!pendingClean}
        onClose={() => setPendingClean(null)}
        onConfirm={() => pendingClean && handleClean(pendingClean)}
        title="Clean certificate?"
        body={`Clean certificate for "${pendingClean}"? This removes the cert from the CA, deactivates the node in PuppetDB, and removes it from the ENC.`}
        details={pendingClean ? [pendingClean] : undefined}
        confirmLabel="Clean"
        danger
        loading={!!(pendingClean && cleaning[pendingClean])}
      />
    </Stack>
  );
}
