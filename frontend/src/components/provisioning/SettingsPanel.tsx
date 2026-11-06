/**
 * Provisioning settings (admin): provider connections and guest defaults.
 * Passwords and the proxy URL are write-only; the API only says whether they are set.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Badge, Button, Card, Grid, Group, NumberInput, PasswordInput, Select, Stack, Switch,
  Table, TagsInput, Text, Textarea, TextInput, Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDeviceFloppy, IconPlugConnected, IconPlus, IconTrash } from '@tabler/icons-react';
import { ConfirmModal } from '../ConfirmModal';
import {
  provisioning, type ProvisionConnection, type ProvisioningSettings, type ProvisioningStatus,
} from '../../services/api';

const NEW_ID = '__new__';

function ConnectionEditor({
  existing, providers, onSaved, onDeleted,
}: {
  existing: ProvisionConnection | null;
  providers: ProvisioningStatus['providers'];
  onSaved: (id: string) => void;
  onDeleted: () => void;
}) {
  const [id, setId] = useState(existing?.id || '');
  const [provider, setProvider] = useState(existing?.provider || 'vmware');
  const [name, setName] = useState(existing?.name || '');
  const [host, setHost] = useState(existing?.host || '');
  const [port, setPort] = useState(existing?.port || 443);
  const [username, setUsername] = useState(existing?.username || '');
  const [password, setPassword] = useState('');
  const [verifySsl, setVerifySsl] = useState(existing?.verify_ssl ?? true);
  const [caBundle, setCaBundle] = useState(existing?.ca_bundle || '');
  const [templatePrefix, setTemplatePrefix] = useState<string>(existing?.options?.template_prefix ?? 'ovbuilder-');
  const [defaultDc, setDefaultDc] = useState<string>(existing?.options?.default_datacenter || '');
  const [isDefault, setIsDefault] = useState(existing?.is_default ?? false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const save = async (extra: Record<string, unknown> = {}) => {
    setSaving(true);
    try {
      const patch: Record<string, unknown> = {
        provider, name, host, port, username, verify_ssl: verifySsl, ca_bundle: caBundle,
        options: { template_prefix: templatePrefix, default_datacenter: defaultDc },
        ...(isDefault ? { is_default: true } : {}),
        ...extra,
      };
      if (password) patch.password = password;
      const saved = await provisioning.saveConnection(id.trim().toLowerCase(), patch);
      setPassword('');
      notifications.show({ color: 'green', title: 'Saved', message: `Connection ${saved.id} updated` });
      onSaved(saved.id);
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Not saved', message: e.message });
    }
    setSaving(false);
  };

  const test = async () => {
    setTesting(true);
    try {
      const r = await provisioning.testConnection(id);
      notifications.show({
        color: 'green', title: 'Login OK',
        message: `${r.scopes.length} datacenter(s): ${r.scopes.join(', ') || 'none visible'}`,
      });
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Login failed', message: e.message });
    }
    setTesting(false);
  };

  return (
    <Card withBorder padding="md">
      <Group justify="space-between" mb="xs">
        <Title order={5}>{existing ? `Connection ${existing.id}` : 'New connection'}</Title>
        <Group gap="xs">
          {existing?.source === 'env' && <Badge variant="light" color="gray">from .env until saved</Badge>}
          {existing && (
            <Badge color={existing.password_set ? 'green' : 'gray'} variant="light">
              password {existing.password_set ? 'set' : 'not set'}
            </Badge>
          )}
        </Group>
      </Group>
      <Text size="xs" c="dimmed" mb="sm">
        Use a dedicated vCenter service account with clone, configure and power permissions on the target
        folders, pools, datastores and networks. The password is encrypted in the GUI database and never
        sent back to the browser.
      </Text>
      <Grid gap="sm">
        <Grid.Col span={{ base: 12, md: 3 }}>
          <TextInput label="Connection id" required disabled={!!existing} placeholder="default"
            description="Lowercase letters, digits, dashes" value={id} onChange={(e) => setId(e.currentTarget.value)} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 3 }}>
          <Select label="Provider" disabled={!!existing} data={providers.map((p) => ({ value: p.kind, label: p.label }))}
            value={provider} onChange={(v) => setProvider(v || 'vmware')} allowDeselect={false} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <TextInput label="Display name" placeholder="Site A vCenter" value={name} onChange={(e) => setName(e.currentTarget.value)} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <TextInput label="vCenter host" placeholder="vcenter.example.com" value={host} onChange={(e) => setHost(e.currentTarget.value)} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 2 }}>
          <NumberInput label="Port" min={1} max={65535} value={port} onChange={(v) => setPort(Number(v) || 443)} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 4 }}>
          <TextInput label="Username" placeholder="svc-openvox@vsphere.local" autoComplete="off"
            value={username} onChange={(e) => setUsername(e.currentTarget.value)} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <PasswordInput label="Password" autoComplete="new-password"
            placeholder={existing?.password_set ? 'Saved — type to replace' : 'Not set'}
            value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <TextInput label="CA bundle path (on this console)" placeholder="System trust store"
            value={caBundle} onChange={(e) => setCaBundle(e.currentTarget.value)} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <TextInput label="Template name prefix" placeholder="ovbuilder-"
            description="Only templates whose name starts with this are offered. Blank = all templates."
            value={templatePrefix} onChange={(e) => setTemplatePrefix(e.currentTarget.value)} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <TextInput label="Default datacenter" value={defaultDc} onChange={(e) => setDefaultDc(e.currentTarget.value)} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Switch label="Verify the vCenter TLS certificate" checked={verifySsl}
            onChange={(e) => setVerifySsl(e.currentTarget.checked)}
            description="Turn off only for lab vCenters with self-signed certificates" />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Switch label="Default connection" checked={isDefault} disabled={existing?.is_default}
            onChange={(e) => setIsDefault(e.currentTarget.checked)} description="Preselected on the build form" />
        </Grid.Col>
      </Grid>
      <Group justify="space-between" mt="md">
        <Group gap="xs">
          {existing?.password_set && existing.source === 'db' && (
            <Button variant="subtle" color="red" size="xs" onClick={() => save({ password: '' })}>Clear password</Button>
          )}
          {existing?.source === 'db' && (
            <Button variant="subtle" color="red" size="xs" leftSection={<IconTrash size={14} />}
              onClick={() => setDeleting(true)}>Delete</Button>
          )}
        </Group>
        <Group gap="xs">
          {existing && (
            <Button variant="default" leftSection={<IconPlugConnected size={16} />} onClick={test} loading={testing}
              disabled={!existing.configured}>Test connection</Button>
          )}
          <Button leftSection={<IconDeviceFloppy size={16} />} onClick={() => save()} loading={saving} disabled={!id.trim()}>
            Save
          </Button>
        </Group>
      </Group>
      <ConfirmModal
        opened={deleting}
        onClose={() => setDeleting(false)}
        onConfirm={async () => {
          try {
            await provisioning.deleteConnection(id);
            setDeleting(false);
            onDeleted();
          } catch (e: any) {
            notifications.show({ color: 'red', title: 'Not deleted', message: e.message });
          }
        }}
        title={`Delete connection ${id}?`}
        body="Builds that used it keep their history. Its stored password is removed."
        confirmLabel="Delete"
        danger
      />
    </Card>
  );
}

function GuestDefaults({ onSaved }: { onSaved: () => void }) {
  const [cfg, setCfg] = useState<ProvisioningSettings | null>(null);
  const [proxy, setProxy] = useState('');
  const [keys, setKeys] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    provisioning.getSettings().then((s) => { setCfg(s); setKeys(s.ssh_authorized_keys.join('\n')); });
  }, []);
  if (!cfg) return null;
  const set = <K extends keyof ProvisioningSettings>(key: K, value: ProvisioningSettings[K]) =>
    setCfg((c) => (c ? { ...c, [key]: value } : c));

  const save = async (extra: Record<string, unknown> = {}) => {
    setSaving(true);
    try {
      const patch: Record<string, unknown> = {
        default_domain: cfg.default_domain,
        agent_version: cfg.agent_version,
        dnf_groups: cfg.dnf_groups,
        no_proxy: cfg.no_proxy,
        ssh_authorized_keys: keys.split('\n').map((k) => k.trim()).filter(Boolean),
        ...extra,
      };
      if (proxy) patch.http_proxy = proxy;
      const saved = await provisioning.saveSettings(patch);
      setCfg(saved);
      setKeys(saved.ssh_authorized_keys.join('\n'));
      setProxy('');
      notifications.show({ color: 'green', title: 'Saved', message: 'Guest defaults updated' });
      onSaved();
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Not saved', message: e.message });
    }
    setSaving(false);
  };

  return (
    <Card withBorder padding="md">
      <Title order={4} mb="xs">Guest defaults (all providers)</Title>
      <Grid gap="sm">
        <Grid.Col span={{ base: 12, md: 6 }}>
          <TextInput label="Default guest domain" placeholder="example.com"
            description="Appended to short hostnames to form the certname and VM name"
            value={cfg.default_domain} onChange={(e) => set('default_domain', e.currentTarget.value)} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Select label="OpenVox agent major" value={cfg.agent_version || ''}
            data={[{ value: '', label: 'Installer default (newest mirrored)' }, { value: '8', label: '8' }, { value: '9', label: '9' }]}
            onChange={(v) => set('agent_version', v || '')} allowDeselect={false} />
        </Grid.Col>
        <Grid.Col span={12}>
          <TagsInput label="DNF groups at first boot (EL guests)" placeholder="e.g. Development Tools"
            value={cfg.dnf_groups} onChange={(v) => set('dnf_groups', v)} />
        </Grid.Col>
        <Grid.Col span={12}>
          <Textarea label="SSH authorized keys for the image's default user" autosize minRows={2} maxRows={6}
            placeholder="ssh-ed25519 AAAA… ops@example.com" value={keys} onChange={(e) => setKeys(e.currentTarget.value)}
            description="Public keys only, one per line. Password SSH stays disabled and root stays locked." />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <PasswordInput label="Guest HTTP proxy" autoComplete="off"
            placeholder={cfg.http_proxy_set ? 'Saved — type to replace' : 'http://proxy.example.com:3128'}
            value={proxy} onChange={(e) => setProxy(e.currentTarget.value)}
            description="Written into the guest. vCenter users who can read VM advanced settings can see it until the build scrubs it." />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <TagsInput label="Extra no_proxy hosts" value={cfg.no_proxy} onChange={(v) => set('no_proxy', v)}
            description="The console, compiler and CA are always bypassed" />
        </Grid.Col>
      </Grid>
      <Group justify="space-between" mt="md">
        {cfg.http_proxy_set ? (
          <Button variant="subtle" color="red" size="xs" onClick={() => save({ http_proxy: '' })}>Clear proxy</Button>
        ) : <span />}
        <Button leftSection={<IconDeviceFloppy size={16} />} onClick={() => save()} loading={saving}>Save</Button>
      </Group>
    </Card>
  );
}

export function SettingsPanel({ status, onSaved }: { status: ProvisioningStatus; onSaved: () => void }) {
  const [connections, setConnections] = useState<ProvisionConnection[]>(status.connections);
  const [selected, setSelected] = useState<string>(status.default_connection || (status.connections[0]?.id ?? NEW_ID));
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (select?: string) => {
    try {
      const list = await provisioning.connections();
      setConnections(list);
      setSelected(select || list.find((c) => c.is_default)?.id || list[0]?.id || NEW_ID);
      setError(null);
      onSaved();
    } catch (e: any) {
      setError(e.message);
    }
  }, [onSaved]);

  const current = connections.find((c) => c.id === selected) || null;
  return (
    <Stack gap="md">
      {error && <Alert color="red">{error}</Alert>}
      <Card withBorder padding="md">
        <Group justify="space-between" mb="xs">
          <Title order={4}>Provider connections</Title>
          <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => setSelected(NEW_ID)}>
            Add connection
          </Button>
        </Group>
        {connections.length === 0 ? (
          <Text size="sm" c="dimmed">No connection yet. Add the vCenter this console provisions into.</Text>
        ) : (
          <Table highlightOnHover fz="sm" verticalSpacing={6}>
            <Table.Thead>
              <Table.Tr><Table.Th>Id</Table.Th><Table.Th>Provider</Table.Th><Table.Th>Host</Table.Th><Table.Th>Status</Table.Th></Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {connections.map((c) => (
                <Table.Tr key={c.id} onClick={() => setSelected(c.id)} style={{ cursor: 'pointer' }}
                  bg={c.id === selected ? 'var(--mantine-primary-color-light)' : undefined}>
                  <Table.Td><Text size="sm" fw={500}>{c.name}</Text><Text size="xs" c="dimmed">{c.id}</Text></Table.Td>
                  <Table.Td>{c.provider_label}</Table.Td>
                  <Table.Td>{c.host}</Table.Td>
                  <Table.Td>
                    <Group gap={4}>
                      {c.is_default && <Badge size="xs" tt="none">default</Badge>}
                      <Badge size="xs" tt="none" color={c.configured ? 'green' : 'gray'} variant="light">
                        {c.configured ? 'ready' : 'incomplete'}
                      </Badge>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Card>
      <ConnectionEditor
        key={selected}
        existing={current}
        providers={status.providers}
        onSaved={(id) => reload(id)}
        onDeleted={() => reload()}
      />
      <GuestDefaults onSaved={onSaved} />
    </Stack>
  );
}
