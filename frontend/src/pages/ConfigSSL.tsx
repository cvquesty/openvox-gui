/**
 * OpenVox GUI - ConfigSSL.tsx
 * 
 * SSL Configuration page under Settings.
 * Shows current SSL status, configured certificate paths (editable),
 * and browsable list of certificates on disk. Includes instructions
 * for accepting certs on Mac and Windows.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Title, Card, Loader, Center, Alert, Stack, Group, Text, Code, Table,
  Badge, ScrollArea, Divider, Box, TextInput, Switch, Button, ActionIcon, Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconLock, IconAlertTriangle, IconInfoCircle, IconEdit, IconDeviceFloppy,
  IconX, IconFolderOpen,
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
  
  // Editing state
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [edited, setEdited] = useState({
    ssl_enabled: false,
    cert_path: '',
    key_path: '',
    ca_path: '',
  });
  const [restartNeeded, setRestartNeeded] = useState(false);

  const load = useCallback(() => {
    config.getSSL()
      .then((data: SSLConfig) => {
        setSsl(data);
        setEdited({
          ssl_enabled: data.ssl_enabled,
          cert_path: data.cert_path,
          key_path: data.key_path,
          ca_path: data.ca_path,
        });
      })
      .catch(() => notifications.show({ title: 'Error', message: 'Failed to load SSL config', color: 'red' }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (ts: number) => new Date(ts * 1000).toLocaleString();

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await config.updateSSL({
        ssl_enabled: edited.ssl_enabled,
        cert_path: edited.cert_path,
        key_path: edited.key_path,
        ca_path: edited.ca_path,
      });
      notifications.show({ title: 'Saved', message: res.message || 'SSL configuration updated.', color: 'green' });
      setEditing(false);
      setRestartNeeded(true);
      load(); // refresh
    } catch (e: any) {
      notifications.show({ title: 'Error', message: e?.message || 'Failed to save SSL config', color: 'red' });
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (ssl) {
      setEdited({
        ssl_enabled: ssl.ssl_enabled,
        cert_path: ssl.cert_path,
        key_path: ssl.key_path,
        ca_path: ssl.ca_path,
      });
    }
    setEditing(false);
  };

  // Quick-populate path from a cert on disk
  const populateFrom = (path: string, type: string) => {
    if (type === 'certs') setEdited(e => ({ ...e, cert_path: path }));
    else if (type === 'private_keys') setEdited(e => ({ ...e, key_path: path }));
    else if (type === 'ca') setEdited(e => ({ ...e, ca_path: path }));
  };

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
        {!editing && (
          <ActionIcon variant="subtle" onClick={() => setEditing(true)} title="Edit">
            <IconEdit size={16} />
          </ActionIcon>
        )}
      </Group>

      {restartNeeded && (
        <Alert icon={<IconAlertTriangle size={16} />} color="orange" title="Restart Required" onClose={() => setRestartNeeded(false)} withCloseButton>
          SSL configuration has been updated. Restart the <Code>openvox-gui</Code> service for changes to take effect.
        </Alert>
      )}

      {ssl && !ssl.ssl_enabled && !editing && (
        <Alert icon={<IconAlertTriangle size={16} />} color="orange" title="SSL Not Enabled">
          The GUI is currently serving over HTTP. Enable SSL below or via the installer.
        </Alert>
      )}

      {/* Configured Paths (editable when editing) */}
      <Card withBorder padding="md">
        <Group justify="space-between" mb="sm">
          <Title order={4}>Configured Certificate Paths</Title>
          {editing && (
            <Group gap="xs">
              <Button variant="subtle" size="xs" leftSection={<IconX size={14} />} onClick={handleCancel}>Cancel</Button>
              <Button size="xs" leftSection={<IconDeviceFloppy size={14} />} onClick={handleSave} loading={saving}>Save</Button>
            </Group>
          )}
        </Group>
        <Table variant="vertical" striped>
          <Table.Tbody>
            <Table.Tr>
              <Table.Th style={{ width: 180 }}>SSL Enabled</Table.Th>
              <Table.Td>
                {editing ? (
                  <Switch checked={edited.ssl_enabled} onChange={(e) => setEdited(ed => ({ ...ed, ssl_enabled: e.currentTarget.checked }))} label={edited.ssl_enabled ? 'Enabled' : 'Disabled'} />
                ) : (
                  <Badge color={ssl?.ssl_enabled ? 'green' : 'gray'}>{ssl?.ssl_enabled ? 'Yes' : 'No'}</Badge>
                )}
              </Table.Td>
            </Table.Tr>
            <Table.Tr>
              <Table.Th>Certificate (cert)</Table.Th>
              <Table.Td>
                {editing ? (
                  <Group gap="xs">
                    <TextInput style={{ flex: 1 }} value={edited.cert_path} onChange={(e) => setEdited(ed => ({ ...ed, cert_path: e.currentTarget.value }))} placeholder="/etc/puppetlabs/puppet/ssl/certs/host.pem" />
                    <Tooltip label="Browse certs on disk"><ActionIcon variant="subtle" onClick={() => {}}><IconFolderOpen size={16} /></ActionIcon></Tooltip>
                  </Group>
                ) : (
                  <Code>{ssl?.cert_path}</Code>
                )}
              </Table.Td>
            </Table.Tr>
            <Table.Tr>
              <Table.Th>Private Key</Table.Th>
              <Table.Td>
                {editing ? (
                  <Group gap="xs">
                    <TextInput style={{ flex: 1 }} value={edited.key_path} onChange={(e) => setEdited(ed => ({ ...ed, key_path: e.currentTarget.value }))} placeholder="/etc/puppetlabs/puppet/ssl/private_keys/host.pem" />
                  </Group>
                ) : (
                  <Code>{ssl?.key_path}</Code>
                )}
              </Table.Td>
            </Table.Tr>
            <Table.Tr>
              <Table.Th>CA Certificate</Table.Th>
              <Table.Td>
                {editing ? (
                  <Group gap="xs">
                    <TextInput style={{ flex: 1 }} value={edited.ca_path} onChange={(e) => setEdited(ed => ({ ...ed, ca_path: e.currentTarget.value }))} placeholder="/etc/puppetlabs/puppet/ssl/certs/ca.pem" />
                  </Group>
                ) : (
                  <Code>{ssl?.ca_path}</Code>
                )}
              </Table.Td>
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
                  <Table.Tr
                    key={i}
                    style={{ cursor: editing ? 'pointer' : 'default' }}
                    onClick={() => editing && populateFrom(c.path, c.type)}
                  >
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
