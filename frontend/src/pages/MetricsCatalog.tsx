/**
 * OpenVox GUI - MetricsCatalog.tsx
 *
 * Catalog Graph — two views:
 *   1. Class Hierarchy: tree showing which classes include/contain other
 *      classes, visualizing the Puppet role → profile → module structure.
 *   2. Dependency Graph: full resource dependency graph with requires/
 *      before/notifies/subscribes edges.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Title, Card, Stack, Group, Text, Badge, Loader, Center, Alert,
  Select, Paper, Tabs,
} from '@mantine/core';
import { IconSitemap } from '@tabler/icons-react';
import {
  ReactFlow, Background, Controls, MiniMap, MarkerType,
  type Node as FlowNode, type Edge as FlowEdge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import { metrics, nodes } from '../services/api';

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
  Stage: '#6c757d',
};

const EDGE_COLORS: Record<string, string> = {
  includes: '#3498db',
  contains: '#556677',
  before: '#0D6EFD',
  requires: '#2ecc71',
  'required-by': '#27ae60',
  notifies: '#e67e22',
  'subscription-of': '#9b59b6',
};

function getTypeColor(type: string): string {
  return TYPE_COLORS[type] || '#6c757d';
}

function buildFlowGraph(
  resources: any[],
  edges: any[],
  classHierarchy: any[],
  mode: 'hierarchy' | 'dependencies',
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', nodesep: 30, ranksep: 50, marginx: 20, marginy: 20 });

  let filteredResources: any[];
  let filteredEdges: any[];

  if (mode === 'hierarchy') {
    // Use pre-computed class_hierarchy edges (built from tags on the backend)
    filteredResources = resources.filter(r => r.type === 'Class');
    filteredEdges = classHierarchy;
  } else {
    // All resources, non-contains edges
    filteredResources = resources;
    filteredEdges = edges.filter(e => e.relationship !== 'contains');
  }

  if (filteredResources.length === 0) return { nodes: [], edges: [] };

  // Determine which resources are connected
  const connectedIds = new Set<string>();
  for (const e of filteredEdges) {
    connectedIds.add(e.source);
    connectedIds.add(e.target);
  }

  // For hierarchy mode, include all classes even if unconnected
  // For dependency mode, only show connected resources
  const visibleResources = mode === 'hierarchy'
    ? filteredResources
    : filteredResources.filter(r => connectedIds.has(r.id));

  const nodeWidth = mode === 'hierarchy' ? 220 : 180;
  const nodeHeight = mode === 'hierarchy' ? 50 : 40;

  for (const r of visibleResources) {
    g.setNode(r.id, { width: nodeWidth, height: nodeHeight });
  }
  for (const e of filteredEdges) {
    if (g.hasNode(e.source) && g.hasNode(e.target)) {
      g.setEdge(e.source, e.target);
    }
  }

  dagre.layout(g);

  const flowNodes: FlowNode[] = visibleResources.map((r) => {
    const pos = g.node(r.id);
    const isClass = r.type === 'Class';
    const displayTitle = isClass ? r.title : `${r.type}[${r.title}]`;
    // Color classes by depth: roles=darker, profiles=medium, modules=lighter
    let classColor = getTypeColor(r.type);
    if (isClass && mode === 'hierarchy') {
      if (r.title.match(/^Role/i)) classColor = '#e74c3c';
      else if (r.title.match(/^Profile/i)) classColor = '#e67e22';
      else if (r.title === 'main' || r.title === 'Settings') classColor = '#95a5a6';
    }

    return {
      id: r.id,
      position: { x: (pos?.x ?? 0) - nodeWidth / 2, y: (pos?.y ?? 0) - nodeHeight / 2 },
      data: {
        label: (
          <div style={{ fontSize: mode === 'hierarchy' ? 12 : 11, lineHeight: 1.4, textAlign: 'center', padding: '6px 8px' }}>
            {isClass && mode === 'hierarchy' ? (
              <div style={{ fontWeight: 700, color: '#FFFFFF', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: nodeWidth - 20 }}>
                {r.title}
              </div>
            ) : (
              <>
                <div style={{ fontWeight: 800, color: '#FFFFFF', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.85 }}>{r.type}</div>
                <div style={{ fontWeight: 500, color: '#FFFFFF', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: nodeWidth - 20 }}>
                  {r.title}
                </div>
              </>
            )}
          </div>
        ),
      },
      style: {
        width: nodeWidth,
        borderRadius: 8,
        border: `2px solid ${classColor}`,
        backgroundColor: classColor,
        color: '#FFFFFF',
        fontSize: 11,
        padding: 0,
        boxShadow: `0 3px 12px ${classColor}55`,
      },
    };
  });

  const flowEdges: FlowEdge[] = filteredEdges
    .filter(e => g.hasNode(e.source) && g.hasNode(e.target))
    .map((e, i) => ({
      id: `e-${i}`,
      source: e.source,
      target: e.target,
      label: mode === 'dependencies' ? e.relationship : undefined,
      labelStyle: { fontSize: 9, fill: '#555', fontWeight: 500 },
      labelBgStyle: { fill: '#ffffff', fillOpacity: 0.9 },
      labelBgPadding: [4, 2] as [number, number],
      markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLORS[e.relationship] || '#6c757d' },
      style: {
        stroke: EDGE_COLORS[e.relationship] || '#6c757d',
        strokeWidth: mode === 'hierarchy' ? 2 : 1.5,
      },
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
  const [mode, setMode] = useState<string>('hierarchy');

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
    if (!catalogData?.resources) return { nodes: [], edges: [] };
    return buildFlowGraph(
      catalogData.resources,
      catalogData.edges || [],
      catalogData.class_hierarchy || [],
      mode as 'hierarchy' | 'dependencies',
    );
  }, [catalogData, mode]);

  // Stats
  const classCount = catalogData?.resources?.filter((r: any) => r.type === 'Class').length || 0;
  const resourceCount = catalogData?.resource_count || 0;

  // Unique types for legend
  const legendItems = useMemo(() => {
    if (mode === 'hierarchy') {
      return [
        { label: 'Role', color: '#e74c3c' },
        { label: 'Profile', color: '#e67e22' },
        { label: 'Module Class', color: '#0D6EFD' },
        { label: 'Internal', color: '#95a5a6' },
      ];
    }
    const types = new Set<string>();
    flowNodes.forEach(n => {
      const border = n.style?.border;
      if (typeof border === 'string') {
        const typeMatch = String((n.data as any)?.label?.props?.children?.[0]?.props?.children || '');
        if (typeMatch) types.add(typeMatch);
      }
    });
    return [...types].map(t => ({ label: t, color: getTypeColor(t) }));
  }, [flowNodes, mode]);

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
              <Badge variant="light" color="blue" size="lg">{classCount} classes</Badge>
              <Badge variant="light" color="cyan" size="lg">{resourceCount} resources</Badge>
            </Group>
          )}
        </Group>
      </Card>

      {error && <Alert color="red" title="Error">{error}</Alert>}
      {loading && <Center h={400}><Loader size="xl" /></Center>}

      {catalogData && (
        <>
          <Tabs value={mode} onChange={(v) => setMode(v || 'hierarchy')}>
            <Tabs.List>
              <Tabs.Tab value="hierarchy">Class Hierarchy</Tabs.Tab>
              <Tabs.Tab value="dependencies">Resource Dependencies</Tabs.Tab>
            </Tabs.List>
          </Tabs>

          {/* Legend */}
          <Paper withBorder p="xs">
            <Group gap="md" wrap="wrap">
              <Text size="xs" fw={600} c="dimmed">
                {mode === 'hierarchy' ? 'Class Types:' : 'Resource Types:'}
              </Text>
              {mode === 'hierarchy' ? (
                <>
                  {legendItems.map(item => (
                    <Group key={item.label} gap={4}>
                      <div style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: item.color }} />
                      <Text size="xs">{item.label}</Text>
                    </Group>
                  ))}
                </>
              ) : (
                <>
                  {Object.entries(TYPE_COLORS).slice(0, 8).map(([type, color]) => (
                    <Group key={type} gap={4}>
                      <div style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: color }} />
                      <Text size="xs">{type}</Text>
                    </Group>
                  ))}
                </>
              )}
              {mode === 'dependencies' && (
                <>
                  <Text size="xs" c="dimmed" ml="md">Edges:</Text>
                  {Object.entries(EDGE_COLORS).filter(([k]) => k !== 'contains').map(([rel, color]) => (
                    <Group key={rel} gap={4}>
                      <div style={{ width: 16, height: 2, backgroundColor: color }} />
                      <Text size="xs">{rel}</Text>
                    </Group>
                  ))}
                </>
              )}
            </Group>
          </Paper>

          {/* Graph */}
          {flowNodes.length > 0 ? (
            <Card withBorder shadow="sm" padding={0} style={{ height: 'calc(100vh - 280px)', minHeight: 500 }}>
              <ReactFlow
                nodes={flowNodes}
                edges={flowEdges}
                fitView
                fitViewOptions={{ padding: 0.08, maxZoom: 1.5 }}
                minZoom={0.02}
                maxZoom={3}
                nodesDraggable
                nodesConnectable={false}
                elementsSelectable
              >
                <Background gap={24} size={1} color="#e8ecf0" />
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
                  style={{ backgroundColor: '#f5f5f5', border: '1px solid #ddd' }}
                />
              </ReactFlow>
            </Card>
          ) : (
            <Alert color="yellow">
              {mode === 'hierarchy'
                ? 'No class containment relationships found in this catalog.'
                : 'No dependency relationships found (all edges are containment edges).'}
            </Alert>
          )}
        </>
      )}
    </Stack>
  );
}
