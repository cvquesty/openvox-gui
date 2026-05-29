/**
 * OpenVox GUI - FactExplorer.tsx
 * 
 * Component documentation to be expanded.
 */
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Title, Card, Stack, Group, Text, Alert, Loader, Center,
  Table, Badge, Select, TextInput, NumberInput, ScrollArea, Grid, Tooltip, Button, Chip, Paper,
  Autocomplete, Combobox, useCombobox,
} from '@mantine/core';
import { IconSearch, IconFilter, IconInfoCircle, IconChevronUp, IconChevronDown, IconSelector, IconUsersGroup } from '@tabler/icons-react';
import { facts, enc } from '../services/api';
import { useAppTheme } from '../hooks/ThemeContext';
import { PrettyJson, isJsonLike } from '../components/PrettyJson';
import { ExportActions } from '../components/ExportActions';

/* ═══════════════════════════════════════════════════════════════
   FACT-O-SCOPE 5000 — the giant magnifying glass
   ═══════════════════════════════════════════════════════════════ */
function FactOScope() {
  return (
    <svg viewBox="0 0 520 260" width="100%" style={{ maxHeight: 280 }}>
      <defs>
        <linearGradient id="fs-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1a1b2e" />
          <stop offset="100%" stopColor="#252540" />
        </linearGradient>
      </defs>
      <rect width="520" height="260" fill="url(#fs-sky)" rx="8" />

      {/* Stars */}
      <circle cx="60" cy="25" r="1" fill="#fff" opacity="0.4" />
      <circle cx="200" cy="18" r="0.8" fill="#fff" opacity="0.3" />
      <circle cx="420" cy="30" r="1.1" fill="#fff" opacity="0.5" />
      <circle cx="480" cy="14" r="0.7" fill="#fff" opacity="0.4" />

      {/* Ground */}
      <rect x="0" y="215" width="520" height="45" fill="#1a1a2e" />
      <rect x="0" y="215" width="520" height="2" fill="#333355" />

      {/* Giant magnifying glass */}
      <circle cx="260" cy="105" r="58" fill="none" stroke="#667788" strokeWidth="4" />
      <circle cx="260" cy="105" r="53" fill="#0a1628" opacity="0.6" />
      <line x1="300" y1="148" x2="348" y2="196" stroke="#667788" strokeWidth="6" strokeLinecap="round" />
      {/* Handle grip */}
      <rect x="342" y="190" width="18" height="8" fill="#556677" rx="3" transform="rotate(45 351 194)" />

      {/* Scan ring animation */}
      <circle cx="260" cy="105" r="35" fill="none" stroke="#44aaff" strokeWidth="1" opacity="0.5">
        <animate attributeName="r" values="25;50;25" dur="3s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.5;0;0.5" dur="3s" repeatCount="indefinite" />
      </circle>

      {/* Facts floating inside the lens */}
      <text x="225" y="82" fill="#44ff88" fontSize="7" fontFamily="monospace" opacity="0.9">os.family = RedHat</text>
      <text x="230" y="95" fill="#ffaa44" fontSize="7" fontFamily="monospace" opacity="0.9">kernel = Linux</text>
      <text x="220" y="108" fill="#44aaff" fontSize="7" fontFamily="monospace" opacity="0.9">memory = 4.0 GiB</text>
      <text x="235" y="121" fill="#ff6688" fontSize="7" fontFamily="monospace" opacity="0.9">uptime = 42 days</text>
      <text x="228" y="134" fill="#aabb44" fontSize="7" fontFamily="monospace">
        ipaddr = 10.0.1.5
        <animate attributeName="opacity" values="0.9;0.4;0.9" dur="2s" repeatCount="indefinite" />
      </text>

      {/* Tiny servers being examined (left) */}
      <rect x="40" y="145" width="24" height="18" fill="#445566" rx="2" stroke="#556677" strokeWidth="1" />
      <rect x="43" y="148" width="18" height="3" rx="1" fill="#44ff44" opacity="0.6" />
      <rect x="43" y="153" width="18" height="3" rx="1" fill="#44aaff" opacity="0.6" />
      <rect x="43" y="158" width="18" height="3" rx="1" fill="#ffaa44" opacity="0.6" />
      <text x="52" y="173" textAnchor="middle" fill="#667788" fontSize="5" fontFamily="monospace">web01</text>

      <rect x="75" y="145" width="24" height="18" fill="#445566" rx="2" stroke="#556677" strokeWidth="1" />
      <rect x="78" y="148" width="18" height="3" rx="1" fill="#44ff44" opacity="0.6" />
      <rect x="78" y="153" width="18" height="3" rx="1" fill="#44aaff" opacity="0.6" />
      <rect x="78" y="158" width="18" height="3" rx="1" fill="#ffaa44" opacity="0.6" />
      <text x="87" y="173" textAnchor="middle" fill="#667788" fontSize="5" fontFamily="monospace">db01</text>

      <rect x="110" y="145" width="24" height="18" fill="#445566" rx="2" stroke="#556677" strokeWidth="1" />
      <rect x="113" y="148" width="18" height="3" rx="1" fill="#44ff44" opacity="0.6" />
      <rect x="113" y="153" width="18" height="3" rx="1" fill="#44aaff" opacity="0.6" />
      <rect x="113" y="158" width="18" height="3" rx="1" fill="#ffaa44" opacity="0.6" />
      <text x="122" y="173" textAnchor="middle" fill="#667788" fontSize="5" fontFamily="monospace">app01</text>

      {/* Analysis card (right) */}
      <rect x="400" y="80" width="95" height="70" fill="#223344" rx="4" stroke="#445566" strokeWidth="1" />
      <text x="410" y="95" fill="#888" fontSize="6" fontFamily="monospace">ANALYSIS</text>
      <line x1="405" y1="99" x2="488" y2="99" stroke="#334455" strokeWidth="0.5" />
      <text x="410" y="112" fill="#44ff88" fontSize="5" fontFamily="monospace">5 nodes scanned</text>
      <text x="410" y="122" fill="#44aaff" fontSize="5" fontFamily="monospace">125 facts found</text>
      <text x="410" y="132" fill="#ffaa44" fontSize="5" fontFamily="monospace">3 unique values</text>
      <text x="410" y="142" fill="#ff6688" fontSize="5" fontFamily="monospace">0 anomalies</text>

      {/* Label plate */}
      <rect x="195" y="188" width="130" height="16" fill="#334455" rx="2" />
      <text x="260" y="199" textAnchor="middle" fill="#EC8622" fontSize="7" fontFamily="monospace" fontWeight="bold">FACT-O-SCOPE 5000</text>

      {/* Status lights */}
      <circle cx="205" cy="210" r="3" fill="#44ff44">
        <animate attributeName="fill" values="#44ff44;#22aa22;#44ff44" dur="1.5s" repeatCount="indefinite" />
      </circle>
      <circle cx="215" cy="210" r="3" fill="#ffaa22" />
      <circle cx="225" cy="210" r="3" fill="#44aaff" />

      {/* Caption */}
      <text x="260" y="232" textAnchor="middle" fill="#8899aa" fontSize="10" fontFamily="monospace">The Fact Finder</text>
      <text x="260" y="246" textAnchor="middle" fill="#556677" fontSize="8" fontFamily="monospace">every fact. every node. every time.</text>
    </svg>
  );
}

export function FactExplorerPage() {
  const navigate = useNavigate();
  const { isFormal } = useAppTheme();
  const [factNames, setFactNames] = useState<string[]>([]);
  const [selectedFact, setSelectedFact] = useState<string | null>(null);
  const [factInput, setFactInput] = useState<string>('');
  const [factData, setFactData] = useState<any>(null);
  const [factStructure, setFactStructure] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [namesLoading, setNamesLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [filterOp, setFilterOp] = useState<string>('contains');
  const [sortField, setSortField] = useState<'certname' | 'value' | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [rowLimit, setRowLimit] = useState<number | ''>('');
  const [showStructure, setShowStructure] = useState(false);
  const [encGroups, setEncGroups] = useState<string[]>([]);
  const [nodeGroupMap, setNodeGroupMap] = useState<Record<string, string[]>>({});
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);

  useEffect(() => {
    facts.getNames(true)  // Include nested paths
      .then((names: string[]) => {
        const sorted = (Array.isArray(names) ? names : [])
          .filter((n: any) => typeof n === 'string')
          .sort();
        setFactNames(sorted);
      })
      .catch((e: any) => setError('Failed to load fact names: ' + e.message))
      .finally(() => setNamesLoading(false));
  }, []);

  useEffect(() => {
    Promise.all([enc.listGroups(), enc.listNodes()])
      .then(([groups, nodes]) => {
        setEncGroups(groups.map((g: any) => g.name).sort());
        const map: Record<string, string[]> = {};
        for (const n of nodes) {
          map[n.certname] = n.groups || [];
        }
        setNodeGroupMap(map);
      })
      .catch(() => {});
  }, []);

  const handleFactSelect = async (factName: string | null) => {
    if (!factName || factName.trim() === '') {
      setSelectedFact(null);
      setFactData(null);
      setFactStructure(null);
      setFactInput('');
      return;
    }
    
    setSelectedFact(factName);
    setFactInput(factName);
    setFactData(null);
    setFactStructure(null);
    setError(null);
    setFilter('');
    setFilterOp('contains');
    setSortField(null);
    setSortDir('asc');
    setRowLimit('');
    setShowStructure(false);
    setSelectedGroups([]);

    setLoading(true);
    try {
      const r = await facts.getByName(factName);
      setFactData(r);
      
      // If it's a base fact (no dots), also fetch structure info
      if (!factName.includes('.')) {
        try {
          const struct = await facts.getStructure(factName, 3);
          setFactStructure(struct);
        } catch (e) {
          // Structure fetch is optional, don't fail the whole operation
        }
      }
    } catch (e: any) {
      setError('Failed to load fact values: ' + e.message);
      setFactData(null);
    }
    setLoading(false);
  };

  const results = factData?.results || [];

  // Filter → Sort → Limit pipeline
  const processedResults = useMemo(() => {
    // 1. Group scope
    let rows = results;
    if (selectedGroups.length > 0) {
      rows = rows.filter((f: any) => {
        const nodeGroups = nodeGroupMap[f.certname] || [];
        if (selectedGroups.includes('__ungrouped__') && nodeGroups.length === 0) return true;
        return selectedGroups.some(sg => sg !== '__ungrouped__' && nodeGroups.includes(sg));
      });
    }

    // 2. Filter
    rows = rows.filter((f: any) => {
      if (!filter) return true;

      const valStr = typeof f.value === 'object' ? JSON.stringify(f.value) : String(f.value ?? '');
      const q = filter.trim();

      if (filterOp === 'contains') {
        const qLower = q.toLowerCase();
        return (
          (f.certname || '').toLowerCase().includes(qLower) ||
          valStr.toLowerCase().includes(qLower)
        );
      }

      // Try numeric comparison first
      const numFilter = parseFloat(q);
      const numVal = typeof f.value === 'number' ? f.value : parseFloat(valStr);

      if (!isNaN(numFilter) && !isNaN(numVal)) {
        switch (filterOp) {
          case '>':  return numVal > numFilter;
          case '>=': return numVal >= numFilter;
          case '<':  return numVal < numFilter;
          case '<=': return numVal <= numFilter;
          case '=':  return numVal === numFilter;
          case '!=': return numVal !== numFilter;
          default:   return true;
        }
      }

      // String comparison (case-insensitive + trimmed)
      const vLower = valStr.toLowerCase().trim();
      const qLower = q.toLowerCase();

      if (filterOp === '=') return vLower === qLower;
      if (filterOp === '!=') return vLower !== qLower;

      return false;
    });

    // 3. Sort
    if (sortField) {
      rows = [...rows].sort((a, b) => {
        const dir = sortDir === 'asc' ? 1 : -1;
        if (sortField === 'certname') {
          return dir * (a.certname || '').localeCompare(b.certname || '');
        }
        // Value sort: numeric-aware
        const av = a.value, bv = b.value;
        const an = typeof av === 'number' ? av : parseFloat(String(av));
        const bn = typeof bv === 'number' ? bv : parseFloat(String(bv));
        if (!isNaN(an) && !isNaN(bn)) return dir * (an - bn);
        return dir * String(av ?? '').localeCompare(String(bv ?? ''));
      });
    }

    return rows;
  }, [results, filter, filterOp, sortField, sortDir, selectedGroups, nodeGroupMap]);

  const matchCount = processedResults.length;
  const limited = rowLimit ? processedResults.slice(0, Number(rowLimit)) : processedResults;

  const toggleSort = (field: 'certname' | 'value') => {
    if (sortField === field) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ field }: { field: string }) => {
    if (sortField !== field) return <IconSelector size={14} style={{ opacity: 0.3 }} />;
    return sortDir === 'asc' ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />;
  };

  // Generate autocomplete suggestions based on user input
  const getAutocompleteSuggestions = (query: string) => {
    if (!query) return factNames.slice(0, 50); // Show first 50 when empty
    
    const lowerQuery = query.toLowerCase();
    
    // First, find exact prefix matches
    const prefixMatches = factNames.filter(name => 
      name.toLowerCase().startsWith(lowerQuery)
    );
    
    // Then find contains matches
    const containsMatches = factNames.filter(name => 
      !name.toLowerCase().startsWith(lowerQuery) && 
      name.toLowerCase().includes(lowerQuery)
    );
    
    // Combine and limit results
    return [...prefixMatches, ...containsMatches].slice(0, 100);
  };

  // Handle Enter key to submit the typed fact
  const handleFactInputSubmit = () => {
    if (factInput.trim()) {
      handleFactSelect(factInput.trim());
    }
  };

  return (
    <Stack>
      <Group>
        <IconSearch size={28} />
        <Title order={2}>Fact Explorer</Title>
      </Group>

      <Alert variant="light" color="blue">
        Type or select a fact to see its value on every node. Supports nested facts like "os.family", 
        "memory.system.total", or "networking.interfaces.lo.bindings".
      </Alert>

      {/* Controls + illustration */}
      <Grid>
        <Grid.Col span={{ base: 12, md: isFormal ? 12 : 7 }}>
          <Card withBorder shadow="sm" padding="md">
            <Stack>
              <Group align="flex-end">
                <Autocomplete
                  label="Fact Name"
                  placeholder={namesLoading ? 'Loading facts...' : 'Type a fact name (e.g., os.family, memory.system.total)...'}
                  data={getAutocompleteSuggestions(factInput)}
                  value={factInput}
                  onChange={setFactInput}
                  onOptionSubmit={(val) => {
                    setFactInput(val);
                    handleFactSelect(val);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.defaultPrevented) {
                      handleFactInputSubmit();
                    }
                  }}
                  style={{ flex: 1, minWidth: 300 }}
                  disabled={namesLoading}
                  description="Start typing to see suggestions. Press Enter to query any typed fact."
                  leftSection={<IconSearch size={14} />}
                  limit={50}
                  maxDropdownHeight={400}
                />
                <Button 
                  onClick={handleFactInputSubmit}
                  disabled={!factInput.trim() || namesLoading}
                  variant="filled"
                >
                  Query
                </Button>
                {factInput && (
                  <Button 
                    onClick={() => {
                      setFactInput('');
                      setSelectedFact(null);
                      setFactData(null);
                      setFactStructure(null);
                    }}
                    variant="light"
                    color="gray"
                  >
                    Clear
                  </Button>
                )}
                {selectedFact && results.length > 0 && (
                  <>
                    <Select
                      label="Operator"
                      data={[
                        { value: 'contains', label: 'contains' },
                        { value: '=', label: '=' },
                        { value: '!=', label: '!=' },
                        { value: '>', label: '>' },
                        { value: '>=', label: '>=' },
                        { value: '<', label: '<' },
                        { value: '<=', label: '<=' },
                      ]}
                      value={filterOp}
                      onChange={(v) => setFilterOp(v || 'contains')}
                      style={{ width: 110 }}
                    />
                    <TextInput
                      label="Filter Value"
                      placeholder={filterOp === 'contains' ? 'Filter by node or value...' : 'e.g. 365'}
                      leftSection={<IconFilter size={14} />}
                      value={filter}
                      onChange={(e) => setFilter(e.currentTarget.value)}
                      style={{ width: 200 }}
                    />
                    <NumberInput
                      label="Limit"
                      placeholder="All"
                      value={rowLimit}
                      onChange={(v) => setRowLimit(v === '' ? '' : Number(v))}
                      min={1}
                      max={10000}
                      style={{ width: 90 }}
                    />
                  </>
                )}
              </Group>
              
              {/* Show available paths for structured facts */}
              {factStructure?.available_paths && factStructure.available_paths.length > 0 && (
                <Alert variant="light" color="cyan" icon={<IconInfoCircle />}>
                  <Text size="sm" fw={500} mb={4}>This fact has nested values. Try querying:</Text>
                  <Group gap={4}>
                    {factStructure.available_paths.slice(0, 15).map((path: string) => (
                      <Badge 
                        key={path}
                        size="sm"
                        variant="light"
                        style={{ cursor: 'pointer' }}
                        onClick={() => {
                          setFactInput(path);
                          handleFactSelect(path);
                        }}
                      >
                        {path}
                      </Badge>
                    ))}
                    {factStructure.available_paths.length > 15 && (
                      <Badge size="sm" variant="outline">
                        +{factStructure.available_paths.length - 15} more
                      </Badge>
                    )}
                  </Group>
                </Alert>
              )}
              
              {/* Show quick access to common nested facts */}
              {!selectedFact && !namesLoading && (
                <Alert variant="light" color="gray">
                  <Text size="sm" fw={500} mb={8}>Quick access to common facts:</Text>
                  <Grid gutter="xs">
                    <Grid.Col span={6}>
                      <Stack gap={4}>
                        <Text size="xs" c="dimmed">System</Text>
                        {['os.family', 'os.release.full', 'kernel', 'kernelrelease', 'memory.system.total'].map(fact => (
                          <Badge 
                            key={fact}
                            size="sm"
                            variant="light"
                            style={{ cursor: 'pointer' }}
                            onClick={() => {
                              setFactInput(fact);
                              handleFactSelect(fact);
                            }}
                          >
                            {fact}
                          </Badge>
                        ))}
                      </Stack>
                    </Grid.Col>
                    <Grid.Col span={6}>
                      <Stack gap={4}>
                        <Text size="xs" c="dimmed">Network</Text>
                        {['networking.hostname', 'networking.fqdn', 'networking.ip', 'networking.interfaces.eth0.ip'].map(fact => (
                          <Badge 
                            key={fact}
                            size="sm"
                            variant="light"
                            style={{ cursor: 'pointer' }}
                            onClick={() => {
                              setFactInput(fact);
                              handleFactSelect(fact);
                            }}
                          >
                            {fact}
                          </Badge>
                        ))}
                      </Stack>
                    </Grid.Col>
                  </Grid>
                </Alert>
              )}
            </Stack>
          </Card>
        </Grid.Col>

        {!isFormal && (
          <Grid.Col span={{ base: 12, md: 5 }}>
            <Card withBorder shadow="sm" padding="sm" style={{ overflow: 'hidden' }}>
              <FactOScope />
            </Card>
          </Grid.Col>
        )}
      </Grid>

      {encGroups.length > 0 && selectedFact && results.length > 0 && !loading && (
        <Paper withBorder p="xs" radius="sm">
          <Group gap="sm" align="center">
            <Group gap={4}>
              <IconUsersGroup size={16} style={{ opacity: 0.6 }} />
              <Text size="sm" fw={500} c="dimmed">Node Scope:</Text>
            </Group>
            <Chip.Group multiple value={selectedGroups} onChange={(val) => {
              if (val.includes('__all__')) {
                setSelectedGroups([]);
              } else {
                setSelectedGroups(val);
              }
            }}>
              <Group gap={6}>
                <Chip value="__all__" size="xs" variant="outline" color="blue"
                  checked={selectedGroups.length === 0}
                  onChange={() => setSelectedGroups([])}
                >
                  All Nodes
                </Chip>
                {encGroups.map(g => (
                  <Chip key={g} value={g} size="xs" variant="outline">
                    {g}
                  </Chip>
                ))}
                <Chip value="__ungrouped__" size="xs" variant="outline" color="gray">
                  Ungrouped
                </Chip>
              </Group>
            </Chip.Group>
          </Group>
        </Paper>
      )}

      {error && <Alert color="red" withCloseButton onClose={() => setError(null)}>{error}</Alert>}

      {loading && <Center h={200}><Loader size="xl" /></Center>}

      {!loading && selectedFact && factData && (
        <Card withBorder shadow="sm" padding="md">
          <Group justify="space-between" mb="md">
            <Stack gap={4}>
              <Title order={4}>
                Results for <Text span c="blue" inherit>"{selectedFact}"</Text>
              </Title>
              {factData.nested_path && (
                <Text size="xs" c="dimmed">
                  Base fact: {factData.base_fact} → Nested path: {factData.nested_path}
                </Text>
              )}
            </Stack>
            <Group gap="xs">
              {rowLimit && matchCount > Number(rowLimit) && (
                <Badge size="lg" variant="outline" color="gray">
                  showing {limited.length} of {matchCount}
                </Badge>
              )}
              <Badge size="lg" variant="light" color="blue">
                {matchCount} match{matchCount !== 1 ? 'es' : ''}
              </Badge>
              <ExportActions
                results={limited}
                columns={['certname', 'value']}
                queryContext={selectedFact || factInput}
                filenameBase="fact-results"
                variant="compact"
              />
            </Group>
          </Group>

          <ScrollArea h="calc(100vh - 400px)" mih={300} mah={700}>
            <Table striped highlightOnHover withTableBorder withColumnBorders>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={{ width: '30%', cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('certname')}>
                    <Group gap={4} wrap="nowrap">Certname <SortIcon field="certname" /></Group>
                  </Table.Th>
                  <Table.Th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('value')}>
                    <Group gap={4} wrap="nowrap">Value <SortIcon field="value" /></Group>
                  </Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {limited.map((f: any, i: number) => (
                  <Table.Tr key={i}>
                    <Table.Td>
                      <Text fw={500} size="sm" c="blue" style={{ cursor: 'pointer', textDecoration: 'underline' }}
                        onClick={() => navigate(`/nodes/${f.certname}`)}>{f.certname}</Text>
                    </Table.Td>
                    <Table.Td style={{ maxWidth: 500 }}>
                      {isJsonLike(f.value) ? (
                        <PrettyJson data={f.value} maxHeight={200} withBorder={false} />
                      ) : (
                        <div style={{ maxHeight: 200, overflow: 'auto' }}>
                          <Text size="sm" style={{ wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                            {f.value === null ? 'null' : String(f.value)}
                          </Text>
                        </div>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Card>
      )}

      {!loading && selectedFact && results.length === 0 && !error && (
        <Alert color="yellow">
          No data found for fact "{selectedFact}".
          {factData?.nested_path && (
            <Text size="sm" mt="xs">
              This might be because the nested path doesn't exist on any nodes. 
              Try checking the base fact "{factData.base_fact}" first.
            </Text>
          )}
        </Alert>
      )}
    </Stack>
  );
}
