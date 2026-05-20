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
                <Alert variant="light" color="blue" title="Before we begin, you need to gather 3 files">
                  <Text size="sm" mt="xs">
                    To set up HTTPS, you need files that prove your server's identity to web browsers.
                    Think of it like a driver's license for your server — it proves "I am who I say I am"
                    to anyone who connects. Your IT or security team creates these files. Below is exactly
                    what to ask for and what each piece is.
                  </Text>
                </Alert>

                <Card withBorder padding="md">
                  <Stack gap="md">
                    <div>
                      <Group gap="xs" mb={4}>
                        <Badge color="blue" variant="filled" size="lg">1</Badge>
                        <Text fw={700}>Server Certificate</Text>
                        <Badge variant="outline" size="sm" color="green">Required</Badge>
                      </Group>
                      <Text size="sm" mb="xs">
                        This is the digital ID card for your server. It contains your server's name
                        and is "signed" (approved) by your organization's certificate authority, which
                        makes browsers trust it.
                      </Text>
                      <Card withBorder padding="xs" style={{ background: 'var(--mantine-color-dark-7, var(--mantine-color-gray-0))' }}>
                        <Text size="xs" fw={600} c="dimmed" mb={4}>Your IT team might call this:</Text>
                        <Group gap={4} wrap="wrap">
                          <Badge size="xs" variant="light">"SSL certificate"</Badge>
                          <Badge size="xs" variant="light">"signed cert"</Badge>
                          <Badge size="xs" variant="light">"server cert"</Badge>
                          <Badge size="xs" variant="light">"public cert"</Badge>
                          <Badge size="xs" variant="light">"TLS certificate"</Badge>
                          <Badge size="xs" variant="light">"x509 certificate"</Badge>
                          <Badge size="xs" variant="light">"host certificate"</Badge>
                        </Group>
                        <Text size="xs" c="dimmed" mt={4}>File extensions: <Code>.pem</Code>, <Code>.crt</Code>, <Code>.cer</Code>, <Code>.cert</Code></Text>
                        <Text size="xs" c="dimmed">If you open it in a text editor, it starts with: <Code>-----BEGIN CERTIFICATE-----</Code></Text>
                      </Card>
                    </div>

                    <Divider />

                    <div>
                      <Group gap="xs" mb={4}>
                        <Badge color="blue" variant="filled" size="lg">2</Badge>
                        <Text fw={700}>Private Key</Text>
                        <Badge variant="outline" size="sm" color="green">Required</Badge>
                      </Group>
                      <Text size="sm" mb="xs">
                        This is the secret half of your server's identity. The certificate is the public
                        half (anyone can see it), and the private key is the secret half (only your server
                        should have it). They must be a matching pair — created together. Without the
                        matching key, the certificate won't work.
                      </Text>
                      <Card withBorder padding="xs" style={{ background: 'var(--mantine-color-dark-7, var(--mantine-color-gray-0))' }}>
                        <Text size="xs" fw={600} c="dimmed" mb={4}>Your IT team might call this:</Text>
                        <Group gap={4} wrap="wrap">
                          <Badge size="xs" variant="light">"private key"</Badge>
                          <Badge size="xs" variant="light">"key file"</Badge>
                          <Badge size="xs" variant="light">"SSL key"</Badge>
                          <Badge size="xs" variant="light">"server key"</Badge>
                          <Badge size="xs" variant="light">"RSA key" or "EC key"</Badge>
                        </Group>
                        <Text size="xs" c="dimmed" mt={4}>File extensions: <Code>.pem</Code>, <Code>.key</Code></Text>
                        <Text size="xs" c="dimmed">If you open it in a text editor, it starts with: <Code>-----BEGIN PRIVATE KEY-----</Code> or <Code>-----BEGIN RSA PRIVATE KEY-----</Code></Text>
                        <Alert variant="light" color="yellow" mt={4} p="xs">
                          <Text size="xs">This file is sensitive. Never email it unencrypted or share it publicly. Your IT team should provide it through a secure channel (encrypted file share, in-person USB handoff, etc.).</Text>
                        </Alert>
                      </Card>
                    </div>

                    <Divider />

                    <div>
                      <Group gap="xs" mb={4}>
                        <Badge color="gray" variant="filled" size="lg">3</Badge>
                        <Text fw={700}>CA Chain / Bundle</Text>
                        <Badge variant="outline" size="sm" color="gray">Optional</Badge>
                      </Group>
                      <Text size="sm" mb="xs">
                        This file proves that the authority who signed your certificate is itself
                        trustworthy. It's a "chain of trust" — your cert was signed by an intermediate
                        authority, which was signed by a root authority that browsers already trust.
                        If your IT team gave you one file with multiple certificates stacked together,
                        that's this file. You don't always need this — some organizations include the
                        chain inside the server certificate file itself.
                      </Text>
                      <Card withBorder padding="xs" style={{ background: 'var(--mantine-color-dark-7, var(--mantine-color-gray-0))' }}>
                        <Text size="xs" fw={600} c="dimmed" mb={4}>Your IT team might call this:</Text>
                        <Group gap={4} wrap="wrap">
                          <Badge size="xs" variant="light">"CA bundle"</Badge>
                          <Badge size="xs" variant="light">"certificate chain"</Badge>
                          <Badge size="xs" variant="light">"intermediate cert"</Badge>
                          <Badge size="xs" variant="light">"chain file"</Badge>
                          <Badge size="xs" variant="light">"root + intermediate"</Badge>
                          <Badge size="xs" variant="light">"fullchain"</Badge>
                          <Badge size="xs" variant="light">"ca-certificates"</Badge>
                          <Badge size="xs" variant="light">"trust chain"</Badge>
                        </Group>
                        <Text size="xs" c="dimmed" mt={4}>File extensions: <Code>.pem</Code>, <Code>.crt</Code>, <Code>.ca-bundle</Code></Text>
                        <Text size="xs" c="dimmed">Contains multiple <Code>-----BEGIN CERTIFICATE-----</Code> blocks stacked together</Text>
                      </Card>
                    </div>
                  </Stack>
                </Card>

                <Alert variant="light" color="gray" title="Example email to your IT / security team:">
                  <Text size="xs" c="dimmed" mb="xs">Copy and paste this into an email to your certificate team. Fill in the hostname.</Text>
                  <Code block style={{ fontSize: 12 }}>
{`Hi,

I need an SSL/TLS certificate for our OpenVox server.

Server hostname (FQDN): ${status?.hostname || 'openvox.example.com'}

What I need:
  1. The signed server certificate (PEM format, .pem or .crt file)
  2. The private key that goes with it (PEM format, .pem or .key file)
  3. The CA chain / intermediate certificate bundle (PEM format)

If you need me to generate a CSR (Certificate Signing Request) first,
please let me know what key type and key size you require, and I will
generate one and send it to you for signing.

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
              description="The signed certificate file from your IT team. This is the 'public' half of your server's identity. Look for a .pem or .crt file — it starts with '-----BEGIN CERTIFICATE-----' if opened in a text editor."
              file={certFile}
              onDrop={setCertFile}
              onClear={() => { setCertFile(null); setValidation(null); }}
              validation={validation?.cert}
            />
            <CertUploadZone
              label="Private Key"
              description="The secret key that matches your certificate — the 'private' half. This is the most sensitive file. It's a .pem or .key file that starts with '-----BEGIN PRIVATE KEY-----' or '-----BEGIN RSA PRIVATE KEY-----'."
              file={keyFile}
              onDrop={setKeyFile}
              onClear={() => { setKeyFile(null); setValidation(null); }}
              validation={validation?.key}
            />
            <CertUploadZone
              label="CA Chain / Bundle"
              description="The certificate chain from your IT team — proves the signer of your cert is trustworthy. If they gave you a file called 'ca-bundle', 'chain', 'intermediate', or 'fullchain', upload it here. Skip this if your IT team said the chain is already included in your certificate file."
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
              <Text size="sm" mt="xs">
                Right now, your OpenVox server has its own built-in certificate authority (CA)
                — think of it as a self-contained ID-card-printing office. It creates and signs
                certificates for every Puppet agent in your fleet.
              </Text>
              <Text size="sm" mt="xs">
                Many organizations require that <em>all</em> certificates chain back to the company's
                root certificate authority. This wizard makes your OpenVox CA an <strong>intermediate CA</strong>
                — it still creates certificates for agents, but those certificates are now trusted by
                your entire organization because they chain through your company's PKI.
              </Text>
            </Alert>

            {/* Mini tutorial */}
            <Card withBorder padding="md">
              <Text fw={700} mb="xs">Quick Primer: How Certificate Chains Work</Text>
              <Text size="sm" mb="xs">
                Imagine a chain of trust, like a notary system:
              </Text>
              <Card withBorder padding="xs" mb="xs" style={{ background: 'var(--mantine-color-dark-7, var(--mantine-color-gray-0))' }}>
                <Text size="sm" ta="center" style={{ fontFamily: 'monospace' }}>
                  Your Company's Root CA (the ultimate authority)
                </Text>
                <Text size="sm" ta="center" c="dimmed">signed ↓</Text>
                <Text size="sm" ta="center" style={{ fontFamily: 'monospace' }}>
                  Your Company's Intermediate CA (a delegated authority)
                </Text>
                <Text size="sm" ta="center" c="dimmed">signed ↓</Text>
                <Text size="sm" ta="center" style={{ fontFamily: 'monospace' }} fw={700} c="blue">
                  OpenVox Puppet CA (your server — what we're setting up)
                </Text>
                <Text size="sm" ta="center" c="dimmed">signs ↓</Text>
                <Text size="sm" ta="center" style={{ fontFamily: 'monospace' }}>
                  Agent Certificates (every managed server in your fleet)
                </Text>
              </Card>
              <Text size="sm">
                After this setup, every Puppet agent certificate is automatically trusted by anything
                that trusts your organization's root — corporate firewalls, monitoring systems, security
                scanners, and other infrastructure.
              </Text>
            </Card>

            {/* Step-by-step process overview */}
            <Card withBorder padding="md">
              <Text fw={700} mb="xs">How This Process Works (4 steps)</Text>
              <Stack gap="xs">
                <Group gap="xs" align="flex-start">
                  <Badge color="blue" variant="filled" circle>1</Badge>
                  <Text size="sm"><strong>We generate a "Certificate Signing Request" (CSR)</strong> — a formal request that says "please approve this CA." You don't need to know how to create this; we do it for you.</Text>
                </Group>
                <Group gap="xs" align="flex-start">
                  <Badge color="blue" variant="filled" circle>2</Badge>
                  <Text size="sm"><strong>You send the CSR to your PKI / security team</strong> — they review it, approve it, and send you back a signed certificate. This usually takes 1-5 business days.</Text>
                </Group>
                <Group gap="xs" align="flex-start">
                  <Badge color="blue" variant="filled" circle>3</Badge>
                  <Text size="sm"><strong>You also ask them for CRL files</strong> — these are "revocation lists" that track any certificates your organization has cancelled. Don't worry about the details; just ask for them.</Text>
                </Group>
                <Group gap="xs" align="flex-start">
                  <Badge color="blue" variant="filled" circle>4</Badge>
                  <Text size="sm"><strong>Upload everything here</strong> — we validate the files, install them in the right locations, and restart OpenVox Server. You're done.</Text>
                </Group>
              </Stack>
            </Card>

            {/* What to say to your PKI team */}
            <Card withBorder padding="md">
              <Text fw={700} mb="xs">Exactly What to Ask Your PKI / Security Team</Text>
              <Text size="sm" mb="xs" c="dimmed">
                Your PKI team may use different words for the same things. Here's a translation table
                so you can speak their language:
              </Text>
              <Table withTableBorder withColumnBorders>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>What you need</Table.Th>
                    <Table.Th>What to say to your PKI team</Table.Th>
                    <Table.Th>They might call it</Table.Th>
                    <Table.Th>What the file looks like</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  <Table.Tr>
                    <Table.Td><Text size="sm" fw={600}>Signed CA cert</Text></Table.Td>
                    <Table.Td><Text size="sm">"I have a CSR for an intermediate CA that needs to be signed. It needs the CA:TRUE basic constraint and keyCertSign + cRLSign key usage."</Text></Table.Td>
                    <Table.Td>
                      <Group gap={4} wrap="wrap">
                        <Badge size="xs" variant="light">"signed certificate"</Badge>
                        <Badge size="xs" variant="light">"intermediate CA cert"</Badge>
                        <Badge size="xs" variant="light">"subordinate CA"</Badge>
                        <Badge size="xs" variant="light">"issuing CA certificate"</Badge>
                      </Group>
                    </Table.Td>
                    <Table.Td><Text size="xs"><Code>.pem</Code> file starting with <Code>-----BEGIN CERTIFICATE-----</Code></Text></Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td><Text size="sm" fw={600}>Certificate chain</Text></Table.Td>
                    <Table.Td><Text size="sm">"I also need the full certificate chain — your intermediate CA cert and your root CA cert, all in one PEM file."</Text></Table.Td>
                    <Table.Td>
                      <Group gap={4} wrap="wrap">
                        <Badge size="xs" variant="light">"CA bundle"</Badge>
                        <Badge size="xs" variant="light">"chain file"</Badge>
                        <Badge size="xs" variant="light">"trust chain"</Badge>
                        <Badge size="xs" variant="light">"root + intermediate bundle"</Badge>
                        <Badge size="xs" variant="light">"ca-certificates"</Badge>
                      </Group>
                    </Table.Td>
                    <Table.Td><Text size="xs"><Code>.pem</Code> file with multiple <Code>-----BEGIN CERTIFICATE-----</Code> blocks</Text></Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td><Text size="sm" fw={600}>CRL chain</Text></Table.Td>
                    <Table.Td><Text size="sm">"And your CRL chain — the Certificate Revocation Lists for your intermediate and root CAs, concatenated in PEM format."</Text></Table.Td>
                    <Table.Td>
                      <Group gap={4} wrap="wrap">
                        <Badge size="xs" variant="light">"CRL"</Badge>
                        <Badge size="xs" variant="light">"revocation list"</Badge>
                        <Badge size="xs" variant="light">"CRL bundle"</Badge>
                        <Badge size="xs" variant="light">"CRL chain"</Badge>
                      </Group>
                    </Table.Td>
                    <Table.Td><Text size="xs"><Code>.pem</Code> file with <Code>-----BEGIN X509 CRL-----</Code> blocks</Text></Table.Td>
                  </Table.Tr>
                </Table.Tbody>
              </Table>
              <Text size="xs" c="dimmed" mt="xs">Typical turnaround: 1-5 business days. You can generate the CSR now and come back when your PKI team responds.</Text>
            </Card>

            {caStatus?.cert && (
              <Card withBorder padding="sm">
                <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb={4}>Current CA Certificate</Text>
                <CertDetails cert={caStatus.cert} />
                {caStatus.is_intermediate && <Badge color="blue" variant="light" mt="xs">Intermediate CA</Badge>}
              </Card>
            )}

            <Group justify="flex-end">
              <Button onClick={() => setStep(1)}>Next: Choose Key Type</Button>
            </Group>
          </Stack>
        </Stepper.Step>

        {/* Step 1: Generate CSR */}
        <Stepper.Step label="Key Type" description="Choose encryption">
          <Stack mt="md">
            <Alert variant="light" color="blue" title="Choose a key type for your Puppet CA">
              <Text size="sm" mt="xs">
                The "key type" determines the kind of cryptography your CA will use. Think of it
                like choosing between two brands of lock — both are secure, but they have different
                strengths. OpenVox supports two types:
              </Text>
            </Alert>

            <Card withBorder padding="md">
              <Text fw={700} mb="xs">Supported Key Types</Text>
              <Table withTableBorder withColumnBorders>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Key Type</Table.Th>
                    <Table.Th>Full Name</Table.Th>
                    <Table.Th>Strengths</Table.Th>
                    <Table.Th>Best For</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  <Table.Tr style={keyType === 'rsa' ? { background: 'var(--mantine-color-blue-light)' } : undefined}>
                    <Table.Td><Badge color="blue" variant="filled">RSA 4096-bit</Badge></Table.Td>
                    <Table.Td><Text size="sm">Rivest-Shamir-Adleman</Text></Table.Td>
                    <Table.Td>
                      <Stack gap={2}>
                        <Text size="xs">Universally supported — works with everything</Text>
                        <Text size="xs">Your PKI team will almost certainly accept it</Text>
                        <Text size="xs">4096-bit keys are strong for decades</Text>
                      </Stack>
                    </Table.Td>
                    <Table.Td><Text size="sm">Most organizations, especially if you're unsure what your PKI team requires</Text></Table.Td>
                  </Table.Tr>
                  <Table.Tr style={keyType === 'ec' ? { background: 'var(--mantine-color-green-light)' } : undefined}>
                    <Table.Td><Badge color="green" variant="filled">EC P-256</Badge></Table.Td>
                    <Table.Td><Text size="sm">Elliptic Curve (ECDSA)</Text></Table.Td>
                    <Table.Td>
                      <Stack gap={2}>
                        <Text size="xs">Smaller keys, faster operations</Text>
                        <Text size="xs">Same security as RSA with less overhead</Text>
                        <Text size="xs">Modern — preferred by security-forward orgs</Text>
                      </Stack>
                    </Table.Td>
                    <Table.Td><Text size="sm">Organizations that have moved to EC, or if your PKI team specifically requests it</Text></Table.Td>
                  </Table.Tr>
                </Table.Tbody>
              </Table>

              <Alert variant="light" color="gray" mt="md" p="xs">
                <Text size="xs"><strong>Not sure which to pick?</strong> Choose RSA 4096-bit. It's the safe default that every PKI team in the world supports. You can always switch later. If your PKI team has specific requirements, they'll tell you — ask them "do you have a preference for RSA or ECDSA for intermediate CA keys?"</Text>
              </Alert>

              <Alert variant="light" color="yellow" mt="xs" p="xs">
                <Text size="xs"><strong>Note:</strong> OpenVox does not support Ed25519 keys for CA certificates. Ed25519 is only used for SSH host keys, not for the Puppet SSL infrastructure.</Text>
              </Alert>
            </Card>

            <Select
              label="Select Key Type"
              data={[
                { value: 'rsa', label: 'RSA 4096-bit (recommended — widest compatibility)' },
                { value: 'ec', label: 'EC P-256 / ECDSA (modern, faster, smaller keys)' },
              ]}
              value={keyType}
              onChange={(v) => setKeyType(v || 'rsa')}
            />
            <Button onClick={handleGenerateCSR} loading={generating}>
              Generate Certificate Request ({keyType === 'ec' ? 'EC P-256' : 'RSA 4096-bit'})
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
              description="The file your PKI team sent back after signing your CSR. It should contain your signed Puppet CA certificate AND their intermediate and root CA certificates, all in one PEM file. They may call it a 'CA bundle', 'cert chain', or 'signed intermediate'. It has multiple '-----BEGIN CERTIFICATE-----' blocks."
              file={bundleFile}
              onDrop={setBundleFile}
              onClear={() => setBundleFile(null)}
            />
            <CertUploadZone
              label="CRL Chain"
              description="Certificate Revocation Lists from your PKI team — these track any certificates your organization has cancelled. Ask for 'the CRL for your intermediate CA and root CA in PEM format'. They may call it 'CRL', 'revocation list', or 'CRL bundle'. The file contains '-----BEGIN X509 CRL-----' blocks."
              file={crlFile}
              onDrop={setCrlFile}
              onClear={() => setCrlFile(null)}
            />
            <CertUploadZone
              label="CA Private Key"
              description="If you generated the CSR in the previous step, we already have the matching private key stored securely — you can skip this. Only upload a key here if your PKI team generated the key for you, or if you used an external tool to create the CSR."
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
