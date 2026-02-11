import { useState, useCallback, useEffect } from 'react';
import {
  Title, Card, Stack, Group, Text, Button, Alert, Loader, Center,
  Table, Badge, Code, Modal, ActionIcon, Tooltip, ScrollArea,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconCertificate, IconCheck, IconX, IconTrash, IconRefresh, IconInfoCircle,
} from '@tabler/icons-react';
import { certificates } from '../services/api';

export function CertificatesPage() {
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
        title={`Certificate Details — ${detailData?.certname || ''}`} size="lg">
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
