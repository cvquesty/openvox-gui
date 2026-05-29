/**
 * ExportActions
 *
 * Simple export/copy component with column selection support.
 *
 * Features:
 * - JSON export (full objects or selected columns)
 * - Formatted Text export (aligned table or simple vertical list when 1 column)
 * - Optional column picker (MultiSelect) so you can export just certnames, etc.
 *
 * Designed to be obvious and powerful for operational use.
 */

import { useState } from 'react';
import {
  Group,
  ActionIcon,
  Tooltip,
  Popover,
  MultiSelect,
  Text,
} from '@mantine/core';
import { IconCode, IconAlignLeft, IconCheck, IconFilter } from '@tabler/icons-react';
import {
  arrayToPrettyJSON,
  arrayToFormattedText,
  deriveColumns,
  filterResultsToColumns,
} from '../utils/exportUtils';

export interface ExportActionsProps {
  results: any[];
  columns?: string[];
  queryContext?: string;
  filenameBase?: string;
  variant?: 'compact' | 'buttons';
  onCopied?: (format: 'json' | 'text') => void;
}

export function ExportActions({
  results,
  columns: propColumns,
  filenameBase = 'openvox-results',
  variant = 'compact',
  onCopied,
}: ExportActionsProps) {
  const [copied, setCopied] = useState<'json' | 'text' | null>(null);
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);

  const hasResults = Array.isArray(results) && results.length > 0;

  const availableColumns = propColumns && propColumns.length > 0
    ? propColumns
    : deriveColumns(results);

  const effectiveColumns = selectedColumns.length > 0 ? selectedColumns : availableColumns;

  const filteredResults = filterResultsToColumns(results, effectiveColumns);

  const handleCopy = (format: 'json' | 'text') => {
    if (!hasResults) return;

    let text = '';

    if (format === 'json') {
      text = arrayToPrettyJSON(filteredResults);
    } else {
      text = arrayToFormattedText(filteredResults, effectiveColumns);
    }

    navigator.clipboard.writeText(text).then(() => {
      setCopied(format);
      onCopied?.(format);
      setTimeout(() => setCopied(null), 1800);
    });
  };

  const columnSelectData = availableColumns.map((col) => ({
    value: col,
    label: col,
  }));

  if (!hasResults) return null;

  const iconSize = variant === 'compact' ? 16 : 14;
  const isFiltered = selectedColumns.length > 0 && selectedColumns.length < availableColumns.length;

  return (
    <Group gap={variant === 'compact' ? 4 : 'xs'}>
      {/* Column selector */}
      <Popover width={280} position="bottom" withArrow shadow="md">
        <Popover.Target>
          <Tooltip label={isFiltered ? "Columns filtered" : "Select columns to export"} withArrow>
            <ActionIcon
              variant="subtle"
              color={isFiltered ? 'orange' : 'gray'}
              aria-label="Select columns"
            >
              <IconFilter size={iconSize} />
            </ActionIcon>
          </Tooltip>
        </Popover.Target>
        <Popover.Dropdown>
          <Text size="xs" fw={500} mb={4}>Export only these columns:</Text>
          <MultiSelect
            data={columnSelectData}
            value={selectedColumns}
            onChange={setSelectedColumns}
            placeholder="All columns"
            searchable
            clearable
            size="xs"
          />
          <Text size="xs" c="dimmed" mt={4}>
            Leave empty to export all columns. Single column = nice vertical list for certnames etc.
          </Text>
        </Popover.Dropdown>
      </Popover>

      {/* JSON */}
      <Tooltip label="Copy as JSON" withArrow>
        <ActionIcon
          variant="subtle"
          color={copied === 'json' ? 'teal' : 'gray'}
          onClick={() => handleCopy('json')}
          aria-label="Copy as JSON"
        >
          {copied === 'json' ? (
            <IconCheck size={iconSize} />
          ) : (
            <IconCode size={iconSize} />
          )}
        </ActionIcon>
      </Tooltip>

      {/* Formatted Text */}
      <Tooltip label="Copy as formatted text (table or list)" withArrow>
        <ActionIcon
          variant="subtle"
          color={copied === 'text' ? 'teal' : 'gray'}
          onClick={() => handleCopy('text')}
          aria-label="Copy as formatted text"
        >
          {copied === 'text' ? (
            <IconCheck size={iconSize} />
          ) : (
            <IconAlignLeft size={iconSize} />
          )}
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}
