/**
 * OpenVox GUI - Certificates.tsx
 *
 * Infrastructure | Certificate Authority
 * - CA health / expiry summary
 * - Trusted Facts (certificate extension requests → $trusted['extensions'])
 * - Pending CSRs (sign / reject)
 * - Signed certificate list (revoke / clean / detail)
 */
import { useState, useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router';
import {
  Title, Card, Stack, Group, Text, Button, Alert, Loader, Center,
  Table, Badge, Code, Modal, ActionIcon, Tooltip, ScrollArea, Grid,
  ThemeIcon, TextInput, Switch, Select,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconCertificate, IconX, IconTrash, IconRefresh, IconInfoCircle, IconCheck,
  IconShield, IconClock, IconKey, IconFingerprint, IconCalendar,
  IconLock, IconSearch,
} from '@tabler/icons-react';
import { certificates } from '../services/api';
import { useAppTheme } from '../hooks/ThemeContext';
import { useAuth } from '../hooks/AuthContext';
import { ConfirmModal } from '../components/ConfirmModal';
import { LoadingState, ErrorState } from '../components/StateComponents';

/** Prefer these columns when present; remaining keys follow alphabetically. */
const PREFERRED_TRUSTED_COLUMNS = [
  'pp_role',
  'pp_environment',
  'pp_datacenter',
  'pp_zone',
  'pp_region',
  'pp_application',
  'pp_apptier',
  'pp_cluster',
  'pp_provisioner',
];

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
  const navigate = useNavigate();
  const { isRobots } = useAppTheme();
  const { user } = useAuth();
  // admin / operator / certops may revoke & clean agent certs; viewers are read-only
  const canMutateCerts = !!user && ['admin', 'operator', 'certops'].includes(user.role);
  const [data, setData] = useState<any>(null);
  const [caInfo, setCaInfo] = useState<any>(null);
  const [trustedFacts, setTrustedFacts] = useState<any>(null);
  const [trustedError, setTrustedError] = useState<string | null>(null);
  const [trustedLoading, setTrustedLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailData, setDetailData] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<null | { type: 'revoke' | 'clean' | 'sign' | 'reject'; certname: string }>(null);
  const [actionLoading, setActionLoading] = useState(false);
  // Client-side filters for the Trusted Facts pane (server already returns the fleet scan)
  const [tfSearch, setTfSearch] = useState('');
  const [tfKey, setTfKey] = useState<string | null>(null);
  const [tfShowAll, setTfShowAll] = useState(false);

  const loadTrustedFacts = useCallback(async () => {
    setTrustedLoading(true);
    setTrustedError(null);
    try {
      const tfData = await certificates.trustedFacts({
        only_with_extensions: !tfShowAll,
      });
      setTrustedFacts(tfData);
    } catch (e: any) {
      setTrustedError(e?.message || 'Failed to load trusted facts');
      setTrustedFacts(null);
    }
    setTrustedLoading(false);
  }, [tfShowAll]);

  const loadCore = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [certData, caData] = await Promise.all([
        certificates.list(),
        certificates.caInfo(),
      ]);
      setData(certData);
      setCaInfo(caData.ca_info || null);
      if (certData.error) setError(certData.error);
      else if (caData.error) setError(caData.error);
      else if (caData.ca_info?.source === 'local-cache') {
        setError('CA VIP unreachable; showing the last local copy of the issuing CA.');
      }
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  }, []);

  /** Full page refresh (CA list + info + trusted facts). */
  const load = useCallback(async () => {
    await Promise.all([loadCore(), loadTrustedFacts()]);
  }, [loadCore, loadTrustedFacts]);

  useEffect(() => { loadCore(); }, [loadCore]);
  // Re-fetch trusted facts when the show-all toggle changes (no full-page spinner)
  useEffect(() => { loadTrustedFacts(); }, [loadTrustedFacts]);

  const trustedColumns = useMemo(() => {
    const keys: string[] = trustedFacts?.extension_keys || [];
    const preferred = PREFERRED_TRUSTED_COLUMNS.filter((k) => keys.includes(k));
    const rest = keys.filter((k) => !PREFERRED_TRUSTED_COLUMNS.includes(k)).sort();
    return [...preferred, ...rest];
  }, [trustedFacts]);

  const filteredTrustedNodes = useMemo(() => {
    const nodes: any[] = trustedFacts?.nodes || [];
    const q = tfSearch.trim().toLowerCase();
    return nodes.filter((n) => {
      const cn = (n.certname || '').toLowerCase();
      const exts = n.extensions || {};
      if (tfKey && !(tfKey in exts)) return false;
      if (!q) return true;
      if (cn.includes(q)) return true;
      return Object.entries(exts).some(
        ([k, v]) => k.toLowerCase().includes(q) || String(v).toLowerCase().includes(q),
      );
    });
  }, [trustedFacts, tfSearch, tfKey]);

  const requestRevoke = (certname: string) => setPendingAction({ type: 'revoke', certname });
  const requestClean = (certname: string) => setPendingAction({ type: 'clean', certname });
  const requestSign = (certname: string) => setPendingAction({ type: 'sign', certname });
  const requestReject = (certname: string) => setPendingAction({ type: 'reject', certname });

  const executePendingAction = async () => {
    if (!pendingAction) return;
    const { type, certname } = pendingAction;
    setActionLoading(true);
    try {
      if (type === 'sign') {
        await certificates.sign(certname);
        notifications.show({ title: 'Signed', message: `Certificate signed for ${certname}`, color: 'green' });
      } else if (type === 'reject') {
        await certificates.reject(certname);
        notifications.show({ title: 'Rejected', message: `Certificate request for ${certname} rejected`, color: 'yellow' });
      } else if (type === 'revoke') {
        await certificates.revoke(certname);
        notifications.show({ title: 'Revoked', message: `Certificate revoked for ${certname}`, color: 'yellow' });
      } else {
        await certificates.clean(certname);
        notifications.show({ title: 'Cleaned', message: `Certificate removed for ${certname}`, color: 'green' });
      }
      setPendingAction(null);
      load();
    } catch (e: any) {
      notifications.show({ title: 'Error', message: e.message, color: 'red' });
    }
    setActionLoading(false);
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

  const protectedRoles = useMemo(() => {
    const map = new Map<string, string>();
    const identities: { name?: string; role?: string }[] = caInfo?.protected_identities || [];
    identities.forEach((i) => {
      if (i.name) map.set(i.name.toLowerCase(), (i.role || 'protected').toLowerCase());
    });
    (caInfo?.protected_certnames || []).forEach((n: string) => {
      if (n && !map.has(n.toLowerCase())) map.set(n.toLowerCase(), 'protected');
    });
    return map;
  }, [caInfo]);
  const isProtected = (certname: string) => protectedRoles.has((certname || '').toLowerCase());
  const protectedLabel = (certname: string) => {
    const role = protectedRoles.get((certname || '').toLowerCase()) || 'protected';
    if (role === 'ca') return 'CA';
    if (role === 'puppetdb') return 'OpenVoxDB';
    if (role === 'this-host') return 'this host';
    return role;
  };

  if (loading) return <LoadingState label="Loading certificates…" />;
  if (error && !data) return <ErrorState title="Failed to load certificates" message={error} onRetry={load} />;

  const signed = data?.signed || [];
  const requested = data?.requested || [];

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
        Manage the estate issuing CA: revoke compromised certs or clean removed
        nodes. The GUI talks to the CA VIP over HTTPS (not a local{' '}
        <Code>puppetserver ca</Code>). Infrastructure identities (CA, compiler,
        OpenVoxDB, console) cannot be revoked or cleaned from the GUI.
      </Alert>

      {/* CA Information Panel */}
      {caInfo && (
        <Card withBorder shadow="sm" padding="md">
          <Group mb="md">
            <ThemeIcon size="lg" variant="light" color="orange">
              <IconShield size={20} />
            </ThemeIcon>
            <div>
              <Title order={3}>Issuing Certificate Authority</Title>
              <Text size="sm" c="dimmed">
                {caInfo.ca_host
                  ? `Reached via ${caInfo.ca_host}`
                  : 'Issuing CA'}
                {caInfo.presented_by ? ` · presented by ${caInfo.presented_by}` : ''}
                {caInfo.source === 'ca-http' ? ' · live API' : ''}
                {caInfo.source === 'local-cache' ? ' · local cache (VIP unreachable)' : ''}
                {caInfo.source === 'local-file' ? ' · local file' : ''}
              </Text>
            </div>
          </Group>
          
          <Grid>
            <Grid.Col span={{ base: 12, md: 6 }}>
              <Stack gap="xs">
                <Group gap="xs">
                  <ThemeIcon size="sm" variant="subtle" color="gray">
                    <IconCertificate size={14} />
                  </ThemeIcon>
                  <Text size="sm" c="dimmed">Subject:</Text>
                  <Text size="sm" fw={500}>{caInfo.subject || 'N/A'}</Text>
                </Group>

                <Group gap="xs">
                  <ThemeIcon size="sm" variant="subtle" color="gray">
                    <IconCertificate size={14} />
                  </ThemeIcon>
                  <Text size="sm" c="dimmed">Issuer:</Text>
                  <Text size="sm">{caInfo.issuer || 'N/A'}</Text>
                </Group>
                
                <Group gap="xs">
                  <ThemeIcon size="sm" variant="subtle" color="gray">
                    <IconCalendar size={14} />
                  </ThemeIcon>
                  <Text size="sm" c="dimmed">Valid From:</Text>
                  <Text size="sm">{caInfo.not_before || 'N/A'}</Text>
                </Group>
                
                <Group gap="xs">
                  <ThemeIcon size="sm" variant="subtle" color="gray">
                    <IconClock size={14} />
                  </ThemeIcon>
                  <Text size="sm" c="dimmed">Valid Until:</Text>
                  <Badge 
                    color={caInfo.is_expired ? 'red' : caInfo.expires_soon ? 'yellow' : 'green'}
                    variant="light"
                  >
                    {caInfo.not_after || 'N/A'}
                  </Badge>
                </Group>
                
                {caInfo.days_until_expiry !== undefined && (
                  <Group gap="xs">
                    <Text size="sm" c="dimmed" ml={28}>Days Until Expiry:</Text>
                    <Badge 
                      color={caInfo.is_expired ? 'red' : caInfo.expires_soon ? 'yellow' : 'blue'}
                    >
                      {caInfo.is_expired ? 'EXPIRED' : `${caInfo.days_until_expiry} days`}
                    </Badge>
                  </Group>
                )}
                
                <Group gap="xs">
                  <ThemeIcon size="sm" variant="subtle" color="gray">
                    <IconKey size={14} />
                  </ThemeIcon>
                  <Text size="sm" c="dimmed">Key Algorithm:</Text>
                  <Text size="sm">{caInfo.key_algorithm || 'N/A'} 
                    {caInfo.key_size && ` (${caInfo.key_size} bit)`}
                  </Text>
                </Group>
              </Stack>
            </Grid.Col>
            
            <Grid.Col span={{ base: 12, md: 6 }}>
              <Stack gap="xs">
                <Group gap="xs">
                  <ThemeIcon size="sm" variant="subtle" color="gray">
                    <IconFingerprint size={14} />
                  </ThemeIcon>
                  <Text size="sm" c="dimmed">Serial Number:</Text>
                  <Code style={{ fontSize: 11 }}>{caInfo.serial_number || 'N/A'}</Code>
                </Group>
                
                <Group gap="xs">
                  <ThemeIcon size="sm" variant="subtle" color="gray">
                    <IconShield size={14} />
                  </ThemeIcon>
                  <Text size="sm" c="dimmed">Signature Algorithm:</Text>
                  <Text size="sm">{caInfo.signature_algorithm || 'N/A'}</Text>
                </Group>
                
                {caInfo.sha256_fingerprint && (
                  <Group gap="xs">
                    <ThemeIcon size="sm" variant="subtle" color="gray">
                      <IconFingerprint size={14} />
                    </ThemeIcon>
                    <Text size="sm" c="dimmed">SHA256 Fingerprint:</Text>
                  </Group>
                )}
                {caInfo.sha256_fingerprint && (
                  <Code style={{ fontSize: 10, marginLeft: 28 }}>{caInfo.sha256_fingerprint}</Code>
                )}
                
                <Group gap="xs" mt="sm">
                  <Text size="sm" fw={500}>Certificate Statistics:</Text>
                </Group>
                <Grid ml={28}>
                  <Grid.Col span={4}>
                    <Tooltip label="Total active signed certificates">
                      <Stack gap={0} align="center" style={{ cursor: 'help' }}>
                        <Text size="xl" fw={700} c="green">{caInfo.total_signed || 0}</Text>
                        <Text size="xs" c="dimmed">Active</Text>
                      </Stack>
                    </Tooltip>
                  </Grid.Col>
                  <Grid.Col span={4}>
                    <Tooltip label="Certificates waiting for approval">
                      <Stack gap={0} align="center" style={{ cursor: 'help' }}>
                        <Text size="xl" fw={700} c="yellow">{caInfo.total_pending || 0}</Text>
                        <Text size="xs" c="dimmed">Pending</Text>
                      </Stack>
                    </Tooltip>
                  </Grid.Col>
                  <Grid.Col span={4}>
                    <Tooltip label="Total certificates revoked (all-time)">
                      <Stack gap={0} align="center" style={{ cursor: 'help' }}>
                        <Text size="xl" fw={700} c="red">{caInfo.revoked_count || 0}</Text>
                        <Text size="xs" c="dimmed">Revoked</Text>
                      </Stack>
                    </Tooltip>
                  </Grid.Col>
                </Grid>
              </Stack>
            </Grid.Col>
          </Grid>
          
          {caInfo.expires_soon && !caInfo.is_expired && (
            <Alert color="yellow" mt="md" icon={<IconClock />}>
              <Text size="sm">CA certificate expires in {caInfo.days_until_expiry} days. Consider renewal planning.</Text>
            </Alert>
          )}
          
          {caInfo.is_expired && (
            <Alert color="red" mt="md" icon={<IconX />}>
              <Text size="sm">CA certificate has EXPIRED! Immediate action required.</Text>
            </Alert>
          )}
        </Card>
      )}

      {/* Trusted Facts — certificate extension requests (pp_role, etc.) */}
      <Card withBorder shadow="sm" padding="md" style={{ overflow: 'hidden' }}>
        <Group justify="space-between" mb="md" wrap="wrap">
          <Group>
            <ThemeIcon size="lg" variant="light" color="blue">
              <IconLock size={20} />
            </ThemeIcon>
            <div>
              <Title order={4}>Trusted Facts</Title>
              <Text size="xs" c="dimmed">
                Certificate extension requests baked into signed PEMs
                (catalog: <Code>$trusted['extensions']</Code>)
                {trustedFacts?.source === 'ca-http' ? ' · via CA HTTP API' : ''}
                {trustedFacts?.source === 'local-cadir' ? ' · local cadir (API miss)' : ''}
              </Text>
            </div>
          </Group>
          {trustedFacts && (
            <Group gap="xs">
              <Badge color="blue" variant="light">
                {trustedFacts.with_extensions ?? 0} with extensions
              </Badge>
              <Badge color="gray" variant="light">
                {trustedFacts.without_extensions ?? 0} without
              </Badge>
              <Badge color="gray" variant="outline">
                {trustedFacts.total_signed ?? 0} signed
              </Badge>
            </Group>
          )}
        </Group>

        {trustedLoading && !trustedFacts && (
          <Center py="md"><Loader size="sm" /></Center>
        )}

        {trustedError && (
          <Alert color="yellow" mb="md" title="Trusted facts unavailable">
            {trustedError}
          </Alert>
        )}

        {!trustedError && trustedFacts && (
          <>
            <Text size="sm" c="dimmed" mb="sm">
              These values come from agent <Code>csr_attributes.yaml</Code> extension
              requests (or installer <Code>extension_requests:…</Code> options) and are
              signed into the certificate — agents cannot change them after signing.
              CLI: <Code>ovox certs trusted-facts</Code>
            </Text>

            {/* Fleet summary of unique values per key */}
            {trustedFacts.summary && Object.keys(trustedFacts.summary).length > 0 && (
              <Stack gap="xs" mb="md">
                <Text size="sm" fw={500}>Fleet summary</Text>
                <Group gap="sm" align="flex-start">
                  {Object.entries(trustedFacts.summary as Record<string, Record<string, number>>)
                    .slice(0, 8)
                    .map(([k, counts]) => (
                      <Card key={k} withBorder padding="xs" radius="sm" style={{ minWidth: 140 }}>
                        <Text size="xs" c="dimmed" mb={4}>{k}</Text>
                        <Stack gap={2}>
                          {Object.entries(counts).slice(0, 5).map(([val, n]) => (
                            <Group key={val} gap={6} justify="space-between">
                              <Code style={{ fontSize: 11 }}>{val || '(empty)'}</Code>
                              <Badge size="xs" variant="light">{n}</Badge>
                            </Group>
                          ))}
                          {Object.keys(counts).length > 5 && (
                            <Text size="xs" c="dimmed">+{Object.keys(counts).length - 5} more</Text>
                          )}
                        </Stack>
                      </Card>
                    ))}
                </Group>
              </Stack>
            )}

            <Group mb="sm" wrap="wrap" align="flex-end">
              <TextInput
                aria-label="Filter by certname or value"
                placeholder="Filter by certname or value…"
                leftSection={<IconSearch size={14} />}
                value={tfSearch}
                onChange={(e) => setTfSearch(e.currentTarget.value)}
                style={{ minWidth: 240, flex: 1 }}
                size="sm"
              />
              <Select
                aria-label="Extension key"
                placeholder="Extension key"
                clearable
                searchable
                data={(trustedFacts.extension_keys || []).map((k: string) => ({ value: k, label: k }))}
                value={tfKey}
                onChange={setTfKey}
                size="sm"
                style={{ minWidth: 180 }}
              />
              <Switch
                label="Show certs without extensions"
                checked={tfShowAll}
                onChange={(e) => setTfShowAll(e.currentTarget.checked)}
                size="sm"
              />
            </Group>

            <ScrollArea h={Math.min(420, 80 + filteredTrustedNodes.length * 40)} type="auto" offsetScrollbars scrollbarSize={6}>
              <Table striped highlightOnHover withTableBorder>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Certname</Table.Th>
                    {trustedColumns.map((col) => (
                      <Table.Th key={col}><Code style={{ fontSize: 11 }}>{col}</Code></Table.Th>
                    ))}
                    {trustedColumns.length === 0 && (
                      <Table.Th>Extensions</Table.Th>
                    )}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {filteredTrustedNodes.map((node: any) => {
                    const exts = node.extensions || {};
                    const hasAny = Object.keys(exts).length > 0;
                    return (
                      <Table.Tr key={node.certname}>
                        <Table.Td>
                          <Text
                            fw={500}
                            c="blue"
                            style={{ cursor: 'pointer', textDecoration: 'underline' }}
                            onClick={() => navigate(`/nodes/${node.certname}`)}
                          >
                            {node.certname}
                          </Text>
                        </Table.Td>
                        {trustedColumns.length > 0 ? (
                          trustedColumns.map((col) => (
                            <Table.Td key={col}>
                              {exts[col] != null && exts[col] !== '' ? (
                                <Code style={{ fontSize: 11 }}>{String(exts[col])}</Code>
                              ) : (
                                <Text size="xs" c="dimmed">—</Text>
                              )}
                            </Table.Td>
                          ))
                        ) : (
                          <Table.Td>
                            {hasAny ? (
                              <Code style={{ fontSize: 11 }}>{JSON.stringify(exts)}</Code>
                            ) : (
                              <Text size="xs" c="dimmed">none</Text>
                            )}
                          </Table.Td>
                        )}
                      </Table.Tr>
                    );
                  })}
                  {filteredTrustedNodes.length === 0 && (
                    <Table.Tr>
                      <Table.Td colSpan={Math.max(2, trustedColumns.length + 1)}>
                        <Text c="dimmed" ta="center" py="lg">
                          {tfShowAll
                            ? 'No signed certificates match the current filters.'
                            : 'No trusted facts found on signed certificates. Agents only get these when CSR extension_requests (e.g. pp_role) are set before signing.'}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  )}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </>
        )}
      </Card>

      {/* Casual illustration */}
      {isRobots && (
        <Card withBorder shadow="sm" padding="sm" style={{ overflow: 'hidden' }}>
          <CertOStamp />
        </Card>
      )}

      <Card withBorder shadow="sm" padding="md">
        <Group mb="md" justify="space-between">
          <Group>
            <Title order={4}>Pending Certificate Requests</Title>
            <Badge color={requested.length > 0 ? 'yellow' : 'green'} size="lg">{requested.length}</Badge>
          </Group>
        </Group>
        {requested.length === 0 ? (
          <Text c="dimmed" ta="center" py="lg" size="sm">
            No pending certificate requests.
          </Text>
        ) : (
          <ScrollArea mah={350} type="auto" offsetScrollbars scrollbarSize={6}>
            <Table striped highlightOnHover withTableBorder>
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
                        <Button
                          size="xs"
                          color="green"
                          leftSection={<IconCheck size={14} />}
                          onClick={() => requestSign(cert.name)}
                          disabled={!canMutateCerts}
                        >
                          Sign
                        </Button>
                        <Button
                          size="xs"
                          color="red"
                          variant="outline"
                          leftSection={<IconTrash size={14} />}
                          onClick={() => requestReject(cert.name)}
                          disabled={!canMutateCerts}
                        >
                          Reject
                        </Button>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        )}
      </Card>

      {/* Signed Certificates */}
      <Card withBorder shadow="sm" padding="md" style={{ overflow: 'hidden' }}>
        <Group mb="md">
          <Title order={4}>Signed Certificates</Title>
          <Badge color="green" size="lg">{signed.length}</Badge>
        </Group>
        <ScrollArea h={650} type="auto" offsetScrollbars scrollbarSize={6}>
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Certname</Table.Th>
                <Table.Th>Fingerprint</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {[...signed].sort((a: any, b: any) => (a.name || '').localeCompare(b.name || '')).map((cert: any) => {
                const protectedCert = isProtected(cert.name);
                const canAct = canMutateCerts && !protectedCert;
                return (
                <Table.Tr key={cert.name}>
                  <Table.Td>
                    <Group gap="xs">
                      <Text fw={500} c="blue" style={{ cursor: 'pointer', textDecoration: 'underline' }}
                        onClick={() => navigate(`/nodes/${cert.name}`)}>{cert.name}</Text>
                      {protectedCert && (
                        <Badge size="xs" color="red" variant="light">
                          {protectedLabel(cert.name)}
                        </Badge>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td><Code style={{ fontSize: 10, maxWidth: 280, display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cert.fingerprint || 'N/A'}</Code></Table.Td>
                  <Table.Td>
                    <Group gap="xs" justify="flex-end">
                      <Tooltip label="Certificate details">
                        <ActionIcon variant="subtle" color="blue" aria-label={`Certificate details for ${cert.name}`} onClick={() => handleInfo(cert.name)}>
                          <IconInfoCircle size={16} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label={
                        protectedCert
                          ? `${protectedLabel(cert.name)} certificate — cannot revoke from GUI`
                          : !canMutateCerts
                            ? 'Requires admin, operator, or certops role'
                            : 'Revoke certificate'
                      }>
                        <ActionIcon
                          variant="subtle"
                          color="yellow"
                          disabled={!canAct}
                          aria-label={`Revoke ${cert.name}`}
                          onClick={() => requestRevoke(cert.name)}
                        >
                          <IconX size={16} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label={
                        protectedCert
                          ? `${protectedLabel(cert.name)} certificate — cannot clean from GUI`
                          : !canMutateCerts
                            ? 'Requires admin, operator, or certops role'
                            : 'Clean certificate'
                      }>
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          disabled={!canAct}
                          aria-label={`Clean ${cert.name}`}
                          onClick={() => requestClean(cert.name)}
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              );
              })}
              {signed.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={3}><Text c="dimmed" ta="center" py="lg">No signed certificates found</Text></Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Card>

      <Modal opened={detailOpen} onClose={() => setDetailOpen(false)}
        title={`Certificate Details — ${detailData?.certname || ''}`} size="xl">
        {detailLoading ? (
          <Center h={200}><Loader /></Center>
        ) : detailData?.error ? (
          <Alert color="red">{detailData.error}</Alert>
        ) : (
          <ScrollArea style={{ height: '70vh', maxHeight: 600, minHeight: 400 }}>
            <Code block style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {detailData?.details || 'No details available'}
            </Code>
          </ScrollArea>
        )}
      </Modal>

      <ConfirmModal
        opened={!!pendingAction}
        onClose={() => !actionLoading && setPendingAction(null)}
        onConfirm={executePendingAction}
        title={
          pendingAction?.type === 'sign' ? 'Sign certificate?'
            : pendingAction?.type === 'reject' ? 'Reject certificate request?'
            : pendingAction?.type === 'revoke' ? 'Revoke certificate?'
            : 'Clean certificate?'
        }
        body={
          pendingAction?.type === 'sign'
            ? `Sign certificate for "${pendingAction?.certname}"?`
            : pendingAction?.type === 'reject'
              ? `Reject (clean) certificate request for "${pendingAction?.certname}"?`
              : pendingAction?.type === 'revoke'
                ? `Revoke certificate for "${pendingAction?.certname}"? This cannot be undone.`
                : `Permanently delete certificate for "${pendingAction?.certname}"?`
        }
        details={pendingAction ? [pendingAction.certname] : undefined}
        confirmLabel={
          pendingAction?.type === 'sign' ? 'Sign'
            : pendingAction?.type === 'reject' ? 'Reject'
            : pendingAction?.type === 'revoke' ? 'Revoke'
            : 'Clean'
        }
        confirmColor={pendingAction?.type === 'sign' ? 'green' : undefined}
        danger={pendingAction?.type === 'revoke' || pendingAction?.type === 'clean' || pendingAction?.type === 'reject'}
        loading={actionLoading}
      />
    </Stack>
  );
}
