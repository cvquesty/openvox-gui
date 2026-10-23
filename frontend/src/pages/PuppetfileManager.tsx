/**
 * Puppetfile Manager — Forge pin report for the control-repo Puppetfile.
 *
 * Loading the page only reads GitHub and the Forge. The file on the
 * branch changes when an admin or operator selects modules and commits.
 * The default branch is staging. Production is rejected by the API.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Title, Card, Loader, Center, Alert, Stack, Group, Text, Button,
  Badge, TextInput, Checkbox, Code, Select,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconFileCode, IconRefresh } from '@tabler/icons-react';
import { puppetfile } from '../services/api';
import { useAuth } from '../hooks/AuthContext';
import { OpsTable, OpsColumn } from '../components/OpsTable';

type ModuleRow = {
  slug: string;
  pinned: string;
  latest: string | null;
  status: string;
};

type Report = {
  repo: string;
  branch: string;
  path: string;
  sha: string;
  html_url: string;
  modules: ModuleRow[];
  git_modules: string[];
  behind: number;
};

type RepoChoice = {
  repo: string;
  label: string;
};

type Connection = {
  repo: string;
  branch: string;
  path: string;
  token_set: boolean;
  repositories: RepoChoice[];
};

function statusColor(status: string): string {
  if (status === 'update') return 'yellow';
  if (status === 'current') return 'green';
  return 'red';
}

export function PuppetfileManagerPage() {
  const { user } = useAuth();
  const canWrite = user?.role === 'admin' || user?.role === 'operator';
  const [connection, setConnection] = useState<Connection | null>(null);
  const [repositories, setRepositories] = useState<RepoChoice[]>([
    { repo: 'xai-org/itsys-control_repo', label: 'xai-org/itsys-control_repo' },
  ]);
  const [repo, setRepo] = useState('xai-org/itsys-control_repo');
  const [branch, setBranch] = useState('staging');
  const [path, setPath] = useState('Puppetfile');
  const [token, setToken] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState('');

  const loadSettings = useCallback(async () => {
    const saved = await puppetfile.settings();
    const choices = saved.repositories?.length
      ? saved.repositories
      : [{ repo: 'xai-org/itsys-control_repo', label: 'xai-org/itsys-control_repo' }];
    setRepositories(choices);
    setConnection(saved);
    setRepo(saved.repo || choices[0].repo);
    setBranch(saved.branch || 'staging');
    setPath(saved.path || 'Puppetfile');
  }, []);

  const resolve = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const next = await puppetfile.report();
      setReport(next);
      setSelected([]);
    } catch (err) {
      setReport(null);
      setError(err instanceof Error ? err.message : 'Could not resolve the Puppetfile');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings().catch((err) => {
      setError(err instanceof Error ? err.message : 'Could not load settings');
    });
  }, [loadSettings]);

  async function saveSettings() {
    setSaving(true);
    setError('');
    try {
      const saved = await puppetfile.saveSettings({
        repo: repo.trim(),
        branch: branch.trim() || 'staging',
        path: path.trim() || 'Puppetfile',
        token: token.trim() ? token.trim() : undefined,
      });
      if (saved.repositories?.length) setRepositories(saved.repositories);
      setConnection(saved);
      setRepo(saved.repo || repositories[0]?.repo || 'xai-org/itsys-control_repo');
      setToken('');
      notifications.show({ color: 'green', message: 'Puppetfile connection saved' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save settings');
    } finally {
      setSaving(false);
    }
  }

  async function commitSelected() {
    if (!report || selected.length === 0) return;
    setCommitting(true);
    setError('');
    try {
      const result = await puppetfile.commit({ slugs: selected, sha: report.sha });
      notifications.show({
        color: 'green',
        message: `Committed ${result.changed} pin(s) to ${result.branch}`,
      });
      await resolve();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Commit failed');
    } finally {
      setCommitting(false);
    }
  }

  const columns: OpsColumn<ModuleRow>[] = useMemo(() => [
    {
      key: 'pick',
      header: '',
      width: 48,
      render: (row) => (
        <Checkbox
          aria-label={`Update ${row.slug}`}
          checked={selected.includes(row.slug)}
          disabled={!canWrite || row.status !== 'update'}
          onChange={(event) => {
            const on = event.currentTarget.checked;
            setSelected((prev) => (
              on ? [...prev, row.slug] : prev.filter((slug) => slug !== row.slug)
            ));
          }}
        />
      ),
    },
    {
      key: 'slug',
      header: 'Module',
      sortable: true,
      sortValue: (row) => row.slug,
      render: (row) => <Text ff="monospace" size="sm">{row.slug}</Text>,
    },
    {
      key: 'pinned',
      header: 'Pinned',
      sortable: true,
      sortValue: (row) => row.pinned,
      render: (row) => <Code>{row.pinned}</Code>,
    },
    {
      key: 'latest',
      header: 'Latest',
      sortable: true,
      sortValue: (row) => row.latest || '',
      render: (row) => <Code>{row.latest || '—'}</Code>,
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      sortValue: (row) => row.status,
      render: (row) => (
        <Badge color={statusColor(row.status)} variant="light">{row.status}</Badge>
      ),
    },
  ], [canWrite, selected]);

  const behind = report?.modules.filter((row) => row.status === 'update') ?? [];

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end">
        <div>
          <Group gap="sm">
            <IconFileCode size={26} />
            <Title order={2}>Puppetfile Manager</Title>
          </Group>
          <Text c="dimmed" size="sm" mt={4}>
            Resolves Forge pins on the control-repo branch. Nothing is written until you commit.
          </Text>
        </div>
        <Button
          leftSection={<IconRefresh size={16} />}
          onClick={() => resolve()}
          loading={loading}
          disabled={!connection?.token_set || !connection.repo}
        >
          Resolve
        </Button>
      </Group>

      {error && <Alert color="red" title="Puppetfile">{error}</Alert>}

      <Card withBorder>
        <Stack gap="sm">
          <Text fw={600}>GitHub</Text>
          <Text size="sm" c="dimmed">
            A fine-grained token needs Contents read and write on this repository.
            The token is stored encrypted and is not shown again.
            Commits go to staging. Promote that branch to production with the usual pull request.
          </Text>
          <Group grow align="flex-end">
            <Select
              label="Repository"
              description="Control repos from r10k. More than one becomes a choice."
              data={repositories.map((item) => ({ value: item.repo, label: item.label }))}
              value={repo}
              onChange={(value) => setRepo(value || repositories[0]?.repo || '')}
              allowDeselect={false}
              disabled={!canWrite}
            />
            <TextInput
              label="Branch"
              value={branch}
              onChange={(event) => setBranch(event.currentTarget.value)}
              disabled={!canWrite}
            />
            <TextInput
              label="Path"
              value={path}
              onChange={(event) => setPath(event.currentTarget.value)}
              disabled={!canWrite}
            />
          </Group>
          <TextInput
            label={connection?.token_set ? 'Token (saved — enter a new one to replace it)' : 'Token'}
            placeholder="github_pat_..."
            type="password"
            value={token}
            onChange={(event) => setToken(event.currentTarget.value)}
            disabled={!canWrite}
          />
          {canWrite && (
            <Group>
              <Button onClick={saveSettings} loading={saving}>Save connection</Button>
              {connection?.token_set && <Badge color="green" variant="light">Token saved</Badge>}
            </Group>
          )}
        </Stack>
      </Card>

      {loading && !report && <Center><Loader /></Center>}

      {report && (
        <Card withBorder>
          <Stack gap="sm">
            <Group justify="space-between">
              <Text size="sm">
                <Code>{report.repo}</Code> <Code>{report.branch}</Code> <Code>{report.path}</Code>
              </Text>
              <Badge color={report.behind ? 'yellow' : 'green'} variant="light">
                {report.behind} to update
              </Badge>
            </Group>
            {report.git_modules.length > 0 && (
              <Text size="sm" c="dimmed">
                Git modules are not on the Forge and are left unchanged: {report.git_modules.join(', ')}
              </Text>
            )}
            <OpsTable columns={columns} data={report.modules} rowKey={(row) => row.slug} />
            {canWrite && (
              <Group>
                <Button
                  color="orange"
                  loading={committing}
                  disabled={selected.length === 0}
                  onClick={commitSelected}
                >
                  Commit {selected.length || ''} selected to {report.branch}
                </Button>
                <Button
                  variant="default"
                  disabled={behind.length === 0}
                  onClick={() => setSelected(behind.map((row) => row.slug))}
                >
                  Select all behind
                </Button>
              </Group>
            )}
            <Alert color="yellow" title="This commit does not deploy">
              The commit updates the branch on GitHub. Compilers pick it up when r10k deploys that
              branch. A newer Forge release can change module behavior. Read each selected row first.
            </Alert>
          </Stack>
        </Card>
      )}
    </Stack>
  );
}
