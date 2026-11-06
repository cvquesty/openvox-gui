/**
 * VM builder settings (admin): vCenter connection and guest defaults.
 * The password and proxy URL are write-only; the API only says whether they are set.
 */
import { useEffect, useState } from 'react';
import {
  Alert, Badge, Button, Card, Grid, Group, NumberInput, PasswordInput, Select, Stack, Switch,
  TagsInput, Text, Textarea, TextInput, Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconPlugConnected, IconDeviceFloppy } from '@tabler/icons-react';
import { vmbuilder, type VmBuilderSettings } from '../../services/api';

export function SettingsPanel({ onSaved }: { onSaved: () => void }) {
  const [cfg, setCfg] = useState<VmBuilderSettings | null>(null);
  const [password, setPassword] = useState('');
  const [proxy, setProxy] = useState('');
  const [keys, setKeys] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const s = await vmbuilder.getSettings();
      setCfg(s);
      setKeys(s.ssh_authorized_keys.join('\n'));
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  };

  useEffect(() => { load(); }, []);

  if (error) return <Alert color="red">{error}</Alert>;
  if (!cfg) return null;

  const set = <K extends keyof VmBuilderSettings>(key: K, value: VmBuilderSettings[K]) =>
    setCfg((c) => (c ? { ...c, [key]: value } : c));

  const save = async (extra: Record<string, unknown> = {}) => {
    setSaving(true);
    try {
      const patch: Record<string, unknown> = {
        vcenter_host: cfg.vcenter_host,
        vcenter_port: cfg.vcenter_port,
        vcenter_user: cfg.vcenter_user,
        verify_ssl: cfg.verify_ssl,
        ca_bundle: cfg.ca_bundle,
        template_prefix: cfg.template_prefix,
        default_domain: cfg.default_domain,
        default_datacenter: cfg.default_datacenter,
        agent_version: cfg.agent_version,
        dnf_groups: cfg.dnf_groups,
        no_proxy: cfg.no_proxy,
        ssh_authorized_keys: keys.split('\n').map((k) => k.trim()).filter(Boolean),
        ...extra,
      };
      if (password) patch.vcenter_password = password;
      if (proxy) patch.http_proxy = proxy;
      const saved = await vmbuilder.saveSettings(patch);
      setCfg(saved);
      setKeys(saved.ssh_authorized_keys.join('\n'));
      setPassword('');
      setProxy('');
      notifications.show({ color: 'green', title: 'Saved', message: 'VM builder settings updated' });
      onSaved();
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Not saved', message: e.message });
    }
    setSaving(false);
  };

  const test = async () => {
    setTesting(true);
    try {
      const r = await vmbuilder.testConnection();
      notifications.show({
        color: 'green', title: 'vCenter login OK',
        message: `${r.datacenters.length} datacenter(s): ${r.datacenters.join(', ') || 'none visible'}`,
      });
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'vCenter login failed', message: e.message });
    }
    setTesting(false);
  };

  return (
    <Stack gap="md">
      <Card withBorder padding="md">
        <Group justify="space-between" mb="xs">
          <Title order={4}>vCenter connection</Title>
          <Group gap="xs">
            <Badge color={cfg.password_set ? 'green' : 'gray'} variant="light">
              password {cfg.password_set ? 'set' : 'not set'}
            </Badge>
            {!cfg.pyvmomi_installed && <Badge color="red">pyvmomi missing</Badge>}
          </Group>
        </Group>
        <Text size="xs" c="dimmed" mb="sm">
          Use a dedicated vCenter service account with clone, configure and power permissions on the target
          folders, pools, datastores and networks. The password is encrypted in the GUI database and never
          sent back to the browser.
        </Text>
        <Grid gap="sm">
          <Grid.Col span={{ base: 12, md: 6 }}>
            <TextInput label="vCenter host" placeholder="vcenter.example.com" value={cfg.vcenter_host}
              onChange={(e) => set('vcenter_host', e.currentTarget.value)} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 2 }}>
            <NumberInput label="Port" min={1} max={65535} value={cfg.vcenter_port}
              onChange={(v) => set('vcenter_port', Number(v) || 443)} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 4 }}>
            <TextInput label="Username" placeholder="svc-openvox@vsphere.local" value={cfg.vcenter_user}
              onChange={(e) => set('vcenter_user', e.currentTarget.value)} autoComplete="off" />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <PasswordInput label="Password" autoComplete="new-password"
              placeholder={cfg.password_set ? 'Saved — type to replace' : 'Not set'}
              value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <TextInput label="CA bundle path (on this console)" placeholder="System trust store"
              value={cfg.ca_bundle} onChange={(e) => set('ca_bundle', e.currentTarget.value)} />
          </Grid.Col>
          <Grid.Col span={12}>
            <Switch label="Verify the vCenter TLS certificate" checked={cfg.verify_ssl}
              onChange={(e) => set('verify_ssl', e.currentTarget.checked)}
              description="Turn off only for lab vCenters with self-signed certificates" />
          </Grid.Col>
        </Grid>
      </Card>

      <Card withBorder padding="md">
        <Title order={4} mb="xs">Build defaults</Title>
        <Grid gap="sm">
          <Grid.Col span={{ base: 12, md: 4 }}>
            <TextInput label="Template name prefix" placeholder="e.g. ovbuilder-"
              description="Only templates whose name starts with this are offered. Blank = all templates."
              value={cfg.template_prefix} onChange={(e) => set('template_prefix', e.currentTarget.value)} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 4 }}>
            <TextInput label="Default guest domain" placeholder="example.com"
              description="Appended to short hostnames to form the certname"
              value={cfg.default_domain} onChange={(e) => set('default_domain', e.currentTarget.value)} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 4 }}>
            <TextInput label="Default datacenter" value={cfg.default_datacenter}
              onChange={(e) => set('default_datacenter', e.currentTarget.value)} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 4 }}>
            <Select label="OpenVox agent major" value={cfg.agent_version || ''}
              data={[{ value: '', label: 'Installer default (newest mirrored)' }, { value: '8', label: '8' }, { value: '9', label: '9' }]}
              onChange={(v) => set('agent_version', v || '')} allowDeselect={false} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 8 }}>
            <TagsInput label="DNF groups at first boot (EL guests)" placeholder="e.g. Development Tools"
              value={cfg.dnf_groups} onChange={(v) => set('dnf_groups', v)} />
          </Grid.Col>
          <Grid.Col span={12}>
            <Textarea label="SSH authorized keys for the template's default user" autosize minRows={2} maxRows={6}
              placeholder="ssh-ed25519 AAAA… ops@example.com" value={keys} onChange={(e) => setKeys(e.currentTarget.value)}
              description="Public keys only, one per line. Password SSH stays disabled and root stays locked." />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <PasswordInput label="Guest HTTP proxy" autoComplete="off"
              placeholder={cfg.http_proxy_set ? 'Saved — type to replace' : 'http://proxy.example.com:3128'}
              value={proxy} onChange={(e) => setProxy(e.currentTarget.value)}
              description="Written into the guest. vCenter users who can read VM advanced settings can see it." />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <TagsInput label="Extra no_proxy hosts" value={cfg.no_proxy} onChange={(v) => set('no_proxy', v)}
              description="The console, compiler and CA are always bypassed" />
          </Grid.Col>
        </Grid>
      </Card>

      <Group justify="space-between">
        <Group gap="xs">
          {cfg.password_set && (
            <Button variant="subtle" color="red" size="xs" onClick={() => save({ vcenter_password: '' })}>Clear password</Button>
          )}
          {cfg.http_proxy_set && (
            <Button variant="subtle" color="red" size="xs" onClick={() => save({ http_proxy: '' })}>Clear proxy</Button>
          )}
        </Group>
        <Group gap="xs">
          <Button variant="default" leftSection={<IconPlugConnected size={16} />} onClick={test} loading={testing}
            disabled={!cfg.configured}>Test connection</Button>
          <Button leftSection={<IconDeviceFloppy size={16} />} onClick={() => save()} loading={saving}>Save</Button>
        </Group>
      </Group>
    </Stack>
  );
}
