import { useState, useCallback, useEffect } from 'react';
import {
  Title, Loader, Center, Alert, Card, Stack, Text, Code, Table, Badge, Group,
  Tabs, TextInput, PasswordInput, Select, ActionIcon, Modal, Tooltip, Button,
  Grid, SegmentedControl, Switch, Divider, Accordion, Collapse,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconSettings, IconUsers, IconPlus, IconTrash, IconKey, IconShield,
  IconEdit, IconDeviceFloppy, IconX, IconRefresh, IconServer,
  IconPlugConnected, IconTestPipe, IconLock, IconWorld,
  IconSwitchHorizontal,
} from '@tabler/icons-react';
import { useApi } from '../hooks/useApi';
import { config, users, ldap } from '../services/api';
import { useAuth } from '../hooks/AuthContext';
import { useAppTheme } from '../hooks/ThemeContext';
import { StatusBadge } from '../components/StatusBadge';

/* ────────────────────── Types ────────────────────── */
interface User {
  username: string;
  role: string;
  auth_source?: string;
}

const roleBadgeColor: Record<string, string> = {
  admin: 'red',
  operator: 'blue',
  viewer: 'gray',
};

const authSourceColor: Record<string, string> = {
  local: 'cyan',
  ldap: 'grape',
};

/* ── People Processing Machine SVG (unchanged) ──────────── */
function PeopleProcessingMachine() {
  return (
    <svg viewBox="0 0 500 320" width="100%" style={{ maxHeight: 360 }}>
      <defs>
        <linearGradient id="pm-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1a1b2e" />
          <stop offset="100%" stopColor="#252540" />
        </linearGradient>
        <linearGradient id="pm-machine" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#556677" />
          <stop offset="100%" stopColor="#3d4d5d" />
        </linearGradient>
      </defs>
      <rect width="500" height="320" fill="url(#pm-sky)" rx="8" />
      <rect x="0" y="260" width="500" height="60" fill="#1a1a2e" />
      <rect x="0" y="260" width="500" height="2" fill="#333355" />
      <rect x="30" y="240" width="440" height="12" fill="#334455" rx="6" />
      <circle cx="50" cy="246" r="5" fill="#445566" stroke="#556677" strokeWidth="1">
        <animateTransform attributeName="transform" type="rotate" values="0 50 246;360 50 246" dur="2s" repeatCount="indefinite" />
      </circle>
      <circle cx="450" cy="246" r="5" fill="#445566" stroke="#556677" strokeWidth="1">
        <animateTransform attributeName="transform" type="rotate" values="0 450 246;360 450 246" dur="2s" repeatCount="indefinite" />
      </circle>
      <circle r="2" fill="#556677"><animateMotion dur="4s" repeatCount="indefinite" path="M30,246 L470,246" /></circle>
      <circle r="2" fill="#556677"><animateMotion dur="4s" repeatCount="indefinite" path="M30,246 L470,246" begin="2s" /></circle>
      <g><animateMotion dur="6s" repeatCount="indefinite" path="M0,0 L80,0" />
        <circle cx="55" cy="208" r="8" fill="none" stroke="#aabbcc" strokeWidth="2" />
        <line x1="55" y1="216" x2="55" y2="232" stroke="#aabbcc" strokeWidth="2" />
        <line x1="55" y1="222" x2="45" y2="228" stroke="#aabbcc" strokeWidth="2" />
        <line x1="55" y1="222" x2="65" y2="228" stroke="#aabbcc" strokeWidth="2" />
        <line x1="55" y1="232" x2="48" y2="242" stroke="#aabbcc" strokeWidth="2" />
        <line x1="55" y1="232" x2="62" y2="242" stroke="#aabbcc" strokeWidth="2" />
        <text x="67" y="206" fill="#ffaa44" fontSize="14" fontWeight="bold">?</text>
      </g>
      <g><animateMotion dur="6s" repeatCount="indefinite" path="M0,0 L80,0" begin="3s" />
        <circle cx="100" cy="208" r="8" fill="none" stroke="#ccbbaa" strokeWidth="2" />
        <line x1="100" y1="216" x2="100" y2="232" stroke="#ccbbaa" strokeWidth="2" />
        <line x1="100" y1="222" x2="90" y2="228" stroke="#ccbbaa" strokeWidth="2" />
        <line x1="100" y1="222" x2="110" y2="228" stroke="#ccbbaa" strokeWidth="2" />
        <line x1="100" y1="232" x2="93" y2="242" stroke="#ccbbaa" strokeWidth="2" />
        <line x1="100" y1="232" x2="107" y2="242" stroke="#ccbbaa" strokeWidth="2" />
        <text x="112" y="206" fill="#ff6644" fontSize="14" fontWeight="bold">!</text>
      </g>
      <rect x="175" y="120" width="150" height="128" fill="url(#pm-machine)" rx="6" stroke="#7788aa" strokeWidth="1.5" />
      <polygon points="210,120 290,120 270,95 230,95" fill="#667788" stroke="#7788aa" strokeWidth="1" />
      <text x="250" y="113" textAnchor="middle" fill="#aabbcc" fontSize="7" fontFamily="monospace">INPUT</text>
      <rect x="195" y="140" width="110" height="22" fill="#334455" rx="3" />
      <text x="250" y="155" textAnchor="middle" fill="#44aaff" fontSize="9" fontFamily="monospace" fontWeight="bold">USER-O-MATIC 3000</text>
      <circle cx="215" cy="180" r="14" fill="none" stroke="#88aacc" strokeWidth="2" strokeDasharray="4 3">
        <animateTransform attributeName="transform" type="rotate" values="0 215 180;360 215 180" dur="3s" repeatCount="indefinite" />
      </circle>
      <circle cx="285" cy="180" r="14" fill="none" stroke="#88aacc" strokeWidth="2" strokeDasharray="4 3">
        <animateTransform attributeName="transform" type="rotate" values="360 285 180;0 285 180" dur="3s" repeatCount="indefinite" />
      </circle>
      <circle cx="195" cy="210" r="4" fill="#44ff44"><animate attributeName="fill" values="#44ff44;#22aa22;#44ff44" dur="1.5s" repeatCount="indefinite" /></circle>
      <circle cx="207" cy="210" r="4" fill="#ffaa22" /><circle cx="219" cy="210" r="4" fill="#44aaff" />
      <rect x="290" y="220" width="40" height="12" fill="#556677" rx="2" />
      <text x="310" y="218" textAnchor="middle" fill="#aabbcc" fontSize="7" fontFamily="monospace">OUTPUT</text>
      <g>
        <circle cx="370" cy="208" r="8" fill="none" stroke="#66dd66" strokeWidth="2" />
        <line x1="370" y1="216" x2="370" y2="232" stroke="#66dd66" strokeWidth="2" />
        <line x1="370" y1="222" x2="360" y2="228" stroke="#66dd66" strokeWidth="2" />
        <line x1="370" y1="222" x2="380" y2="228" stroke="#66dd66" strokeWidth="2" />
        <line x1="370" y1="232" x2="364" y2="242" stroke="#66dd66" strokeWidth="2" />
        <line x1="370" y1="232" x2="376" y2="242" stroke="#66dd66" strokeWidth="2" />
        <rect x="358" y="216" width="24" height="8" fill="#ff4444" rx="2" opacity="0.9" />
        <text x="370" y="223" textAnchor="middle" fill="white" fontSize="5" fontFamily="monospace">ADMIN</text>
        <text x="382" y="208" fill="#44ff44" fontSize="10">&#10003;</text>
      </g>
      <g>
        <circle cx="420" cy="208" r="8" fill="none" stroke="#66bbdd" strokeWidth="2" />
        <line x1="420" y1="216" x2="420" y2="232" stroke="#66bbdd" strokeWidth="2" />
        <line x1="420" y1="222" x2="410" y2="228" stroke="#66bbdd" strokeWidth="2" />
        <line x1="420" y1="222" x2="430" y2="228" stroke="#66bbdd" strokeWidth="2" />
        <line x1="420" y1="232" x2="414" y2="242" stroke="#66bbdd" strokeWidth="2" />
        <line x1="420" y1="232" x2="426" y2="242" stroke="#66bbdd" strokeWidth="2" />
        <rect x="410" y="216" width="20" height="8" fill="#4488ff" rx="2" opacity="0.9" />
        <text x="420" y="223" textAnchor="middle" fill="white" fontSize="5" fontFamily="monospace">OPS</text>
      </g>
      <text x="250" y="282" textAnchor="middle" fill="#8899aa" fontSize="11" fontFamily="monospace">The People Processing Machine</text>
      <text x="250" y="298" textAnchor="middle" fill="#556677" fontSize="9" fontFamily="monospace">unsorted humans in &#8594; authorized users out</text>
      <text x="250" y="310" textAnchor="middle" fill="#445566" fontSize="7" fontFamily="monospace">(no humans were harmed in the making of this feature)</text>
    </svg>
  );
}

/* ────────────────────── Application Tab ────────────────────── */
function ApplicationTab({ onSwitchToServices }: { onSwitchToServices: () => void }) {
  const { data, loading, error, refetch } = useApi(config.getApp);
  const { theme: appTheme, setTheme } = useAppTheme();
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  if (loading) return <Center h={300}><Loader size="xl" /></Center>;
  if (error) return <Alert color="red" title="Error">{error}</Alert>;

  const settingsMeta: Record<string, { label: string; description: string; editable: boolean; type?: string }> = {
    app_name:            { label: 'Application Name',    description: 'Display name shown in the header and login page', editable: true },
    puppet_server_host:  { label: 'PuppetServer Host',   description: 'FQDN of the PuppetServer for API communication', editable: true },
    puppet_server_port:  { label: 'PuppetServer Port',   description: 'PuppetServer HTTPS API port (usually 8140)', editable: true, type: 'number' },
    puppetdb_host:       { label: 'PuppetDB Host',       description: 'FQDN of the PuppetDB server', editable: true },
    puppetdb_port:       { label: 'PuppetDB Port',       description: 'PuppetDB HTTPS API port (usually 8081)', editable: true, type: 'number' },
    debug:               { label: 'Debug Mode',          description: 'Enable verbose debug logging (restart required)', editable: true, type: 'boolean' },
  };

  const entries = data ? Object.entries(data).filter(([key]) => key !== 'auth_backend') : [];

  const handleEdit = (key: string, currentValue: any) => {
    setEditing((prev) => ({ ...prev, [key]: String(currentValue) }));
  };
  const handleCancel = (key: string) => {
    setEditing((prev) => { const next = { ...prev }; delete next[key]; return next; });
  };
  const handleSave = async (key: string) => {
    setSaving(key);
    try {
      await config.updateApp(key, editing[key]);
      notifications.show({ title: 'Setting Updated', message: `${settingsMeta[key]?.label || key} updated. Go to the Services tab to restart.`, color: 'green' });
      handleCancel(key);
      refetch();
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    } finally { setSaving(null); }
  };

  return (
    <Stack>
      <Card withBorder shadow="sm">
        <Group justify="space-between" align="center">
          <div>
            <Text fw={700} mb={4}>Application Theme</Text>
            <Text size="sm" c="dimmed">
              Choose the visual style. <Text span fw={500}>Casual</Text> features dark mode with animated illustrations. <Text span fw={500}>Formal</Text> is a clean, light business theme.
            </Text>
          </div>
          <SegmentedControl value={appTheme} onChange={(v) => setTheme(v as any)}
            data={[{ label: 'Casual', value: 'casual' }, { label: 'Formal', value: 'formal' }]} size="md" />
        </Group>
      </Card>
      <Card withBorder shadow="sm">
        <Text fw={700} mb="sm">Application Settings</Text>
        <Text size="xs" c="dimmed" mb="md">Changes are written to the .env configuration file. Some changes require a <Text span size="xs" c="blue" style={{ cursor: 'pointer' }} td="underline" onClick={onSwitchToServices}>service restart</Text> to take effect.</Text>
        <Table striped>
          <Table.Thead><Table.Tr><Table.Th style={{ width: 220 }}>Setting</Table.Th><Table.Th>Value</Table.Th><Table.Th style={{ width: 100, textAlign: 'right' }}>Actions</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>
            {entries.map(([key, value]: [string, any]) => {
              const meta = settingsMeta[key];
              const isEditing = key in editing;
              return (
                <Table.Tr key={key}>
                  <Table.Td><Text size="sm" fw={500}>{meta?.label || key}</Text>{meta?.description && <Text size="xs" c="dimmed">{meta.description}</Text>}</Table.Td>
                  <Table.Td>
                    {isEditing ? (
                      meta?.type === 'boolean' ? (
                        <Select data={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} value={editing[key]}
                          onChange={(v) => setEditing((prev) => ({ ...prev, [key]: v || 'false' }))} size="xs" style={{ maxWidth: 120 }} />
                      ) : (
                        <TextInput value={editing[key]} onChange={(e) => setEditing((prev) => ({ ...prev, [key]: e.currentTarget.value }))}
                          size="xs" style={{ maxWidth: 300 }} type={meta?.type === 'number' ? 'number' : 'text'} />
                      )
                    ) : typeof value === 'boolean' ? (
                      <Badge color={value ? 'green' : 'gray'}>{value ? 'Yes' : 'No'}</Badge>
                    ) : (<Code>{String(value)}</Code>)}
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    {meta?.editable && (isEditing ? (
                      <Group gap={4} justify="flex-end">
                        <ActionIcon size="sm" variant="subtle" color="gray" onClick={() => handleCancel(key)}><IconX size={14} /></ActionIcon>
                        <ActionIcon size="sm" variant="filled" color="green" onClick={() => handleSave(key)} loading={saving === key}><IconDeviceFloppy size={14} /></ActionIcon>
                      </Group>
                    ) : (<ActionIcon size="sm" variant="subtle" onClick={() => handleEdit(key, value)}><IconEdit size={14} /></ActionIcon>))}
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Card>
    </Stack>
  );
}

/* ────────────────────── Services Tab ────────────────────── */
function ServicesTab() {
  const { data: services, loading, refetch } = useApi(config.getServices);
  const [restarting, setRestarting] = useState<string | null>(null);

  const handleRestart = async (service: string) => {
    setRestarting(service);
    try {
      await config.restartService(service);
      notifications.show({ title: 'Restarting', message: `${service} restart initiated`, color: 'blue' });
      // Wait for service to come back up, then refresh
      setTimeout(() => { refetch(); setRestarting(null); }, 4000);
    } catch (e: any) {
      notifications.show({ title: 'Error', message: e.message, color: 'red' });
      setRestarting(null);
    }
  };

  if (loading) return <Center h={300}><Loader size="xl" /></Center>;

  // Group services by category
  const puppetServices = (services || []).filter((s: any) => ['puppetserver', 'puppetdb', 'puppet'].includes(s.service));
  const appServices = (services || []).filter((s: any) => s.service === 'openvox-gui');

  return (
    <Stack>
      <Alert variant="light" color="blue">
        Manage all services in the OpenVox ecosystem. Restart individual services or the entire Puppet stack in the correct dependency order.
      </Alert>

      {/* Puppet Infrastructure Services */}
      <Card withBorder shadow="sm" padding="md">
        <Text fw={700} mb="sm">Puppet Infrastructure</Text>
        <Stack gap="xs">
          {puppetServices.map((svc: any) => (
            <Card key={svc.service} withBorder padding="sm">
              <Group justify="space-between" wrap="nowrap">
                <div>
                  <Text fw={600} size="sm">{svc.service}</Text>
                  <Group gap="xs" mt={4}>
                    <StatusBadge status={svc.status} />
                    {svc.pid && svc.pid !== '0' && <Text size="xs" c="dimmed">PID {svc.pid}</Text>}
                    {svc.since && <Text size="xs" c="dimmed">since {svc.since}</Text>}
                  </Group>
                </div>
                <Button variant="outline" color="orange" size="xs" leftSection={<IconRefresh size={14} />}
                  loading={restarting === svc.service} onClick={() => handleRestart(svc.service)}>
                  Restart
                </Button>
              </Group>
            </Card>
          ))}
        </Stack>
      </Card>

      {/* Application Service */}
      <Card withBorder shadow="sm" padding="md">
        <Text fw={700} mb="sm">Application</Text>
        <Stack gap="xs">
          {appServices.map((svc: any) => (
            <Card key={svc.service} withBorder padding="sm">
              <Group justify="space-between" wrap="nowrap">
                <div>
                  <Text fw={600} size="sm">{svc.service}</Text>
                  <Group gap="xs" mt={4}>
                    <StatusBadge status={svc.status} />
                    {svc.pid && svc.pid !== '0' && <Text size="xs" c="dimmed">PID {svc.pid}</Text>}
                    {svc.since && <Text size="xs" c="dimmed">since {svc.since}</Text>}
                  </Group>
                </div>
                <Button variant="outline" color="orange" size="xs" leftSection={<IconRefresh size={14} />}
                  loading={restarting === svc.service} onClick={() => handleRestart(svc.service)}>
                  Restart
                </Button>
              </Group>
            </Card>
          ))}
        </Stack>
        <Text size="xs" c="dimmed" mt="sm">
          Restarting the OpenVox GUI service will apply any pending configuration changes. The page will briefly disconnect and reconnect automatically.
        </Text>
      </Card>
    </Stack>
  );
}

/* ────────────────────── LDAP Configuration Panel ────────────────────── */
function LdapConfigPanel() {
  const [ldapConfig, setLdapConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Form state
  const [form, setForm] = useState({
    enabled: false,
    server_url: 'ldap://localhost:389',
    use_ssl: false,
    use_starttls: false,
    ssl_verify: true,
    ssl_ca_cert: '',
    connection_timeout: 10,
    bind_dn: '',
    bind_password: '',
    user_base_dn: 'dc=example,dc=com',
    user_search_filter: '(uid={username})',
    user_attr_username: 'uid',
    user_attr_email: 'mail',
    user_attr_display_name: 'cn',
    group_base_dn: '',
    group_search_filter: '(objectClass=groupOfNames)',
    group_member_attr: 'member',
    group_attr_name: 'cn',
    admin_group: '',
    operator_group: '',
    viewer_group: '',
    default_role: 'viewer',
    ad_domain: '',
    use_ad_upn: false,
  });

  useEffect(() => {
    ldap.getConfig().then((data: any) => {
      if (data.configured) {
        setForm((prev) => ({
          ...prev,
          ...data,
          bind_password: '',  // Never pre-fill password
          ssl_ca_cert: data.ssl_ca_cert || '',
          bind_dn: data.bind_dn || '',
          group_base_dn: data.group_base_dn || '',
          group_search_filter: data.group_search_filter || '(objectClass=groupOfNames)',
          admin_group: data.admin_group || '',
          operator_group: data.operator_group || '',
          viewer_group: data.viewer_group || '',
          ad_domain: data.ad_domain || '',
        }));
        setLdapConfig(data);
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const updateField = (field: string, value: any) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = { ...form };
      // Don't send empty password if user hasn't changed it
      if (!payload.bind_password && ldapConfig?.bind_password_set) {
        delete (payload as any).bind_password;
      }
      await ldap.saveConfig(payload);
      notifications.show({ title: 'LDAP Configuration Saved', message: form.enabled ? 'LDAP authentication is now enabled.' : 'LDAP configuration saved (currently disabled).', color: 'green' });
      // Reload config
      const updated = await ldap.getConfig();
      setLdapConfig(updated);
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    } finally { setSaving(false); }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await ldap.testConnection({
        server_url: form.server_url,
        use_ssl: form.use_ssl,
        use_starttls: form.use_starttls,
        ssl_verify: form.ssl_verify,
        ssl_ca_cert: form.ssl_ca_cert || null,
        connection_timeout: form.connection_timeout,
        bind_dn: form.bind_dn || null,
        bind_password: form.bind_password || null,
        user_base_dn: form.user_base_dn || null,
        group_base_dn: form.group_base_dn || null,
      });
      setTestResult(result);
      if (result.success) {
        notifications.show({ title: 'Connection Successful', message: result.message, color: 'green' });
      } else {
        notifications.show({ title: 'Connection Failed', message: result.message, color: 'red' });
      }
    } catch (err: any) {
      setTestResult({ success: false, message: err.message });
      notifications.show({ title: 'Test Failed', message: err.message, color: 'red' });
    } finally { setTesting(false); }
  };

  const applyPreset = (preset: string) => {
    switch (preset) {
      case 'openldap':
        updateField('user_search_filter', '(uid={username})');
        updateField('user_attr_username', 'uid');
        updateField('group_search_filter', '(objectClass=groupOfNames)');
        updateField('group_member_attr', 'member');
        updateField('use_ad_upn', false);
        break;
      case '389ds':
        updateField('user_search_filter', '(uid={username})');
        updateField('user_attr_username', 'uid');
        updateField('group_search_filter', '(objectClass=groupOfUniqueNames)');
        updateField('group_member_attr', 'uniqueMember');
        updateField('use_ad_upn', false);
        break;
      case 'ad':
        updateField('user_search_filter', '(sAMAccountName={username})');
        updateField('user_attr_username', 'sAMAccountName');
        updateField('user_attr_display_name', 'displayName');
        updateField('group_search_filter', '(objectClass=group)');
        updateField('group_member_attr', 'member');
        updateField('use_ad_upn', true);
        break;
    }
    notifications.show({ title: 'Preset Applied', message: `${preset === 'ad' ? 'Active Directory' : preset === '389ds' ? '389 Directory Server / Red Hat DS' : 'OpenLDAP'} defaults applied. Review and adjust as needed.`, color: 'blue' });
  };

  if (loading) return <Center h={200}><Loader size="lg" /></Center>;

  return (
    <Card withBorder shadow="sm" padding="lg">
      <Group justify="space-between" mb="md">
        <Group gap="sm">
          <IconPlugConnected size={22} />
          <Title order={4}>LDAP / Active Directory</Title>
        </Group>
        <Switch
          label={form.enabled ? 'Enabled' : 'Disabled'}
          checked={form.enabled}
          onChange={(e) => updateField('enabled', e.currentTarget.checked)}
          size="md"
          color="green"
        />
      </Group>

      <Text size="sm" c="dimmed" mb="md">
        Configure LDAP authentication to allow users to sign in with their corporate credentials.
        Usernames and passwords are validated against LDAP, while roles (Admin, Operator, Viewer) are managed locally.
        Local accounts (for service accounts etc.) continue to work alongside LDAP.
      </Text>

      {/* Directory Type Presets */}
      <Group mb="md">
        <Text size="sm" fw={500}>Quick Presets:</Text>
        <Button variant="light" size="xs" onClick={() => applyPreset('openldap')}>OpenLDAP</Button>
        <Button variant="light" size="xs" onClick={() => applyPreset('389ds')}>389 DS / Red Hat DS</Button>
        <Button variant="light" size="xs" onClick={() => applyPreset('ad')}>Active Directory</Button>
      </Group>

      <Divider mb="md" label="Connection" labelPosition="left" />

      <Grid>
        <Grid.Col span={{ base: 12, md: 8 }}>
          <TextInput
            label="Server URL"
            description="LDAP server address. Use ldaps:// for SSL."
            placeholder="ldap://ldap.example.com:389"
            value={form.server_url}
            onChange={(e) => updateField('server_url', e.currentTarget.value)}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 4 }}>
          <TextInput
            label="Timeout (seconds)"
            type="number"
            value={form.connection_timeout}
            onChange={(e) => updateField('connection_timeout', parseInt(e.currentTarget.value) || 10)}
          />
        </Grid.Col>
      </Grid>

      <Group mt="sm" gap="xl">
        <Switch label="Use SSL (LDAPS)" checked={form.use_ssl} onChange={(e) => updateField('use_ssl', e.currentTarget.checked)} />
        <Switch label="Use STARTTLS" checked={form.use_starttls} onChange={(e) => updateField('use_starttls', e.currentTarget.checked)} />
        <Switch label="Verify SSL Certificate" checked={form.ssl_verify} onChange={(e) => updateField('ssl_verify', e.currentTarget.checked)} />
      </Group>

      <Collapse in={form.use_ssl || form.use_starttls}>
        <TextInput mt="sm" label="CA Certificate Path" description="Path to CA certificate file for SSL verification (optional)"
          placeholder="/etc/ssl/certs/ldap-ca.pem" value={form.ssl_ca_cert}
          onChange={(e) => updateField('ssl_ca_cert', e.currentTarget.value)} />
      </Collapse>

      <Divider my="md" label="Bind Credentials" labelPosition="left" />
      <Text size="xs" c="dimmed" mb="sm">Service account used to search for users in LDAP. For Active Directory with UPN mode, this is optional.</Text>
      <Grid>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <TextInput label="Bind DN" placeholder="cn=admin,dc=example,dc=com" value={form.bind_dn}
            onChange={(e) => updateField('bind_dn', e.currentTarget.value)} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <PasswordInput label="Bind Password" placeholder={ldapConfig?.bind_password_set ? '(password set — leave blank to keep)' : 'Enter bind password'}
            value={form.bind_password} onChange={(e) => updateField('bind_password', e.currentTarget.value)} />
        </Grid.Col>
      </Grid>

      <Divider my="md" label="User Search" labelPosition="left" />
      <Grid>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <TextInput label="User Base DN" description="Where to search for user accounts" placeholder="ou=people,dc=example,dc=com"
            value={form.user_base_dn} onChange={(e) => updateField('user_base_dn', e.currentTarget.value)} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <TextInput label="User Search Filter" description="Use {username} as placeholder" placeholder="(uid={username})"
            value={form.user_search_filter} onChange={(e) => updateField('user_search_filter', e.currentTarget.value)} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 4 }}>
          <TextInput label="Username Attribute" placeholder="uid" value={form.user_attr_username}
            onChange={(e) => updateField('user_attr_username', e.currentTarget.value)} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 4 }}>
          <TextInput label="Email Attribute" placeholder="mail" value={form.user_attr_email}
            onChange={(e) => updateField('user_attr_email', e.currentTarget.value)} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 4 }}>
          <TextInput label="Display Name Attribute" placeholder="cn" value={form.user_attr_display_name}
            onChange={(e) => updateField('user_attr_display_name', e.currentTarget.value)} />
        </Grid.Col>
      </Grid>

      <Divider my="md" label="Group Mapping → Local Roles" labelPosition="left" />
      <Text size="xs" c="dimmed" mb="sm">
        Map LDAP groups to local OpenVox GUI roles. When a new user authenticates via LDAP, their initial role is determined by group membership.
        Administrators can always override roles locally after the user is provisioned.
      </Text>
      <Grid>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <TextInput label="Group Base DN" description="Where to search for groups" placeholder="ou=groups,dc=example,dc=com"
            value={form.group_base_dn} onChange={(e) => updateField('group_base_dn', e.currentTarget.value)} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <TextInput label="Group Search Filter" placeholder="(objectClass=groupOfNames)"
            value={form.group_search_filter} onChange={(e) => updateField('group_search_filter', e.currentTarget.value)} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <TextInput label="Group Member Attribute" placeholder="member" value={form.group_member_attr}
            onChange={(e) => updateField('group_member_attr', e.currentTarget.value)} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <TextInput label="Group Name Attribute" placeholder="cn" value={form.group_attr_name}
            onChange={(e) => updateField('group_attr_name', e.currentTarget.value)} />
        </Grid.Col>
      </Grid>

      <Grid mt="sm">
        <Grid.Col span={{ base: 12, md: 4 }}>
          <TextInput label="Admin Group" description="LDAP group → Admin role" placeholder="openvox-admins"
            value={form.admin_group} onChange={(e) => updateField('admin_group', e.currentTarget.value)}
            leftSection={<Badge size="xs" color="red" variant="filled">A</Badge>} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 4 }}>
          <TextInput label="Operator Group" description="LDAP group → Operator role" placeholder="openvox-operators"
            value={form.operator_group} onChange={(e) => updateField('operator_group', e.currentTarget.value)}
            leftSection={<Badge size="xs" color="blue" variant="filled">O</Badge>} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 4 }}>
          <TextInput label="Viewer Group" description="LDAP group → Viewer role" placeholder="openvox-viewers"
            value={form.viewer_group} onChange={(e) => updateField('viewer_group', e.currentTarget.value)}
            leftSection={<Badge size="xs" color="gray" variant="filled">V</Badge>} />
        </Grid.Col>
      </Grid>

      <Select mt="sm" label="Default Role" description="Role assigned when user doesn't match any LDAP group"
        data={[
          { value: 'admin', label: 'Admin' },
          { value: 'operator', label: 'Operator' },
          { value: 'viewer', label: 'Viewer' },
        ]} value={form.default_role} onChange={(v) => updateField('default_role', v || 'viewer')} style={{ maxWidth: 200 }} />

      <Divider my="md" label="Active Directory Settings" labelPosition="left" />
      <Group gap="xl">
        <Switch label="Use AD User Principal Name (UPN) for bind" checked={form.use_ad_upn}
          onChange={(e) => updateField('use_ad_upn', e.currentTarget.checked)} />
      </Group>
      <Collapse in={form.use_ad_upn}>
        <TextInput mt="sm" label="AD Domain" description="Domain for UPN bind (username@domain)" placeholder="corp.example.com"
          value={form.ad_domain} onChange={(e) => updateField('ad_domain', e.currentTarget.value)} style={{ maxWidth: 400 }} />
      </Collapse>

      {/* Test Result */}
      {testResult && (
        <Alert mt="md" color={testResult.success ? 'green' : 'red'} title={testResult.success ? 'Connection Successful' : 'Connection Failed'} withCloseButton onClose={() => setTestResult(null)}>
          <Text size="sm">{testResult.message}</Text>
          {testResult.user_base_dn_valid === false && <Text size="xs" c="orange" mt="xs">⚠ {testResult.user_base_dn_warning}</Text>}
          {testResult.group_base_dn_valid === false && <Text size="xs" c="orange" mt="xs">⚠ {testResult.group_base_dn_warning}</Text>}
          {testResult.user_base_dn_valid === true && <Text size="xs" c="green" mt="xs">✓ User Base DN is valid</Text>}
          {testResult.group_base_dn_valid === true && <Text size="xs" c="green" mt="xs">✓ Group Base DN is valid</Text>}
        </Alert>
      )}

      <Divider my="md" />

      <Group justify="space-between">
        <Button variant="outline" leftSection={<IconTestPipe size={16} />} onClick={handleTest} loading={testing}
          disabled={!form.server_url}>
          Test Connection
        </Button>
        <Button leftSection={<IconDeviceFloppy size={16} />} onClick={handleSave} loading={saving}>
          Save LDAP Configuration
        </Button>
      </Group>
    </Card>
  );
}

/* ────────────────────── Auth Settings Tab ────────────────────── */
function AuthSettingsTab() {
  const { data: appData } = useApi(config.getApp);

  return (
    <Stack>
      {/* Authentication Source Summary */}
      <Card withBorder shadow="sm">
        <Text fw={700} mb="sm">Authentication</Text>
        <Group>
          <Text size="sm" c="dimmed">Backend:</Text>
          <Badge color={appData?.auth_backend === 'none' ? 'yellow' : 'green'} size="lg">{appData?.auth_backend || 'none'}</Badge>
        </Group>
        <Text size="xs" c="dimmed" mt="sm">
          Each user can authenticate via LDAP (corporate credentials) or local accounts (service accounts, break-glass).
          The authentication source is selectable per user. Roles are always managed locally.
        </Text>
      </Card>

      {/* LDAP Configuration */}
      <LdapConfigPanel />
    </Stack>
  );
}

/* ────────────────────── User Manager Tab ────────────────────── */
function UserManagerTab() {
  const { user: currentUser } = useAuth();
  const { isFormal } = useAppTheme();
  const [userList, setUserList] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<string>('viewer');
  const [newAuthSource, setNewAuthSource] = useState<string>('ldap');
  const [addLoading, setAddLoading] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [pwUser, setPwUser] = useState('');
  const [pwValue, setPwValue] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  const [roleOpen, setRoleOpen] = useState(false);
  const [roleUser, setRoleUser] = useState('');
  const [roleValue, setRoleValue] = useState<string>('viewer');
  const [roleLoading, setRoleLoading] = useState(false);
  const [authSrcOpen, setAuthSrcOpen] = useState(false);
  const [authSrcUser, setAuthSrcUser] = useState('');
  const [authSrcValue, setAuthSrcValue] = useState<string>('ldap');
  const [authSrcLoading, setAuthSrcLoading] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await users.list();
      setUserList(Array.isArray(data) ? data : []);
    } catch (err: any) { setError(err.message || 'Failed to load users'); }
    finally { setLoading(false); }
  }, []);

  useState(() => { loadUsers(); });

  const handleAddUser = async () => {
    if (!newUsername) return;
    if (newAuthSource === 'local' && !newPassword) return;
    setAddLoading(true);
    try {
      await users.create({ username: newUsername, password: newPassword, role: newRole, auth_source: newAuthSource });
      notifications.show({ title: 'User Created', message: `User '${newUsername}' created (${newAuthSource}, role: ${newRole})`, color: 'green' });
      setNewUsername(''); setNewPassword(''); setNewRole('viewer'); setNewAuthSource('ldap'); loadUsers();
    } catch (err: any) { notifications.show({ title: 'Error', message: err.message, color: 'red' }); }
    finally { setAddLoading(false); }
  };

  const handleDeleteUser = async (username: string) => {
    if (!confirm(`Delete user '${username}'? This cannot be undone.`)) return;
    try {
      await users.remove(username);
      notifications.show({ title: 'User Deleted', message: `User '${username}' removed`, color: 'green' }); loadUsers();
    } catch (err: any) { notifications.show({ title: 'Error', message: err.message, color: 'red' }); }
  };

  const handleChangePassword = async () => {
    if (!pwValue) return;
    setPwLoading(true);
    try {
      await users.changePassword(pwUser, pwValue);
      notifications.show({ title: 'Password Changed', message: `Password updated for '${pwUser}'`, color: 'green' });
      setPwOpen(false); setPwValue('');
    } catch (err: any) { notifications.show({ title: 'Error', message: err.message, color: 'red' }); }
    finally { setPwLoading(false); }
  };

  const handleChangeRole = async () => {
    setRoleLoading(true);
    try {
      await users.changeRole(roleUser, roleValue);
      notifications.show({ title: 'Role Changed', message: `Role updated to '${roleValue}' for '${roleUser}'`, color: 'green' });
      setRoleOpen(false); loadUsers();
    } catch (err: any) { notifications.show({ title: 'Error', message: err.message, color: 'red' }); }
    finally { setRoleLoading(false); }
  };

  const handleChangeAuthSource = async () => {
    setAuthSrcLoading(true);
    try {
      await users.changeAuthSource(authSrcUser, authSrcValue);
      notifications.show({ title: 'Auth Source Changed', message: `'${authSrcUser}' now authenticates via ${authSrcValue.toUpperCase()}`, color: 'green' });
      setAuthSrcOpen(false); loadUsers();
    } catch (err: any) { notifications.show({ title: 'Error', message: err.message, color: 'red' }); }
    finally { setAuthSrcLoading(false); }
  };

  if (loading) return <Center h={300}><Loader size="xl" /></Center>;
  if (error) return <Alert color="red" title="Error">{error}</Alert>;

  return (
    <Stack>
      {/* Add User */}
      <Grid align="flex-start">
        {!isFormal && (
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Card withBorder shadow="sm" padding="sm" style={{ overflow: 'hidden' }}><PeopleProcessingMachine /></Card>
          </Grid.Col>
        )}
        <Grid.Col span={{ base: 12, md: isFormal ? 12 : 6 }}>
          <Card withBorder shadow="sm" padding="lg">
            <Group gap="sm" mb="md">
              <IconPlus size={18} />
              <Title order={4}>Add User</Title>
            </Group>
            <Text size="xs" c="dimmed" mb="sm">
              Create a new user. LDAP users authenticate with their directory credentials. Local users use a password stored in this application.
            </Text>
            <Stack gap="sm">
              <TextInput label="Username" placeholder="Enter username" value={newUsername} onChange={(e) => setNewUsername(e.currentTarget.value)} />
              <Select label="Authentication Source" description="LDAP users authenticate with corporate credentials. Local users use a stored password."
                data={[
                  { value: 'ldap', label: 'LDAP / Active Directory' },
                  { value: 'local', label: 'Local' },
                ]} value={newAuthSource} onChange={(v) => { setNewAuthSource(v || 'ldap'); if (v === 'ldap') setNewPassword(''); }} />
              <Collapse in={newAuthSource === 'local'}>
                <PasswordInput label="Password" placeholder="Enter password" value={newPassword} onChange={(e) => setNewPassword(e.currentTarget.value)} />
              </Collapse>
              <Select label="Role" data={[
                { value: 'admin', label: 'Admin \u2014 Full access' },
                { value: 'operator', label: 'Operator \u2014 Deploy & manage' },
                { value: 'viewer', label: 'Viewer \u2014 Read only' },
              ]} value={newRole} onChange={(v) => setNewRole(v || 'viewer')} />
              <Button leftSection={<IconPlus size={16} />} onClick={handleAddUser} loading={addLoading}
                disabled={!newUsername || (newAuthSource === 'local' && !newPassword)}>Create User</Button>
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>

      {/* User Table */}
      <Card withBorder shadow="sm">
        <Text fw={700} mb="sm">All Users</Text>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Username</Table.Th>
              <Table.Th>Role</Table.Th>
              <Table.Th>Source</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {userList.map((u) => (
              <Table.Tr key={u.username}>
                <Table.Td><Text fw={500}>{u.username}</Text></Table.Td>
                <Table.Td><Badge color={roleBadgeColor[u.role] || 'gray'} variant="light">{u.role}</Badge></Table.Td>
                <Table.Td>
                  <Badge
                    color={authSourceColor[u.auth_source || 'local'] || 'gray'}
                    variant="outline"
                    size="sm"
                    leftSection={u.auth_source === 'ldap' ? <IconWorld size={10} /> : <IconLock size={10} />}
                  >
                    {u.auth_source || 'local'}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Group gap="xs" justify="flex-end">
                    {(u.auth_source || 'local') === 'local' && (
                      <Tooltip label="Change password">
                        <ActionIcon variant="subtle" color="blue" onClick={() => { setPwUser(u.username); setPwValue(''); setPwOpen(true); }}>
                          <IconKey size={16} />
                        </ActionIcon>
                      </Tooltip>
                    )}
                    <Tooltip label="Change auth source">
                      <ActionIcon variant="subtle" color="grape" onClick={() => { setAuthSrcUser(u.username); setAuthSrcValue(u.auth_source || 'local'); setAuthSrcOpen(true); }}>
                        <IconSwitchHorizontal size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Change role"><ActionIcon variant="subtle" color="orange" onClick={() => { setRoleUser(u.username); setRoleValue(u.role); setRoleOpen(true); }}><IconShield size={16} /></ActionIcon></Tooltip>
                    {u.username !== currentUser?.username && (<Tooltip label="Delete user"><ActionIcon variant="subtle" color="red" onClick={() => handleDeleteUser(u.username)}><IconTrash size={16} /></ActionIcon></Tooltip>)}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
            {userList.length === 0 && (<Table.Tr><Table.Td colSpan={4}><Text c="dimmed" ta="center" py="lg">No users found</Text></Table.Td></Table.Tr>)}
          </Table.Tbody>
        </Table>
      </Card>

      <Modal opened={pwOpen} onClose={() => setPwOpen(false)} title={`Change Password \u2014 ${pwUser}`} centered>
        <Stack>
          <PasswordInput label="New Password" placeholder="Enter new password" value={pwValue} onChange={(e) => setPwValue(e.currentTarget.value)} required />
          <Button onClick={handleChangePassword} loading={pwLoading} fullWidth>Update Password</Button>
        </Stack>
      </Modal>
      <Modal opened={roleOpen} onClose={() => setRoleOpen(false)} title={`Change Role \u2014 ${roleUser}`} centered>
        <Stack>
          <Select label="Role" data={[
            { value: 'admin', label: 'Admin \u2014 Full access' },
            { value: 'operator', label: 'Operator \u2014 Deploy & manage' },
            { value: 'viewer', label: 'Viewer \u2014 Read only' },
          ]} value={roleValue} onChange={(v) => setRoleValue(v || 'viewer')} />
          <Button onClick={handleChangeRole} loading={roleLoading} fullWidth>Update Role</Button>
        </Stack>
      </Modal>
      <Modal opened={authSrcOpen} onClose={() => setAuthSrcOpen(false)} title={`Change Auth Source \u2014 ${authSrcUser}`} centered>
        <Stack>
          <Select label="Authentication Source" description="LDAP: credentials validated against your directory server. Local: password stored in this application."
            data={[
              { value: 'ldap', label: 'LDAP / Active Directory' },
              { value: 'local', label: 'Local' },
            ]} value={authSrcValue} onChange={(v) => setAuthSrcValue(v || 'ldap')} />
          {authSrcValue === 'ldap' && (
            <Alert variant="light" color="blue" title="Note">
              Switching to LDAP will invalidate this user's local password. They will need to authenticate using their LDAP/AD credentials.
            </Alert>
          )}
          <Button onClick={handleChangeAuthSource} loading={authSrcLoading} fullWidth>Update Auth Source</Button>
        </Stack>
      </Modal>
    </Stack>
  );
}

/* ────────────────────── Main Page ────────────────────── */
export function ConfigAppPage() {
  const [activeTab, setActiveTab] = useState<string | null>('settings');

  return (
    <Stack>
      <Title order={2}>Settings</Title>
      <Tabs value={activeTab} onChange={setActiveTab} variant="outline">
        <Tabs.List>
          <Tabs.Tab value="settings" leftSection={<IconSettings size={16} />}>Application Settings</Tabs.Tab>
          <Tabs.Tab value="services" leftSection={<IconServer size={16} />}>Services</Tabs.Tab>
          <Tabs.Tab value="auth" leftSection={<IconPlugConnected size={16} />}>Auth Settings</Tabs.Tab>
          <Tabs.Tab value="users" leftSection={<IconUsers size={16} />}>User Manager</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="settings" pt="md"><ApplicationTab onSwitchToServices={() => setActiveTab('services')} /></Tabs.Panel>
        <Tabs.Panel value="services" pt="md"><ServicesTab /></Tabs.Panel>
        <Tabs.Panel value="auth" pt="md"><AuthSettingsTab /></Tabs.Panel>
        <Tabs.Panel value="users" pt="md"><UserManagerTab /></Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
