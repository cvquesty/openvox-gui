/**
 * OpenVox GUI - Provisioning.tsx
 *
 * Infrastructure → Provisioning (port of openvox-ovbuilder). Builds a
 * machine through a provider (VMware vCenter today; bare metal is issue
 * #173), applies its network identity on first boot, verifies and signs
 * its CSR, and hands it to the classifier. Admin/operator only; connections
 * and guest defaults are admin only.
 */
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Alert, Button, Tabs } from '@mantine/core';
import { IconAlertTriangle, IconLock } from '@tabler/icons-react';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../components/StateComponents';
import { BuildForm } from '../components/provisioning/BuildForm';
import { BuildJobs } from '../components/provisioning/BuildJobs';
import { MachinesPanel } from '../components/provisioning/MachinesPanel';
import { SettingsPanel } from '../components/provisioning/SettingsPanel';
import { useAuth } from '../hooks/AuthContext';
import { provisioning, type ProvisioningStatus } from '../services/api';

export function ProvisioningPage() {
  const { user } = useAuth();
  const role = user?.role;
  const canBuild = role === 'admin' || role === 'operator';
  const isAdmin = role === 'admin';
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'build';
  const jobId = params.get('job');
  const [status, setStatus] = useState<ProvisioningStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await provisioning.status());
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { if (canBuild) loadStatus(); }, [canBuild, loadStatus]);

  const go = (next: Record<string, string | null>) => {
    const merged = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) merged.set(k, v); else merged.delete(k);
    }
    setParams(merged, { replace: true });
  };

  if (!canBuild) {
    return (
      <EmptyState
        icon={<IconLock size={40} stroke={1.25} />}
        title="Provisioning needs the operator or admin role"
        description="Building a machine creates it in the provider and adds it to the trusted fleet."
      />
    );
  }
  if (error) return <ErrorState message={error} onRetry={loadStatus} />;
  if (!status) return <LoadingState label="Loading provisioning" />;

  return (
    <>
      <PageHeader
        title="Provisioning"
        description="Build a machine from a VMware template, apply its network identity on first boot, and join it to this OpenVox estate."
      />
      {status.fake_mode && (
        <Alert color="yellow" icon={<IconAlertTriangle size={16} />} mb="md" title="Fake provider (development mode)">
          OPENVOX_GUI_PROVISIONING_FAKE is on. Inventory and builds are simulated; nothing is created in VMware.
        </Alert>
      )}
      {!status.fake_mode && !status.pyvmomi_installed && (
        <Alert color="red" mb="md" title="pyvmomi is not installed">
          Install it into the GUI virtualenv (it is listed in backend/requirements.txt) and restart the service.
        </Alert>
      )}
      {status.runner === 'worker' && !status.worker.alive && (
        <Alert color="orange" icon={<IconAlertTriangle size={16} />} mb="md" title="The provisioner service is not running">
          Builds are queued but nothing will run them. Start it with
          {' '}<code>sudo systemctl enable --now openvox-gui-provisioner</code>.
        </Alert>
      )}
      {!status.configured && (
        <Alert color="blue" mb="md" title="No provider connection is ready">
          {isAdmin ? (
            <Button size="xs" variant="light" onClick={() => go({ tab: 'settings' })}>Open Provisioning settings</Button>
          ) : 'Ask an admin to add a vCenter connection on the Provisioning settings tab.'}
        </Alert>
      )}
      <Tabs value={tab} onChange={(v) => go({ tab: v })} keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="build">Build</Tabs.Tab>
          <Tabs.Tab value="jobs">Builds</Tabs.Tab>
          <Tabs.Tab value="machines">Machines</Tabs.Tab>
          {isAdmin && <Tabs.Tab value="settings">Settings</Tabs.Tab>}
        </Tabs.List>
        <Tabs.Panel value="build">
          {status.configured ? (
            <BuildForm status={status} onSubmitted={(id) => go({ tab: 'jobs', job: id })} />
          ) : null}
        </Tabs.Panel>
        <Tabs.Panel value="jobs">
          <BuildJobs selectedId={jobId} onSelect={(id) => go({ job: id })} />
        </Tabs.Panel>
        <Tabs.Panel value="machines">
          <MachinesPanel isAdmin={isAdmin} />
        </Tabs.Panel>
        {isAdmin && (
          <Tabs.Panel value="settings">
            <SettingsPanel status={status} onSaved={loadStatus} />
          </Tabs.Panel>
        )}
      </Tabs>
    </>
  );
}
