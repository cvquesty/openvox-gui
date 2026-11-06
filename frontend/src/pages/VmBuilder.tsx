/**
 * OpenVox GUI - VmBuilder.tsx
 *
 * VMware VM builder (port of openvox-ovbuilder): clone a vCenter template
 * with a static network identity, bootstrap it as an OpenVox agent, sign
 * its CSR and classify it. Admin/operator only; settings are admin only.
 */
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Alert, Button, Tabs } from '@mantine/core';
import { IconAlertTriangle, IconLock } from '@tabler/icons-react';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../components/StateComponents';
import { BuildForm } from '../components/vmbuilder/BuildForm';
import { BuildJobs } from '../components/vmbuilder/BuildJobs';
import { SettingsPanel } from '../components/vmbuilder/SettingsPanel';
import { useAuth } from '../hooks/AuthContext';
import { vmbuilder, type VmBuilderStatus } from '../services/api';

export function VmBuilderPage() {
  const { user } = useAuth();
  const role = user?.role;
  const canBuild = role === 'admin' || role === 'operator';
  const isAdmin = role === 'admin';
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'build';
  const jobId = params.get('job');
  const [status, setStatus] = useState<VmBuilderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await vmbuilder.status());
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
        title="VM builder needs the operator or admin role"
        description="Building a VM creates it in vCenter and adds it to the trusted fleet."
      />
    );
  }
  if (error) return <ErrorState message={error} onRetry={loadStatus} />;
  if (!status) return <LoadingState label="Loading VM builder" />;

  const s = status.settings;
  return (
    <>
      <PageHeader
        title="VM Builder"
        description="Provision a VMware VM from a vCenter template, apply its network identity on first boot, and join it to this OpenVox estate."
      />
      {s.fake_mode && (
        <Alert color="yellow" icon={<IconAlertTriangle size={16} />} mb="md" title="Fake vCenter (development mode)">
          OPENVOX_GUI_VMBUILDER_FAKE is on. Inventory and clones are simulated; nothing is created in VMware.
        </Alert>
      )}
      {!s.fake_mode && !s.pyvmomi_installed && (
        <Alert color="red" mb="md" title="pyvmomi is not installed">
          Install it into the GUI virtualenv (it is listed in backend/requirements.txt) and restart the service.
        </Alert>
      )}
      {!s.configured && (
        <Alert color="blue" mb="md" title="vCenter is not configured">
          {isAdmin ? (
            <Button size="xs" variant="light" onClick={() => go({ tab: 'settings' })}>Open VM builder settings</Button>
          ) : 'Ask an admin to set the vCenter connection on the VM builder settings tab.'}
        </Alert>
      )}
      <Tabs value={tab} onChange={(v) => go({ tab: v })} keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="build">Build</Tabs.Tab>
          <Tabs.Tab value="jobs">Builds</Tabs.Tab>
          {isAdmin && <Tabs.Tab value="settings">Settings</Tabs.Tab>}
        </Tabs.List>
        <Tabs.Panel value="build">
          {s.configured ? (
            <BuildForm status={status} onSubmitted={(id) => go({ tab: 'jobs', job: id })} />
          ) : null}
        </Tabs.Panel>
        <Tabs.Panel value="jobs">
          <BuildJobs selectedId={jobId} onSelect={(id) => go({ job: id })} />
        </Tabs.Panel>
        {isAdmin && (
          <Tabs.Panel value="settings">
            <SettingsPanel onSaved={loadStatus} />
          </Tabs.Panel>
        )}
      </Tabs>
    </>
  );
}
