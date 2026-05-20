/**
 * OpenVox GUI - MetricsCatalog.tsx
 *
 * Catalog Graph — select a node to view its compiled catalog as a
 * hierarchical list grouped by resource type. Each resource shows its
 * type[title] and lists its dependency edges. Includes resource_count
 * and edge_count stats.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Title, Card, Stack, Group, Text, Badge, Loader, Center, Alert,
  Select, Table, ScrollArea, Grid, Paper, Collapse, ActionIcon,
} from '@mantine/core';
import {
  IconSitemap, IconChevronDown, IconChevronRight,
} from '@tabler/icons-react';
import { metrics, nodes } from '../services/api';

const COLORS = ['#0D6EFD', '#28a745', '#dc3545', '#ffc107', '#6c757d', '#17a2b8', '#fd7e14', '#6f42c1'];

interface CatalogResource {
  id: string;
  type: string;
  title: string;
}

interface CatalogEdge {
  source: string;
  target: string;
  relationship: string;
}

interface CatalogData {
  certname: string;
  resources: CatalogResource[];
  edges: CatalogEdge[];
  resource_count: number;
  edge_count: number;
}

function ResourceTypeGroup({
  type,
  resources,
  edgesBySource,
}: {
  type: string;
  resources: CatalogResource[];
  edgesBySource: Record<string, CatalogEdge[]>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Paper withBorder p="xs" radius="sm">
      <Group
        justify="space-between"
        style={{ cursor: 'pointer' }}
        onClick={() => setOpen((o) => !o)}
      >
        <Group gap="xs">
          <ActionIcon variant="subtle" size="sm">
            {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          </ActionIcon>
          <Text fw={600} size="sm">{type}</Text>
          <Badge variant="light" color="blue" size="sm">{resources.length}</Badge>
        </Group>
      </Group>
      <Collapse in={open}>
        <Table striped highlightOnHover withTableBorder mt="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Resource</Table.Th>
              <Table.Th>Dependencies</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {resources.map((res) => {
              const deps = edgesBySource[res.id] || [];
              return (
                <Table.Tr key={res.id}>
                  <Table.Td>
                    <Text size="sm" fw={500}>
                      {res.type}[{res.title}]
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    {deps.length === 0 ? (
                      <Text size="xs" c="dimmed">None</Text>
                    ) : (
                      <Stack gap={2}>
                        {deps.map((edge, idx) => (
                          <Group gap={4} key={idx}>
                            <Badge size="xs" variant="outline" color="gray">{edge.relationship}</Badge>
                            <Text size="xs">{edge.target}</Text>
                          </Group>
                        ))}
                      </Stack>
                    )}
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Collapse>
    </Paper>
  );
}

export function MetricsCatalogPage() {
  const [nodeList, setNodeList] = useState<any[]>([]);
  const [nodesLoading, setNodesLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [data, setData] = useState<CatalogData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load node list for dropdown
  useEffect(() => {
    nodes.list()
      .then((result) => {
        const list = Array.isArray(result) ? result : [];
        setNodeList(list);
      })
      .catch((e: any) => setError('Failed to load node list: ' + e.message))
      .finally(() => setNodesLoading(false));
  }, []);

  const fetchCatalog = useCallback(async (certname: string) => {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const result = await metrics.catalog(certname);
      setData(result);
    } catch (e: any) {
      setError(e.message || 'Failed to load catalog');
    }
    setLoading(false);
  }, []);

  const handleNodeSelect = (certname: string | null) => {
    setSelectedNode(certname);
    if (certname) fetchCatalog(certname);
  };

  // Group resources by type
  const groupedResources: Record<string, CatalogResource[]> = {};
  const edgesBySource: Record<string, CatalogEdge[]> = {};

  if (data) {
    for (const res of data.resources || []) {
      if (!groupedResources[res.type]) groupedResources[res.type] = [];
      groupedResources[res.type].push(res);
    }
    for (const edge of data.edges || []) {
      if (!edgesBySource[edge.source]) edgesBySource[edge.source] = [];
      edgesBySource[edge.source].push(edge);
    }
  }

  const sortedTypes = Object.keys(groupedResources).sort();

  const nodeOptions = nodeList.map((n: any) => ({
    value: n.certname,
    label: n.certname,
  }));

  return (
    <Stack>
      <Group gap="sm">
        <IconSitemap size={28} />
        <Title order={2}>Catalog Graph</Title>
      </Group>

      <Card withBorder shadow="sm" padding="lg">
        <Group align="flex-end">
          <Select
            label="Select Node"
            placeholder={nodesLoading ? 'Loading nodes...' : 'Choose a node...'}
            searchable
            data={nodeOptions}
            value={selectedNode}
            onChange={handleNodeSelect}
            disabled={nodesLoading}
            style={{ minWidth: 300 }}
          />
          {data && (
            <Group gap="sm">
              <Badge variant="light" color="blue" size="lg">{data.resource_count} resources</Badge>
              <Badge variant="light" color="cyan" size="lg">{data.edge_count} edges</Badge>
              <Badge variant="light" color="gray" size="lg">{sortedTypes.length} types</Badge>
            </Group>
          )}
        </Group>
      </Card>

      {loading && <Center h={300}><Loader size="xl" /></Center>}
      {error && <Alert color="red" title="Error">{error}</Alert>}

      {data && !loading && (
        <Card withBorder shadow="sm" padding="lg">
          <Title order={4} mb="md">
            Catalog for <Text span c="blue" inherit>{data.certname}</Text>
          </Title>

          <ScrollArea h="calc(100vh - 360px)" mih={300}>
            <Stack gap="xs">
              {sortedTypes.length === 0 ? (
                <Alert color="yellow">No resources found in catalog.</Alert>
              ) : (
                sortedTypes.map((type) => (
                  <ResourceTypeGroup
                    key={type}
                    type={type}
                    resources={groupedResources[type]}
                    edgesBySource={edgesBySource}
                  />
                ))
              )}
            </Stack>
          </ScrollArea>
        </Card>
      )}

      {!selectedNode && !loading && (
        <Alert variant="light" color="blue">
          Select a node from the dropdown above to view its compiled catalog resources
          and dependency relationships.
        </Alert>
      )}
    </Stack>
  );
}
