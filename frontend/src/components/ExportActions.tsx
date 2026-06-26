/**
 * ExportActions
 *
 * Simple export/copy component with column selection support.
 *
 * Features:
 * - JSON export (full objects or selected columns)
 * - Formatted Text export (aligned table or simple vertical list when 1 column)
 * - Optional column picker so you can export certname + disks, etc.
 *
 * Column picker uses checkboxes (not MultiSelect-in-Popover) so multiple
 * fields can be toggled without the popover/combobox eating the second click.
 */

import { useState } from 'react';
import {
  Group,
  ActionIcon,
  Tooltip,
  Popover,
  Text,
  Stack,
  Checkbox,
  ScrollArea,
  Button,
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
  showDownload?: boolean;
}

export function ExportActions({
  results,
  columns: propColumns,
  filenameBase = 'openvox-results',
  variant = 'compact',
  onCopied,
  showDownload: _showDownload,
}: ExportActionsProps) {
  const [copied, setCopied] = useState<'json' | 'text' | null>(null);
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

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

  const toggleColumn = (col: string, checked: boolean) => {
    setSelectedColumns((prev) => {
      if (checked) {
        if (prev.includes(col)) return prev;
        // Preserve catalog order when adding
        const next = [...prev, col];
        return availableColumns.filter((c) => next.includes(c));
      }
      return prev.filter((c) => c !== col);
    });
  };

  const selectAll = () => setSelectedColumns([...availableColumns]);
  const selectNone = () => setSelectedColumns([]);

  if (!hasResults) return null;

  const iconSize = variant === 'compact' ? 16 : 14;
  const isFiltered = selectedColumns.length > 0 && selectedColumns.length < availableColumns.length;

  return (
    <Group gap={variant === 'compact' ? 4 : 'xs'}>
      <Popover
        width={300}
        position="bottom-end"
        withArrow
        shadow="md"
        opened={pickerOpen}
        onChange={setPickerOpen}
        closeOnClickOutside
        trapFocus={false}
      >
        <Popover.Target>
          <Tooltip
            label={
              isFiltered
                ? `Export columns: ${selectedColumns.join(', ')}`
                : 'Select columns to export (multi-select)'
            }
            withArrow
          >
            <ActionIcon
              variant="subtle"
              color={isFiltered ? 'orange' : 'gray'}
              aria-label="Select columns to export"
              onClick={() => setPickerOpen((o) => !o)}
            >
              <IconFilter size={iconSize} />
            </ActionIcon>
          </Tooltip>
        </Popover.Target>
        <Popover.Dropdown>
          <Text size="xs" fw={600} mb={6}>
            Export only these columns
          </Text>
          <Text size="xs" c="dimmed" mb={8}>
            Check one or more (e.g. certname + disks). Leave all unchecked to export every column.
          </Text>
          <Group gap={6} mb={8}>
            <Button size="compact-xs" variant="light" onClick={selectAll}>
              All
            </Button>
            <Button size="compact-xs" variant="subtle" color="gray" onClick={selectNone}>
              None (all cols)
            </Button>
          </Group>
          <ScrollArea.Autosize mah={240} type="auto" offsetScrollbars>
            <Stack gap={6}>
              {availableColumns.map((col) => (
                <Checkbox
                  key={col}
                  size="xs"
                  label={col}
                  checked={selectedColumns.includes(col)}
                  onChange={(e) => toggleColumn(col, e.currentTarget.checked)}
                />
              ))}
            </Stack>
          </ScrollArea.Autosize>
          {selectedColumns.length > 0 && (
            <Text size="xs" c="orange" mt={8}>
              {selectedColumns.length} column{selectedColumns.length === 1 ? '' : 's'} selected
            </Text>
          )}
        </Popover.Dropdown>
      </Popover>

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
