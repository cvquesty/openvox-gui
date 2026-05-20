/**
 * OpenVox GUI - ConfigSSL.tsx
 *
 * SSL Certificate Wizard — guided certificate management for OpenVox GUI
 * and the Puppet CA. Supports corporate PKI uploads, Let's Encrypt renewal,
 * Puppet cert reuse, and intermediate CA setup.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Title, Card, Loader, Center, Alert, Stack, Group, Text, Code, Badge,
  Button, Stepper, Select, Divider, CopyButton, ActionIcon, Tooltip,
  ThemeIcon, Paper, Table, Box, Textarea,
} from '@mantine/core';
import { Dropzone, MIME_TYPES } from '@mantine/dropzone';
import { notifications } from '@mantine/notifications';
import {
  IconLock, IconShieldCheck, IconAlertTriangle, IconUpload, IconX,
  IconCheck, IconCertificate, IconServer, IconWorldWww, IconRefresh,
  IconDownload, IconCopy, IconCloudComputing, IconBuildingBank,
} from '@tabler/icons-react';
import { ssl } from '../services/api';

/* ═══════════════════════════════════════════════════════════
   Shared: Certificate health badge
   ═══════════════════════════════════════════════════════════ */
function CertHealthBadge({ cert }: { cert: any }) {
  if (!cert) return <Badge color="gray" variant="light">No certificate</Badge>;
  if (cert.expired) return <Badge color="red" variant="filled">Expired</Badge>;
  if (cert.days_remaining < 30) return <Badge color="yellow" variant="filled">Expiring soon ({cert.days_remaining}d)</Badge>;
  return <Badge color="green" variant="filled">Valid ({cert.days_remaining}d remaining)</Badge>;
}

function CertDetails({ cert, label }: { cert: any; label?: string }) {
  if (!cert) return <Text c="dimmed" size="sm">No certificate found</Text>;
  return (
    <Stack gap={4}>
      {label && <Text size="xs" fw={600} c="dimmed" tt="uppercase">{label}</Text>}
      <Group gap="xs" wrap="wrap">
        <CertHealthBadge cert={cert} />
        <Badge variant="outline" size="sm">{cert.key_type} {cert.key_detail}</Badge>
        {cert.self_signed && <Badge variant="outline" size="sm" color="orange">Self-Signed</Badge>}
      </Group>
      <Text size="sm"><strong>Subject:</strong> {cert.subject}</Text>
      <Text size="sm"><strong>Issuer:</strong> {cert.issuer}</Text>
      <Text size="sm"><strong>Expires:</strong> {new Date(cert.not_after).toLocaleDateString()}</Text>
      {cert.san && cert.san.length > 0 && (
        <Text size="sm"><strong>SANs:</strong> {cert.san.join(', ')}</Text>
      )}
    </Stack>
  );
}

/* ═══════════════════════════════════════════════════════════
   Shared: File upload drop zone for PEM files
   ═══════════════════════════════════════════════════════════ */
function CertUploadZone({
  label, description, file, onDrop, onClear, validation, required = true,
}: {
  label: string;
  description: string;
  file: File | null;
  onDrop: (file: File) => void;
  onClear: () => void;
  validation?: any;
  required?: boolean;
}) {
  return (
    <Card withBorder padding="sm">
      <Group justify="space-between" mb={4}>
        <Text size="sm" fw={600}>{label} {!required && <Text span c="dimmed" size="xs">(optional)</Text>}</Text>
        {file && (
          <ActionIcon size="sm" variant="subtle" color="red" onClick={onClear}>
            <IconX size={14} />
          </ActionIcon>
        )}
      </Group>
      <Text size="xs" c="dimmed" mb="xs">{description}</Text>

      {!file ? (
        <Dropzone
          onDrop={(files) => files[0] && onDrop(files[0])}
          accept={['.pem', '.crt', '.key', '.cer', 'application/x-pem-file', 'application/x-x509-ca-cert', 'application/pkix-cert']}
          maxSize={1024 * 1024}
          multiple={false}
          style={{ minHeight: 80 }}
        >
          <Center h={70}>
            <Stack align="center" gap={4}>
              <IconUpload size={20} color="var(--mantine-color-dimmed)" />
              <Text size="xs" c="dimmed">Drag a file here or click to browse</Text>
              <Text size="xs" c="dimmed">.pem, .crt, .key files accepted</Text>
            </Stack>
          </Center>
        </Dropzone>
      ) : (
        <Paper withBorder p="xs" style={{ background: 'var(--mantine-color-dark-7, var(--mantine-color-gray-0))' }}>
          <Group justify="space-between" mb={4}>
            <Group gap="xs">
              <IconCheck size={16} color="var(--mantine-color-green-6)" />
              <Text size="sm" fw={500}>{file.name}</Text>
              <Text size="xs" c="dimmed">({(file.size / 1024).toFixed(1)} KB)</Text>
            </Group>
          </Group>
          {validation && (
            <Stack gap={2} mt={4}>
              {validation.key_type && (
                <Badge size="sm" variant="light">{validation.key_type} {validation.key_detail}</Badge>
              )}
              {validation.subject && (
                <Text size="xs">CN: {validation.subject}</Text>
              )}
              {validation.not_after && (
                <Text size="xs">Expires: {new Date(validation.not_after).toLocaleDateString()}</Text>
              )}
              {validation.count && (
                <Text size="xs">{validation.count} certificate(s) in chain</Text>
              )}
            </Stack>
          )}
        </Paper>
      )}
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════
   Flow A: Web Certificate Wizard
   ═══════════════════════════════════════════════════════════ */
function WebCertWizard({
  status, onDone, onCancel,
}: {
  status: any;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState(0);
  const [source, setSource] = useState<string | null>(null);
  const [certFile, setCertFile] = useState<File | null>(null);
  const [keyFile, setKeyFile] = useState<File | null>(null);
  const [chainFile, setChainFile] = useState<File | null>(null);
  const [validation, setValidation] = useState<any>(null);
  const [validating, setValidating] = useState(false);
  const [applying, setApplying] = useState(false);

  // LE state
  const [leStatus, setLeStatus] = useState<any>(null);
  const [leRenewing, setLeRenewing] = useState(false);
  const [leResult, setLeResult] = useState<any>(null);

  const handleValidate = async () => {
    if (!certFile || !keyFile) return;
    setValidating(true);
    try {
      const result = await ssl.validate(certFile, keyFile, chainFile);
      setValidation(result);
      if (result.valid) setStep(3);
      else notifications.show({ title: 'Validation Failed', message: result.errors?.join('; '), color: 'red' });
    } catch (e: any) {
      notifications.show({ title: 'Error', message: e.message, color: 'red' });
    }
    setValidating(false);
  };

  const handleApplyOrg = async () => {
    if (!certFile || !keyFile) return;
    setApplying(true);
    try {
      await ssl.applyWebCert(certFile, keyFile, chainFile);
      notifications.show({ title: 'Certificate Installed', message: 'Service is restarting with new certificate...', color: 'green' });
      setTimeout(onDone, 3000);
    } catch (e: any) {
      notifications.show({ title: 'Error', message: e.message, color: 'red' });
      setApplying(false);
    }
  };

  const handleApplyPuppet = async () => {
    setApplying(true);
    try {
      await ssl.applyPuppetCerts();
      notifications.show({ title: 'Certificate Applied', message: 'Now using Puppet certificates. Service restarting...', color: 'green' });
      setTimeout(onDone, 3000);
    } catch (e: any) {
      notifications.show({ title: 'Error', message: e.message, color: 'red' });
      setApplying(false);
    }
  };

  const handleLeRenew = async () => {
    setLeRenewing(true);
    try {
      const result = await ssl.letsencrypt.renew();
      setLeResult(result);
    } catch (e: any) {
      notifications.show({ title: 'Error', message: e.message, color: 'red' });
    }
    setLeRenewing(false);
  };

  const handleLeSignal = async () => {
    try {
      await ssl.letsencrypt.signal();
      notifications.show({ title: 'Signal Sent', message: 'Certbot will proceed with DNS verification...', color: 'blue' });
    } catch (e: any) {
      notifications.show({ title: 'Error', message: e.message, color: 'red' });
    }
  };

  useEffect(() => {
    if (source === 'letsencrypt') {
      ssl.letsencrypt.getStatus().then(setLeStatus).catch(() => {});
    }
  }, [source]);

  return (
    <Card withBorder shadow="sm" padding="lg">
      <Group justify="space-between" mb="md">
        <Group gap="xs">
          <IconWorldWww size={24} />
          <Title order={4}>Web Certificate Wizard</Title>
        </Group>
        <Button variant="subtle" color="gray" onClick={onCancel} size="xs">Cancel</Button>
      </Group>

      <Stepper active={step} onStepClick={(s) => s < step && setStep(s)}>
        {/* Step 0: Choose source */}
        <Stepper.Step label="Source" description="Where are your certs?">
          <Stack mt="md">
            <Text size="sm" c="dimmed" mb="xs">How would you like to provide your web certificate?</Text>

            <Card withBorder padding="md" style={{ cursor: 'pointer', border: source === 'organization' ? '2px solid var(--mantine-color-blue-6)' : undefined }}
              onClick={() => { setSource('organization'); setStep(1); }}>
              <Group>
                <ThemeIcon size="lg" variant="light" color="blue"><IconBuildingBank size={20} /></ThemeIcon>
                <div>
                  <Text fw={600}>Organization Certificate</Text>
                  <Text size="xs" c="dimmed">I have cert files from my IT department or certificate authority</Text>
                </div>
              </Group>
            </Card>

            <Card withBorder padding="md" style={{ cursor: 'pointer', border: source === 'letsencrypt' ? '2px solid var(--mantine-color-green-6)' : undefined }}
              onClick={() => { setSource('letsencrypt'); setStep(1); }}>
              <Group>
                <ThemeIcon size="lg" variant="light" color="green"><IconCloudComputing size={20} /></ThemeIcon>
                <div>
                  <Text fw={600}>Let's Encrypt</Text>
                  <Text size="xs" c="dimmed">I use free certificates from Let's Encrypt (certbot)</Text>
                </div>
              </Group>
            </Card>

            <Card withBorder padding="md" style={{ cursor: 'pointer', border: source === 'puppet' ? '2px solid var(--mantine-color-orange-6)' : undefined }}
              onClick={() => { setSource('puppet'); setStep(1); }}>
              <Group>
                <ThemeIcon size="lg" variant="light" color="orange"><IconServer size={20} /></ThemeIcon>
                <div>
                  <Text fw={600}>Puppet Certificates</Text>
                  <Text size="xs" c="dimmed">Use the same certificates that OpenVox Server already uses</Text>
                </div>
              </Group>
            </Card>
          </Stack>
        </Stepper.Step>

        {/* Step 1: Prep / Details */}
        <Stepper.Step label={source === 'letsencrypt' ? 'Renew' : source === 'puppet' ? 'Confirm' : 'Prepare'} description={source === 'letsencrypt' ? 'Renew cert' : source === 'puppet' ? 'Review cert' : 'Gather your files'}>
          <Stack mt="md">
            {source === 'organization' && (
              <>
                <Alert variant="light" color="blue" title="Before we begin, gather these files from your certificate team:">
                  <Stack gap="xs" mt="xs">
                    <Text size="sm"><strong>1. Server Certificate</strong> — The certificate issued for this server. Your IT team may call it a "signed cert" or "SSL cert". Usually a <Code>.pem</Code> or <Code>.crt</Code> file.</Text>
                    <Text size="sm"><strong>2. Private Key</strong> — The key file generated when the certificate was requested. Usually <Code>.pem</Code> or <Code>.key</Code>.</Text>
                    <Text size="sm"><strong>3. CA Chain</strong> (optional) — Your organization's certificate chain. Sometimes called "CA bundle". If your IT team gave you a single file with multiple certificates, that's this one.</Text>
                  </Stack>
                </Alert>
                <Alert variant="light" color="gray" title="Example email to your IT team:">
                  <Code block style={{ fontSize: 12 }}>
{`Hi,

I need a TLS certificate for ${status?.hostname || 'our OpenVox server'}.
Please provide the signed cert, private key, and CA chain in PEM format.

Server hostname: ${status?.hostname || '(hostname)'}

Thank you!`}
                  </Code>
                </Alert>
                <Group justify="flex-end">
                  <Button onClick={() => setStep(2)}>I have my files, continue</Button>
                </Group>
              </>
            )}

            {source === 'puppet' && (
              <>
                <Alert variant="light" color="blue">
                  OpenVox Server uses its own Puppet certificates for agent communication.
                  The GUI can reuse these same certificates for its HTTPS interface.
                </Alert>
                <CertDetails cert={status?.gui?.cert} label="Current Puppet Certificate" />
                <Group justify="flex-end">
                  <Button onClick={handleApplyPuppet} loading={applying} color="orange">
                    Use Puppet Certificates
                  </Button>
                </Group>
              </>
            )}

            {source === 'letsencrypt' && (
              <>
                {!status?.letsencrypt?.certbot_installed ? (
                  <Alert color="yellow" title="Certbot not installed">
                    <Text size="sm">Let's Encrypt requires <Code>certbot</Code> to be installed on this server.</Text>
                    <Text size="sm" mt="xs">Install it with: <Code>sudo dnf install certbot</Code> or <Code>sudo snap install certbot --classic</Code></Text>
                  </Alert>
                ) : (
                  <>
                    {status?.letsencrypt?.cert && (
                      <CertDetails cert={status.letsencrypt.cert} label={`Let's Encrypt Certificate (${status.letsencrypt.domain})`} />
                    )}
                    {leResult?.status === 'challenge_pending' ? (
                      <Alert color="yellow" title="DNS Challenge Required">
                        <Text size="sm" mb="xs">Add this TXT record to your DNS:</Text>
                        <Table withTableBorder>
                          <Table.Tbody>
                            <Table.Tr><Table.Th>Name</Table.Th><Table.Td><Code>_acme-challenge.{leResult.domain?.replace(/^.*\.([^.]+\.[^.]+)$/, '$1') || 'yourdomain'}</Code></Table.Td></Table.Tr>
                            <Table.Tr><Table.Th>Type</Table.Th><Table.Td><Code>TXT</Code></Table.Td></Table.Tr>
                            <Table.Tr><Table.Th>Value</Table.Th><Table.Td>
                              <Group gap="xs">
                                <Code>{leResult.txt_value}</Code>
                                <CopyButton value={leResult.txt_value || ''}>
                                  {({ copied, copy }) => (
                                    <ActionIcon size="sm" variant="subtle" onClick={copy}>
                                      {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                                    </ActionIcon>
                                  )}
                                </CopyButton>
                              </Group>
                            </Table.Td></Table.Tr>
                          </Table.Tbody>
                        </Table>
                        <Button mt="md" onClick={handleLeSignal}>I've updated my DNS</Button>
                      </Alert>
                    ) : leResult?.status === 'completed' ? (
                      <Alert color="green" title="Renewal Successful">
                        <Text size="sm">Certificate renewed. You can now use it for the GUI.</Text>
                        <Button mt="sm" onClick={handleApplyPuppet}>Apply to GUI</Button>
                      </Alert>
                    ) : (
                      <Button onClick={handleLeRenew} loading={leRenewing} leftSection={<IconRefresh size={16} />}>
                        Renew Now
                      </Button>
                    )}
                  </>
                )}
              </>
            )}
          </Stack>
        </Stepper.Step>

        {/* Step 2: Upload (organization only) */}
        <Stepper.Step label="Upload" description="Upload your files">
          <Stack mt="md">
            <CertUploadZone
              label="Server Certificate"
              description="The certificate file your IT team provided (.pem or .crt)"
              file={certFile}
              onDrop={setCertFile}
              onClear={() => { setCertFile(null); setValidation(null); }}
              validation={validation?.cert}
            />
            <CertUploadZone
              label="Private Key"
              description="The private key file (.pem or .key)"
              file={keyFile}
              onDrop={setKeyFile}
              onClear={() => { setKeyFile(null); setValidation(null); }}
              validation={validation?.key}
            />
            <CertUploadZone
              label="CA Chain"
              description="Your organization's CA bundle / chain file (if provided)"
              file={chainFile}
              onDrop={setChainFile}
              onClear={() => setChainFile(null)}
              validation={validation?.chain}
              required={false}
            />
            {validation && !validation.valid && (
              <Alert color="red" title="Validation Errors">
                {validation.errors?.map((e: string, i: number) => <Text key={i} size="sm">{e}</Text>)}
              </Alert>
            )}
            {validation?.match === true && (
              <Alert color="green" icon={<IconCheck size={16} />}>
                Certificate and private key match.
              </Alert>
            )}
            <Group justify="flex-end">
              <Button onClick={handleValidate} loading={validating} disabled={!certFile || !keyFile}>
                Validate & Continue
              </Button>
            </Group>
          </Stack>
        </Stepper.Step>

        {/* Step 3: Confirm & Apply */}
        <Stepper.Step label="Apply" description="Install certificate">
          <Stack mt="md">
            {validation?.cert && (
              <Card withBorder padding="md">
                <Text fw={600} mb="xs">Certificate Summary</Text>
                <CertDetails cert={validation.cert} />
                {validation.chain?.count > 0 && (
                  <Text size="sm" mt="xs"><strong>Chain:</strong> {validation.chain.count} certificate(s)</Text>
                )}
                <Divider my="sm" />
                <Text size="sm" c="dimmed">The certificate and key will be installed and the OpenVox GUI service will restart automatically.</Text>
              </Card>
            )}
            <Group justify="flex-end">
              <Button variant="subtle" onClick={() => setStep(2)}>Back</Button>
              <Button onClick={handleApplyOrg} loading={applying} color="green" leftSection={<IconShieldCheck size={16} />}>
                Install Certificate
              </Button>
            </Group>
          </Stack>
        </Stepper.Step>
      </Stepper>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════
   Flow B: Puppet CA Intermediate Wizard
   ═══════════════════════════════════════════════════════════ */
function PuppetCAWizard({
  status, onDone, onCancel,
}: {
  status: any;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState(0);
  const [keyType, setKeyType] = useState<string>('rsa');
  const [csrData, setCsrData] = useState<any>(null);
  const [generating, setGenerating] = useState(false);
  const [bundleFile, setBundleFile] = useState<File | null>(null);
  const [crlFile, setCrlFile] = useState<File | null>(null);
  const [caKeyFile, setCaKeyFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);

  // Check for pending CSR on mount
  useEffect(() => {
    ssl.puppetCA.getPending().then((data) => {
      if (data.pending) {
        setCsrData(data);
        setStep(2);
      }
    }).catch(() => {});
  }, []);

  const handleGenerateCSR = async () => {
    setGenerating(true);
    try {
      const result = await ssl.puppetCA.generateCSR(keyType);
      setCsrData(result);
      setStep(2);
    } catch (e: any) {
      notifications.show({ title: 'Error', message: e.message, color: 'red' });
    }
    setGenerating(false);
  };

  const handleImport = async () => {
    if (!bundleFile || !crlFile) return;
    setImporting(true);
    try {
      const result = await ssl.puppetCA.importCA(bundleFile, crlFile, caKeyFile);
      setImportResult(result);
      if (result.success) setStep(4);
      else notifications.show({ title: 'Import Failed', message: result.message, color: 'red' });
    } catch (e: any) {
      notifications.show({ title: 'Error', message: e.message, color: 'red' });
    }
    setImporting(false);
  };

  const caStatus = status?.puppet_ca;

  return (
    <Card withBorder shadow="sm" padding="lg">
      <Group justify="space-between" mb="md">
        <Group gap="xs">
          <IconCertificate size={24} />
          <Title order={4}>Puppet CA Certificate Wizard</Title>
        </Group>
        <Button variant="subtle" color="gray" onClick={onCancel} size="xs">Cancel</Button>
      </Group>

      <Stepper active={step} onStepClick={(s) => s < step && setStep(s)}>
        {/* Step 0: Prep */}
        <Stepper.Step label="Overview" description="What you'll need">
          <Stack mt="md">
            <Alert variant="light" color="blue" title="Connect OpenVox to your organization's certificate authority">
              <Stack gap="xs" mt="xs">
                <Text size="sm">This process chains your OpenVox server's internal CA to your organization's PKI, so all Puppet certificates are trusted by your corporate infrastructure.</Text>
                <Divider my="xs" />
                <Text size="sm" fw={600}>Here's how it works:</Text>
                <Text size="sm">1. We'll generate a <strong>certificate request</strong> that you send to your PKI or security team</Text>
                <Text size="sm">2. They'll sign it and send back a <strong>signed certificate bundle</strong></Text>
                <Text size="sm">3. You'll also need their <strong>CRL files</strong> (revocation lists)</Text>
                <Text size="sm">4. Upload everything here and we handle the rest</Text>
              </Stack>
            </Alert>

            <Card withBorder padding="md">
              <Text fw={600} mb="xs">What to ask your PKI team for:</Text>
              <Table withTableBorder withColumnBorders>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>What to request</Table.Th>
                    <Table.Th>What they'll call it</Table.Th>
                    <Table.Th>What it looks like</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  <Table.Tr>
                    <Table.Td>"Sign this CSR as an intermediate CA"</Table.Td>
                    <Table.Td>CSR signing</Table.Td>
                    <Table.Td>You give them a <Code>.pem</Code> file, they return a signed cert</Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td>"The full certificate chain"</Table.Td>
                    <Table.Td>CA bundle / chain file</Table.Td>
                    <Table.Td>A <Code>.pem</Code> file with multiple certificates</Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td>"Your CRL chain"</Table.Td>
                    <Table.Td>Certificate Revocation List(s)</Table.Td>
                    <Table.Td>A <Code>.pem</Code> file — ask for "PEM format"</Table.Td>
                  </Table.Tr>
                </Table.Tbody>
              </Table>
              <Text size="xs" c="dimmed" mt="xs">Typical turnaround: 1-5 business days. You can generate the request now and come back later.</Text>
            </Card>

            {caStatus?.cert && (
              <Card withBorder padding="sm">
                <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb={4}>Current CA Certificate</Text>
                <CertDetails cert={caStatus.cert} />
                {caStatus.is_intermediate && <Badge color="blue" variant="light" mt="xs">Intermediate CA</Badge>}
              </Card>
            )}

            <Group justify="flex-end">
              <Button onClick={() => setStep(1)}>Generate Certificate Request</Button>
            </Group>
          </Stack>
        </Stepper.Step>

        {/* Step 1: Generate CSR */}
        <Stepper.Step label="Generate" description="Create request">
          <Stack mt="md">
            <Select
              label="Key Type"
              description="RSA 4096 has the widest compatibility. EC P-256 is modern and faster."
              data={[
                { value: 'rsa', label: 'RSA 4096-bit (recommended)' },
                { value: 'ec', label: 'EC P-256 (modern)' },
              ]}
              value={keyType}
              onChange={(v) => setKeyType(v || 'rsa')}
            />
            <Button onClick={handleGenerateCSR} loading={generating}>
              Generate Certificate Request
            </Button>
          </Stack>
        </Stepper.Step>

        {/* Step 2: Show CSR / Wait for signed response */}
        <Stepper.Step label="Send & Wait" description="Send to PKI team">
          <Stack mt="md">
            {csrData && (
              <>
                <Alert variant="light" color="green" title="Certificate request generated">
                  <Text size="sm">Send this to your PKI team. When they respond with a signed certificate, click "I have my signed certificate" below.</Text>
                </Alert>

                <Card withBorder padding="md">
                  <Group justify="space-between" mb="xs">
                    <Text fw={600} size="sm">Certificate Signing Request (CSR)</Text>
                    <Group gap="xs">
                      <CopyButton value={csrData.csr || ''}>
                        {({ copied, copy }) => (
                          <Button size="compact-xs" variant="light" leftSection={copied ? <IconCheck size={12} /> : <IconCopy size={12} />} onClick={copy}>
                            {copied ? 'Copied' : 'Copy'}
                          </Button>
                        )}
                      </CopyButton>
                      <Button size="compact-xs" variant="light" leftSection={<IconDownload size={12} />}
                        onClick={() => {
                          const blob = new Blob([csrData.csr], { type: 'application/x-pem-file' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url; a.download = 'openvox-ca-request.pem'; a.click();
                          URL.revokeObjectURL(url);
                        }}>
                        Download
                      </Button>
                    </Group>
                  </Group>
                  <Code block style={{ fontSize: 11, maxHeight: 200, overflow: 'auto' }}>
                    {csrData.csr}
                  </Code>
                </Card>

                <Alert variant="light" color="gray" title="Example email to your PKI team:">
                  <Code block style={{ fontSize: 12 }}>
{`Hi,

Please sign the attached CSR as an intermediate CA certificate.

CA Name: ${csrData.ca_name || 'Puppet CA'}
Key Type: ${csrData.key_type || 'RSA 4096-bit'}

I'll need back:
1. The signed certificate with the full chain (PEM format)
2. Your CRL chain (PEM format)

The CSR is attached as openvox-ca-request.pem.

Thank you!`}
                  </Code>
                </Alert>

                <Group justify="flex-end">
                  <Button onClick={() => setStep(3)}>
                    I have my signed certificate
                  </Button>
                </Group>
              </>
            )}
          </Stack>
        </Stepper.Step>

        {/* Step 3: Upload signed response */}
        <Stepper.Step label="Upload" description="Upload signed cert">
          <Stack mt="md">
            <CertUploadZone
              label="Signed Certificate Bundle"
              description="The file your PKI team sent back — your signed cert plus their CA chain"
              file={bundleFile}
              onDrop={setBundleFile}
              onClear={() => setBundleFile(null)}
            />
            <CertUploadZone
              label="CRL Chain"
              description="The revocation list files from your PKI team (PEM format)"
              file={crlFile}
              onDrop={setCrlFile}
              onClear={() => setCrlFile(null)}
            />
            <CertUploadZone
              label="CA Private Key"
              description="Only needed if you provided your own key instead of generating one here"
              file={caKeyFile}
              onDrop={setCaKeyFile}
              onClear={() => setCaKeyFile(null)}
              required={false}
            />

            <Alert color="orange" icon={<IconAlertTriangle size={16} />} title="Important">
              <Text size="sm">This will replace the current Puppet CA and restart PuppetServer. After import, all managed nodes will need to run <Code>puppet agent -t</Code> to re-establish trust.</Text>
            </Alert>

            <Group justify="flex-end">
              <Button variant="subtle" onClick={() => setStep(2)}>Back</Button>
              <Button onClick={handleImport} loading={importing} disabled={!bundleFile || !crlFile} color="red"
                leftSection={<IconCertificate size={16} />}>
                Import & Activate
              </Button>
            </Group>
          </Stack>
        </Stepper.Step>

        {/* Step 4: Success */}
        <Stepper.Step label="Done" description="Complete">
          <Stack mt="md">
            <Alert color="green" icon={<IconCheck size={16} />} title="CA Imported Successfully">
              <Text size="sm">Your Puppet CA is now an intermediate CA chained to your organization's PKI.</Text>
            </Alert>
            {importResult?.chain && (
              <Card withBorder padding="md">
                <Text fw={600} mb="xs">Certificate Chain</Text>
                {importResult.chain.map((c: any, i: number) => (
                  <Paper key={i} withBorder p="xs" mb={4}>
                    <Text size="sm" fw={500}>{i === 0 ? 'Puppet CA' : i === importResult.chain.length - 1 ? 'Root CA' : `Intermediate ${i}`}</Text>
                    <Text size="xs">{c.subject}</Text>
                  </Paper>
                ))}
              </Card>
            )}
            <Alert variant="light" color="blue" title="Next steps for your fleet:">
              <Text size="sm">Run <Code>puppet agent -t</Code> on each managed node to re-establish trust with the new CA.</Text>
              <Text size="sm" mt="xs">Or use the <strong>Orchestration</strong> page to run it across your fleet at once.</Text>
            </Alert>
            <Button onClick={onDone}>Done</Button>
          </Stack>
        </Stepper.Step>
      </Stepper>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════
   Main Page
   ═══════════════════════════════════════════════════════════ */
export function ConfigSSLPage() {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<any>(null);
  const [activeWizard, setActiveWizard] = useState<'web' | 'ca' | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    ssl.getStatus()
      .then(setStatus)
      .catch(() => notifications.show({ title: 'Error', message: 'Failed to load SSL status', color: 'red' }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Center h={300}><Loader size="xl" /></Center>;

  const guiCert = status?.gui?.cert;
  const caCert = status?.puppet_ca?.cert;

  return (
    <Stack gap="lg">
      <Group>
        <IconLock size={28} />
        <Title order={2}>SSL Certificate Management</Title>
      </Group>

      {/* Status Banner */}
      <Card withBorder shadow="sm" padding="md">
        <Group justify="space-between" mb="md">
          <Text fw={700}>Certificate Status</Text>
          <Button variant="subtle" size="compact-xs" leftSection={<IconRefresh size={14} />} onClick={load}>Refresh</Button>
        </Group>
        <Group grow>
          <Paper withBorder p="md">
            <Group gap="xs" mb="xs">
              <IconWorldWww size={18} />
              <Text fw={600} size="sm">Web Certificate (GUI HTTPS)</Text>
            </Group>
            <CertHealthBadge cert={guiCert} />
            {guiCert && (
              <Stack gap={2} mt="xs">
                <Text size="xs">CN: {guiCert.subject}</Text>
                <Text size="xs">Expires: {new Date(guiCert.not_after).toLocaleDateString()}</Text>
                <Text size="xs">{guiCert.key_type} {guiCert.key_detail}</Text>
              </Stack>
            )}
            {!guiCert && !status?.gui?.ssl_enabled && (
              <Text size="xs" c="dimmed" mt="xs">SSL not enabled — serving over HTTP</Text>
            )}
          </Paper>

          <Paper withBorder p="md">
            <Group gap="xs" mb="xs">
              <IconCertificate size={18} />
              <Text fw={600} size="sm">Puppet CA</Text>
            </Group>
            <CertHealthBadge cert={caCert} />
            {caCert && (
              <Stack gap={2} mt="xs">
                <Text size="xs">CN: {caCert.subject}</Text>
                <Text size="xs">Expires: {new Date(caCert.not_after).toLocaleDateString()}</Text>
                <Badge size="xs" variant="light" color={status?.puppet_ca?.is_intermediate ? 'blue' : 'orange'}>
                  {status?.puppet_ca?.is_intermediate ? 'Intermediate CA' : 'Self-Signed'}
                </Badge>
              </Stack>
            )}
            {status?.puppet_ca?.pending_csr && (
              <Badge size="xs" color="yellow" variant="filled" mt="xs">Pending CSR</Badge>
            )}
          </Paper>
        </Group>
      </Card>

      {/* Active Wizard or Action Cards */}
      {activeWizard === 'web' ? (
        <WebCertWizard status={status} onDone={() => { setActiveWizard(null); load(); }} onCancel={() => setActiveWizard(null)} />
      ) : activeWizard === 'ca' ? (
        <PuppetCAWizard status={status} onDone={() => { setActiveWizard(null); load(); }} onCancel={() => setActiveWizard(null)} />
      ) : (
        <Group grow>
          <Card withBorder shadow="sm" padding="lg" style={{ cursor: 'pointer' }} onClick={() => setActiveWizard('web')}>
            <Stack align="center" gap="sm">
              <ThemeIcon size={48} variant="light" color="blue" radius="xl">
                <IconWorldWww size={28} />
              </ThemeIcon>
              <Text fw={700} ta="center">Renew Web Certificate</Text>
              <Text size="sm" c="dimmed" ta="center">
                Update the HTTPS certificate for the OpenVox GUI web interface.
                Supports organization certs, Let's Encrypt, or Puppet certificates.
              </Text>
              <Button variant="light" fullWidth>Get Started</Button>
            </Stack>
          </Card>

          <Card withBorder shadow="sm" padding="lg" style={{ cursor: 'pointer' }} onClick={() => setActiveWizard('ca')}>
            <Stack align="center" gap="sm">
              <ThemeIcon size={48} variant="light" color="orange" radius="xl">
                <IconCertificate size={28} />
              </ThemeIcon>
              <Text fw={700} ta="center">Configure Puppet CA</Text>
              <Text size="sm" c="dimmed" ta="center">
                Chain your Puppet CA to your organization's PKI as an intermediate CA.
                For enterprise environments that require corporate certificate trust.
              </Text>
              <Button variant="light" color="orange" fullWidth>Get Started</Button>
            </Stack>
          </Card>
        </Group>
      )}

      {/* Trust Instructions (always visible at bottom) */}
      <Card withBorder padding="md">
        <Group mb="xs">
          <Text fw={600} size="sm">Accepting Certificates on Client Machines</Text>
        </Group>
        <Divider my="xs" label="macOS" labelPosition="left" />
        <Text size="xs" c="dimmed" pl="md">
          Drag the <Code>.pem</Code> file into Keychain Access → Certificates, double-click → Trust → Always Trust.
          Or: <Code>sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain cert.pem</Code>
        </Text>
        <Divider my="xs" label="Windows" labelPosition="left" />
        <Text size="xs" c="dimmed" pl="md">
          Double-click the <Code>.pem</Code> file → Install Certificate → Local Machine → Trusted Root Certification Authorities.
          Or: <Code>Import-Certificate -FilePath cert.pem -CertStoreLocation Cert:\LocalMachine\Root</Code>
        </Text>
      </Card>
    </Stack>
  );
}

export default ConfigSSLPage;
