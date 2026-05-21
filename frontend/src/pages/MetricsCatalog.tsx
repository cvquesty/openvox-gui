/**
 * OpenVox GUI - MetricsCatalog.tsx
 *
 * Catalog Graph — select a node to view its compiled catalog as a
 * directed dependency graph. Resources are nodes, Puppet relationships
 * (requires, before, notifies, subscribes) are directed edges.
 * Uses @xyflow/react with dagre for automatic hierarchical layout.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Title, Card, Stack, Group, Text, Badge, Loader, Center, Alert,
  Select, Paper,
} from '@mantine/core';
import { IconSitemap } from '@tabler/icons-react';
import {
  ReactFlow, Background, Controls, MiniMap, MarkerType,
  type Node as FlowNode, type Edge as FlowEdge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import { metrics, nodes } from '../services/api';

// Color by resource type
const TYPE_COLORS: Record<string, string> = {
  Class: '#0D6EFD',
  File: '#2ecc71',
  Package: '#9b59b6',
  Service: '#e67e22',
  Exec: '#e74c3c',
  User: '#1abc9c',
  Group: '#3498db',
  Cron: '#f39c12',
  Mount: '#95a5a6',
  Notify: '#fd7e14',
};

const EDGE_COLORS: Record<string, string> = {
  contains: '#95a5a6',
  before: '#0D6EFD',
  requires: '#2ecc71',
  notifies: '#e67e22',
  'subscription-of': '#9b59b6',
};

function getTypeColor(type: string): string {
  return TYPE_COLORS[type] || '#6c757d';
}

function layoutGraph(
  resources: any[],
  edges: any[],
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 60, marginx: 20, marginy: 20 });

  // Add nodes
  for (const r of resources) {
    g.setNode(r.id, { width: 200, height: 40 });
  }

  // Add edges
  for (const e of edges) {
    // Skip 'contains' edges for cleaner layout — they're structural, not dependency
    if (e.relationship === 'contains') continue;
    g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  const flowNodes: FlowNode[] = resources.map((r) => {
    const pos = g.node(r.id);
    return {
      id: r.id,
      position: { x: (pos?.x ?? 0) - 100, y: (pos?.y ?? 0) - 20 },
      data: {
        label: (
          <div style={{ fontSize: 10, lineHeight: 1.3, textAlign: 'center', padding: '2px 4px' }}>
            <div style={{ fontWeight: 700, color: getTypeColor(r.type) }}>{r.type}</div>
            <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 190 }}>
              {r.title}
            </div>
          </div>
        ),
      },
      style: {
        width: 200,
        borderRadius: 6,
        border: `2px solid ${getTypeColor(r.type)}`,
        backgroundColor: 'rgba(20, 20, 33, 0.85)',
        color: '#e0e0e0',
        fontSize: 10,
        padding: 0,
      },
    };
  });

  const flowEdges: FlowEdge[] = edges
    .filter((e) => e.relationship !== 'contains')
    .map((e, i) => ({
      id: `e-${i}`,
      source: e.source,
      target: e.target,
      label: e.relationship,
      labelStyle: { fontSize: 8, fill: '#8899aa' },
      labelBgStyle: { fill: 'rgba(20,20,33,0.8)' },
      labelBgPadding: [4, 2] as [number, number],
      markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLORS[e.relationship] || '#6c757d' },
      style: { stroke: EDGE_COLORS[e.relationship] || '#6c757d', strokeWidth: 1.5 },
      animated: e.relationship === 'notifies',
    }));

  return { nodes: flowNodes, edges: flowEdges };
}

export function MetricsCatalogPage() {
  const [nodeList, setNodeList] = useState<any[]>([]);
  const [nodesLoading, setNodesLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [catalogData, setCatalogData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    nodes.list()
      .then((result) => {
        const list = Array.isArray(result) ? result : [];
        list.sort((a: any, b: any) => (a.certname || '').localeCompare(b.certname || ''));
        setNodeList(list);
      })
      .catch((e: any) => setError('Failed to load node list: ' + e.message))
      .finally(() => setNodesLoading(false));
  }, []);

  const fetchCatalog = useCallback(async (certname: string) => {
    setLoading(true);
    setError(null);
    setCatalogData(null);
    try {
      const result = await metrics.catalog(certname);
      setCatalogData(result);
    } catch (e: any) {
      setError(e.message || 'Failed to load catalog');
    }
    setLoading(false);
  }, []);

  const handleNodeSelect = (value: string | null) => {
    setSelectedNode(value);
    if (value) fetchCatalog(value);
    else setCatalogData(null);
  };

  const { nodes: flowNodes, edges: flowEdges } = useMemo(() => {
    if (!catalogData?.resources || !catalogData?.edges) return { nodes: [], edges: [] };
    return layoutGraph(catalogData.resources, catalogData.edges);
  }, [catalogData]);

  // Count dependency edges (non-contains)
  const depEdgeCount = flowEdges.length;
  const resourceCount = catalogData?.resource_count || 0;

  // Unique types for legend
  const types = useMemo(() => {
    if (!catalogData?.resources) return [];
    const seen = new Set<string>();
    return catalogData.resources
      .map((r: any) => r.type)
      .filter((t: string) => { if (seen.has(t)) return false; seen.add(t); return true; })
      .sort();
  }, [catalogData]);

  return (
    <Stack>
      <Group gap="sm">
        <IconSitemap size={28} />
        <Title order={2}>Catalog Graph</Title>
      </Group>

      <Card withBorder shadow="sm" padding="md">
        <Group align="flex-end" gap="md">
          <Select
            label="Select a node"
            placeholder={nodesLoading ? 'Loading nodes...' : 'Choose a node to view its catalog...'}
            data={nodeList.map((n) => ({ value: n.certname, label: n.certname }))}
            value={selectedNode}
            onChange={handleNodeSelect}
            searchable
            clearable
            style={{ flex: 1, minWidth: 300 }}
            disabled={nodesLoading}
          />
          {catalogData && (
            <Group gap="xs">
              <Badge variant="light" color="blue" size="lg">{resourceCount} resources</Badge>
              <Badge variant="light" color="cyan" size="lg">{depEdgeCount} dependencies</Badge>
              <Badge variant="light" color="gray" size="lg">{types.length} types</Badge>
            </Group>
          )}
        </Group>
      </Card>

      {error && <Alert color="red" title="Error">{error}</Alert>}
      {loading && <Center h={400}><Loader size="xl" /></Center>}

      {catalogData && flowNodes.length > 0 && (
        <>
          {/* Legend */}
          <Paper withBorder p="xs">
            <Group gap="md" wrap="wrap">
              <Text size="xs" fw={600} c="dimmed">Resource Types:</Text>
              {types.map((t: string) => (
                <Group key={t} gap={4}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: getTypeColor(t) }} />
                  <Text size="xs">{t}</Text>
                </Group>
              ))}
              <Text size="xs" c="dimmed" ml="md">Edge Types:</Text>
              {Object.entries(EDGE_COLORS).filter(([k]) => k !== 'contains').map(([rel, color]) => (
                <Group key={rel} gap={4}>
                  <div style={{ width: 16, height: 2, backgroundColor: color }} />
                  <Text size="xs">{rel}</Text>
                </Group>
              ))}
            </Group>
          </Paper>

          {/* Graph */}
          <Card withBorder shadow="sm" padding={0} style={{ height: 600 }}>
            <ReactFlow
              nodes={flowNodes}
              edges={flowEdges}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              minZoom={0.1}
              maxZoom={2}
              nodesDraggable
              nodesConnectable={false}
              elementsSelectable
            >
              <Background gap={20} size={1} color="rgba(255,255,255,0.05)" />
              <Controls />
              <MiniMap
                nodeColor={(n) => {
                  const border = n.style?.border;
                  if (typeof border === 'string') {
                    const match = border.match(/#[0-9a-fA-F]{6}/);
                    return match ? match[0] : '#6c757d';
                  }
                  return '#6c757d';
                }}
                style={{ backgroundColor: 'rgba(20,20,33,0.9)' }}
              />
            </ReactFlow>
          </Card>
        </>
      )}

      {catalogData && flowNodes.length === 0 && !loading && (
        <Alert color="yellow">No dependency relationships found in this node's catalog. The catalog may only contain 'contains' edges (structural, not dependency).</Alert>
      )}
    </Stack>
  );
}
