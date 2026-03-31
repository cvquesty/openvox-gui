/**
 * OpenVox GUI - ConfigSSL.tsx
 * 
 * SSL Configuration page under Settings.
 * Shows current SSL status, configured certificate paths, and browsable
 * list of certificates on disk. Includes instructions for accepting
 * certs on Mac and Windows.
 */
import { useState, useEffect } from 'react';
import {
  Title, Card, Loader, Center, Alert, Stack, Group, Text, Code, Table,
  Badge, ScrollArea, Divider, Box,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconLock, IconAlertTriangle, IconInfoCircle, IconCertificate,
} from '@tabler/icons-react';
import { config } from '../services/api';

/* ── Types ─────────────────────────────────────────────── */
interface CertOnDisk {
  path: string;
  type: string;  // certs | private_keys | ca
  size: number;
  modified: number;
}

interface SSLConfig {
  ssl_enabled: boolean;
  cert_path: string;
  key_path: string;
  ca_path: string;
  certs_on_disk: CertOnDisk[];
  ssl_dir: string;
}

export function ConfigSSLPage() {
  const [loading, setLoading] = useState(true);
  const [ssl, setSsl] = useState<SSLConfig | null>(null);

  useEffect(() => {
    config.getSSL()
      .then((data: SSLConfig) => setSsl(data))
      .catch(() => notifications.show({ title: 'Error', message: 'Failed to load SSL config', color: 'red' }))
      .finally(() => setLoading(false));
  }, []);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (ts: number) => new Date(ts * 1000).toLocaleString();

  if (loading) {
    return <Center h={300}><Loader /></Center>;
  }

  return (
    <Stack gap="lg">
      <Group>
        <IconLock size={28} />
        <Title order={2}>SSL Configuration</Title>
        {ssl && (
          <Badge color={ssl.ssl_enabled ? 'green' : 'gray'} variant="filled">
            {ssl.ssl_enabled ? 'Enabled' : 'Disabled'}
          </Badge>
        )}
      </Group>

      {ssl && !ssl.ssl_enabled && (
        <Alert icon={<IconAlertTriangle size={16} />} color="orange" title="SSL Not Enabled">
          The GUI is currently serving over HTTP. To enable HTTPS, set <Code>OPENVOX_GUI_SSL_ENABLED=true</Code> in the <Code>.env</Code> file and restart the service.
        </Alert>
      )}

      {/* Configured Paths */}
      <Card withBorder padding="md">
        <Title order={4} mb="sm">Configured Certificate Paths</Title>
        <Table variant="vertical" striped>
          <Table.Tbody>
            <Table.Tr>
              <Table.Th style={{ width: 180 }}>Certificate (cert)</Table.Th>
              <Table.Td><Code>{ssl?.cert_path}</Code></Table.Td>
            </Table.Tr>
            <Table.Tr>
              <Table.Th>Private Key</Table.Th>
              <Table.Td><Code>{ssl?.key_path}</Code></Table.Td>
            </Table.Tr>
            <Table.Tr>
              <Table.Th>CA Certificate</Table.Th>
              <Table.Td><Code>{ssl?.ca_path}</Code></Table.Td>
            </Table.Tr>
            <Table.Tr>
              <Table.Th>SSL Directory</Table.Th>
              <Table.Td><Code>{ssl?.ssl_dir}</Code></Table.Td>
            </Table.Tr>
          </Table.Tbody>
        </Table>
      </Card>

      {/* Certificates on Disk */}
      <Card withBorder padding="md">
        <Group justify="space-between" mb="sm">
          <Title order={4}>Certificates on Disk</Title>
          <Text size="sm" c="dimmed">{ssl?.certs_on_disk.length ?? 0} files</Text>
        </Group>
        {ssl && ssl.certs_on_disk.length > 0 ? (
          <ScrollArea h={400}>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Path</Table.Th>
                  <Table.Th>Type</Table.Th>
                  <Table.Th>Size</Table.Th>
                  <Table.Th>Modified</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {ssl.certs_on_disk.map((c, i) => (
                  <Table.Tr key={i}>
                    <Table.Td><Code style={{ fontSize: 12 }}>{c.path}</Code></Table.Td>
                    <Table.Td><Badge size="sm" variant="outline">{c.type}</Badge></Table.Td>
                    <Table.Td>{formatSize(c.size)}</Table.Td>
                    <Table.Td>{formatDate(c.modified)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        ) : (
          <Text c="dimmed">No certificate files found in {ssl?.ssl_dir}</Text>
        )}
      </Card>

      {/* NOTE Section: Accepting Certificates */}
      <Card withBorder padding="md" style={{ background: 'var(--mantine-color-blue-0)' }}>
        <Group mb="sm">
          <IconInfoCircle size={20} />
          <Title order={4}>NOTE: Accepting Certificates Locally</Title>
        </Group>
        <Text size="sm" mb="md">
          When connecting to the GUI over HTTPS with self-signed or Puppet-managed certificates,
          your browser will warn about an untrusted certificate. To use the GUI without warnings:
        </Text>

        <Divider my="sm" label="Macintosh (macOS)" labelPosition="left" />
        <Box pl="md" mb="md">
          <Text size="sm">1. Open <Code>Keychain Access</Code> (Applications → Utilities).</Text>
          <Text size="sm">2. Drag the <Code>.pem</Code> certificate file (e.g., <Code>{ssl?.cert_path}</Code>) into the <strong>Certificates</strong> category.</Text>
          <Text size="sm">3. Double-click the imported certificate → set <strong>Trust → When using this certificate</strong> to <em>Always Trust</em>.</Text>
          <Text size="sm">4. Close and authenticate. The certificate is now trusted system-wide.</Text>
          <Text size="sm" c="dimmed">Alternatively, run: <Code>sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain /etc/puppetlabs/puppet/ssl/certs/$(hostname -f).pem</Code></Text>
        </Box>

        <Divider my="sm" label="Windows" labelPosition="left" />
        <Box pl="md">
          <Text size="sm">1. Double-click the <Code>.pem</Code> certificate file.</Text>
          <Text size="sm">2. Click <strong>Install Certificate</strong> → choose <strong>Local Machine</strong> (requires admin).</Text>
          <Text size="sm">3. Select <strong>Place all certificates in the following store</strong> → <strong>Trusted Root Certification Authorities</strong>.</Text>
          <Text size="sm">4. Complete the wizard and restart your browser.</Text>
          <Text size="sm" c="dimmed">Or import via PowerShell: <Code>Import-Certificate -FilePath "C:\path\to\cert.pem" -CertStoreLocation Cert:\LocalMachine\Root</Code></Text>
        </Box>
      </Card>
    </Stack>
  );
}

export default ConfigSSLPage;
