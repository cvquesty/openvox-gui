/**
 * ExecutionHistory component - displays a scrollable list of all commands, tasks,
 * and plans executed in the last 14 days.
 */
import { useState, useEffect } from 'react';
import { 
  Table, 
  ScrollArea, 
  Badge, 
  Text, 
  ActionIcon,
  Tooltip,
  Group,
  Select,
  NumberInput,
  Button,
  Loader,
  Alert,
  Card,
  Stack,
  Title,
  Modal,
  Code,
  Flex,
  Paper,
  Divider,
  Box
} from '@mantine/core';
import { 
  IconRefresh, 
  IconTrash, 
  IconAlertCircle,
  IconCircleCheck,
  IconClock,
  IconPlayerPlay,
  IconX,
  IconEye,
  IconFilter,
  IconHistory
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { executionHistory, ExecutionHistoryEntry } from '../services/api';

export function ExecutionHistory() {
  const [history, setHistory] = useState<ExecutionHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<ExecutionHistoryEntry | null>(null);
  
  // Filters
  const [filterDays, setFilterDays] = useState(14);
  const [filterType, setFilterType] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [filterNode, setFilterNode] = useState<string | null>(null);
  
  // Auto-refresh
  const [autoRefresh, setAutoRefresh] = useState(true);

  const loadHistory = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await executionHistory.getHistory({
        days: filterDays,
        execution_type: filterType || undefined,
        status: filterStatus || undefined,
        node_name: filterNode || undefined,
        limit: 500
      });
      setHistory(data);
    } catch (err: any) {
      setError(err.message);
      notifications.show({
        title: 'Error loading execution history',
        message: err.message,
        color: 'red',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
    
    // Auto-refresh every 10 seconds if enabled
    let interval: NodeJS.Timeout;
    if (autoRefresh) {
      interval = setInterval(loadHistory, 10000);
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [filterDays, filterType, filterStatus, filterNode, autoRefresh]);

  const formatDuration = (ms?: number) => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}min`;
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    if (diffMins < 10080) return `${Math.floor(diffMins / 1440)}d ago`;
    
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'success':
        return <Badge color="green" leftSection={<IconCircleCheck size={14} />}>Success</Badge>;
      case 'failure':
        return <Badge color="red" leftSection={<IconX size={14} />}>Failed</Badge>;
      case 'running':
        return <Badge color="blue" leftSection={<IconPlayerPlay size={14} />}>Running</Badge>;
      default:
        return <Badge color="gray" leftSection={<IconClock size={14} />}>Queued</Badge>;
    }
  };

  const getExecutionName = (entry: ExecutionHistoryEntry) => {
    switch (entry.execution_type) {
      case 'command':
        return entry.command_name || 'Unknown command';
      case 'task':
        return entry.task_name || 'Unknown task';
      case 'plan':
        return entry.plan_name || 'Unknown plan';
      default:
        return 'Unknown';
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await executionHistory.deleteEntry(id);
      notifications.show({
        title: 'Entry deleted',
        message: 'Execution history entry has been removed',
        color: 'green',
      });
      loadHistory();
    } catch (err: any) {
      notifications.show({
        title: 'Error deleting entry',
        message: err.message,
        color: 'red',
      });
    }
  };

  // Get unique nodes for filter dropdown
  const uniqueNodes = Array.from(new Set(history.map(h => h.node_name))).sort();

  return (
    <Card shadow="sm" radius="md" withBorder p="md" h="100%">
      <Stack gap="sm" h="100%">
        {/* Header */}
        <Group justify="space-between">
          <Group>
            <IconHistory size={24} />
            <Title order={4}>Execution History</Title>
            <Badge variant="light">{history.length} entries</Badge>
          </Group>
          <Group>
            <Tooltip label={autoRefresh ? "Auto-refresh enabled (10s)" : "Auto-refresh disabled"}>
              <ActionIcon 
                variant={autoRefresh ? "filled" : "default"}
                onClick={() => setAutoRefresh(!autoRefresh)}
              >
                <IconRefresh size={16} />
              </ActionIcon>
            </Tooltip>
            <ActionIcon onClick={loadHistory} disabled={loading}>
              <IconRefresh size={16} />
            </ActionIcon>
          </Group>
        </Group>

        {/* Filters */}
        <Paper p="xs" withBorder>
          <Group gap="xs">
            <IconFilter size={16} />
            <NumberInput
              value={filterDays}
              onChange={(val) => setFilterDays(val as number)}
              min={1}
              max={90}
              placeholder="Days"
              size="xs"
              w={80}
            />
            <Select
              value={filterType}
              onChange={setFilterType}
              placeholder="All types"
              size="xs"
              w={120}
              clearable
              data={[
                { value: 'command', label: 'Commands' },
                { value: 'task', label: 'Tasks' },
                { value: 'plan', label: 'Plans' },
              ]}
            />
            <Select
              value={filterStatus}
              onChange={setFilterStatus}
              placeholder="All statuses"
              size="xs"
              w={120}
              clearable
              data={[
                { value: 'success', label: 'Success' },
                { value: 'failure', label: 'Failed' },
                { value: 'running', label: 'Running' },
                { value: 'queued', label: 'Queued' },
              ]}
            />
            <Select
              value={filterNode}
              onChange={setFilterNode}
              placeholder="All nodes"
              size="xs"
              w={200}
              clearable
              searchable
              data={uniqueNodes}
            />
          </Group>
        </Paper>

        {/* Table */}
        <Box style={{ flex: 1, minHeight: 0 }}>
          <ScrollArea h="100%" offsetScrollbars scrollbarSize={8}>
            {loading && !history.length ? (
              <Flex align="center" justify="center" h={200}>
                <Loader size="lg" />
              </Flex>
            ) : error ? (
              <Alert icon={<IconAlertCircle />} color="red">
                {error}
              </Alert>
            ) : history.length === 0 ? (
              <Alert icon={<IconHistory />} color="gray">
                No execution history found for the selected filters
              </Alert>
            ) : (
              <Table highlightOnHover striped>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Time</Table.Th>
                    <Table.Th>Type</Table.Th>
                    <Table.Th>Name</Table.Th>
                    <Table.Th>Node/Target</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>Duration</Table.Th>
                    <Table.Th>User</Table.Th>
                    <Table.Th>Actions</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {history.map((entry) => (
                    <Table.Tr key={entry.id}>
                      <Table.Td>
                        <Tooltip label={new Date(entry.executed_at).toLocaleString()}>
                          <Text size="sm">{formatDate(entry.executed_at)}</Text>
                        </Tooltip>
                      </Table.Td>
                      <Table.Td>
                        <Badge size="sm" variant="light">
                          {entry.execution_type}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" fw={500}>
                          {getExecutionName(entry)}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" c="dimmed">
                          {entry.node_name}
                        </Text>
                      </Table.Td>
                      <Table.Td>{getStatusBadge(entry.status)}</Table.Td>
                      <Table.Td>
                        <Text size="sm">{formatDuration(entry.duration_ms)}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" c="dimmed">
                          {entry.executed_by}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={4}>
                          <Tooltip label="View details">
                            <ActionIcon 
                              size="sm" 
                              variant="subtle"
                              onClick={() => setSelectedEntry(entry)}
                            >
                              <IconEye size={16} />
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip label="Delete">
                            <ActionIcon 
                              size="sm" 
                              variant="subtle" 
                              color="red"
                              onClick={() => handleDelete(entry.id)}
                            >
                              <IconTrash size={16} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </ScrollArea>
        </Box>
      </Stack>

      {/* Detail Modal */}
      <Modal
        opened={!!selectedEntry}
        onClose={() => setSelectedEntry(null)}
        title="Execution Details"
        size="lg"
      >
        {selectedEntry && (
          <Stack gap="md">
            <Group justify="space-between">
              <Text fw={500}>Type:</Text>
              <Badge>{selectedEntry.execution_type}</Badge>
            </Group>
            
            <Group justify="space-between">
              <Text fw={500}>Name:</Text>
              <Text>{getExecutionName(selectedEntry)}</Text>
            </Group>
            
            <Group justify="space-between">
              <Text fw={500}>Node/Target:</Text>
              <Text>{selectedEntry.node_name}</Text>
            </Group>
            
            <Group justify="space-between">
              <Text fw={500}>Status:</Text>
              {getStatusBadge(selectedEntry.status)}
            </Group>
            
            <Group justify="space-between">
              <Text fw={500}>Executed:</Text>
              <Text>{new Date(selectedEntry.executed_at).toLocaleString()}</Text>
            </Group>
            
            <Group justify="space-between">
              <Text fw={500}>Duration:</Text>
              <Text>{formatDuration(selectedEntry.duration_ms)}</Text>
            </Group>
            
            <Group justify="space-between">
              <Text fw={500}>User:</Text>
              <Text>{selectedEntry.executed_by}</Text>
            </Group>
            
            {selectedEntry.parameters && Object.keys(selectedEntry.parameters).length > 0 && (
              <>
                <Divider />
                <Text fw={500}>Parameters:</Text>
                <Code block>{JSON.stringify(selectedEntry.parameters, null, 2)}</Code>
              </>
            )}
            
            {selectedEntry.error_message && (
              <>
                <Divider />
                <Text fw={500} c="red">Error:</Text>
                <Code block color="red">{selectedEntry.error_message}</Code>
              </>
            )}
            
            {selectedEntry.result_preview && (
              <>
                <Divider />
                <Text fw={500}>Result Preview:</Text>
                <Code block>{selectedEntry.result_preview}</Code>
                <Text size="xs" c="dimmed">First 500 characters</Text>
              </>
            )}
          </Stack>
        )}
      </Modal>
    </Card>
  );
}