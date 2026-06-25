/**
 * Ops-grade table: sortable headers + client pagination (sruiux2 P0-2).
 * Keeps Mantine Table aesthetics; no virtualization dep in this slice.
 */
import { useMemo, useState, ReactNode } from 'react';
import {
  Table, Group, Text, Select, ScrollArea, UnstyledButton, Box,
} from '@mantine/core';
import { IconChevronUp, IconChevronDown, IconSelector } from '@tabler/icons-react';
import { EmptyState } from './StateComponents';

export type OpsColumn<T> = {
  key: string;
  header: string;
  sortable?: boolean;
  width?: string | number;
  /** Default true for string-ish compare; use 'number' | 'date' for smarter sorts */
  sortType?: 'string' | 'number' | 'date';
  render: (row: T) => ReactNode;
  /** Value used for sorting when not obvious from render */
  sortValue?: (row: T) => string | number | null | undefined;
};

function SortIcon({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  if (!active) return <IconSelector size={14} style={{ opacity: 0.45 }} />;
  return dir === 'asc' ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />;
}

function compareVals(a: any, b: any, sortType: OpsColumn<any>['sortType']): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (sortType === 'number') return Number(a) - Number(b);
  if (sortType === 'date') return new Date(a).getTime() - new Date(b).getTime();
  return String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true });
}

export function OpsTable<T>({
  columns,
  data,
  rowKey,
  pageSizeOptions = ['50', '100', '200', '500'],
  defaultPageSize = 100,
  maxHeight = 'calc(100vh - 280px)',
  emptyTitle = 'No rows',
  emptyDescription,
  onRowClick,
  minHeight = 200,
}: {
  columns: OpsColumn<T>[];
  data: T[];
  rowKey: (row: T) => string;
  pageSizeOptions?: string[];
  defaultPageSize?: number;
  maxHeight?: string | number;
  emptyTitle?: string;
  emptyDescription?: string;
  onRowClick?: (row: T) => void;
  minHeight?: number | string;
}) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);

  const sorted = useMemo(() => {
    if (!sortKey) return data;
    const col = columns.find((c) => c.key === sortKey);
    if (!col) return data;
    const mul = sortDir === 'asc' ? 1 : -1;
    return [...data].sort((ra, rb) => {
      const va = col.sortValue ? col.sortValue(ra) : (ra as any)[col.key];
      const vb = col.sortValue ? col.sortValue(rb) : (rb as any)[col.key];
      return mul * compareVals(va, vb, col.sortType || 'string');
    });
  }, [data, sortKey, sortDir, columns]);

  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const pageRows = sorted.slice(start, start + pageSize);

  const toggleSort = (key: string, sortable?: boolean) => {
    if (sortable === false) return;
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('asc');
    }
    setPage(1);
  };

  if (data.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <Box>
      <ScrollArea h={maxHeight} type="auto" offsetScrollbars style={{ minHeight }}>
        <Table striped highlightOnHover withTableBorder stickyHeader>
          <Table.Thead>
            <Table.Tr>
              {columns.map((col) => (
                <Table.Th key={col.key} style={col.width ? { width: col.width } : undefined}>
                  {col.sortable === false ? (
                    col.header
                  ) : (
                    <UnstyledButton onClick={() => toggleSort(col.key, col.sortable)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <Text span size="sm" fw={600}>
                        {col.header}
                      </Text>
                      <SortIcon active={sortKey === col.key} dir={sortDir} />
                    </UnstyledButton>
                  )}
                </Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {pageRows.map((row) => (
              <Table.Tr
                key={rowKey(row)}
                style={onRowClick ? { cursor: 'pointer' } : undefined}
                onClick={() => onRowClick?.(row)}
              >
                {columns.map((col) => (
                  <Table.Td key={col.key}>{col.render(row)}</Table.Td>
                ))}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
      <Group justify="space-between" mt="sm" wrap="wrap" gap="xs">
        <Text size="xs" c="dimmed">
          Showing {total === 0 ? 0 : start + 1}–{Math.min(start + pageSize, total)} of {total}
          {data.length !== total ? ` (sorted subset)` : ''}
        </Text>
        <Group gap="xs">
          <Text size="xs" c="dimmed">
            Page size
          </Text>
          <Select
            size="xs"
            w={90}
            data={pageSizeOptions}
            value={String(pageSize)}
            onChange={(v) => {
              setPageSize(parseInt(v || String(defaultPageSize), 10));
              setPage(1);
            }}
            allowDeselect={false}
          />
          <Select
            size="xs"
            w={110}
            data={Array.from({ length: totalPages }, (_, i) => ({
              value: String(i + 1),
              label: `Page ${i + 1}`,
            }))}
            value={String(safePage)}
            onChange={(v) => setPage(parseInt(v || '1', 10))}
            allowDeselect={false}
            disabled={totalPages <= 1}
          />
        </Group>
      </Group>
    </Box>
  );
}
