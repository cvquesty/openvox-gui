/**
 * ExportActions
 *
 * Copy / download with optional column selection.
 * Column picker uses checkboxes; exports (CSV download, copy JSON/text) honor the selection.
 * Empty selection = all columns.
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
  Divider,
} from '@mantine/core';
import {
  IconCode,
  IconAlignLeft,
  IconCheck,
  IconFilter,
  IconDownload,
  IconClipboard,
} from '@tabler/icons-react';
import {
  arrayToPrettyJSON,
  arrayToFormattedText,
  arrayToCSV,
  downloadTextFile,
  deriveColumns,
  filterResultsToColumns,
} from '../utils/exportUtils';

export interface ExportActionsProps {
  results: any[];
  columns?: string[];
  queryContext?: string;
  filenameBase?: string;
  variant?: 'compact' | 'buttons';
  onCopied?: (format: 'json' | 'text' | 'csv') => void;
  /** Show toolbar CSV download (uses same column filter as the picker). Default true. */
  showDownload?: boolean;
}

export function ExportActions({
  results,
  columns: propColumns,
  filenameBase = 'openvox-results',
  variant = 'compact',
  onCopied,
  showDownload = true,
}: ExportActionsProps) {
  const [copied, setCopied] = useState<'json' | 'text' | 'csv' | null>(null);
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  const hasResults = Array.isArray(results) && results.length > 0;

  const availableColumns = propColumns && propColumns.length > 0
    ? propColumns
    : deriveColumns(results);

  /** Columns used for export: explicit picks, or all. */
  const effectiveColumns = selectedColumns.length > 0 ? selectedColumns : availableColumns;

  const filteredResults = filterResultsToColumns(results, effectiveColumns);

  const flash = (kind: 'json' | 'text' | 'csv') => {
    setCopied(kind);
    onCopied?.(kind);
    setTimeout(() => setCopied(null), 1800);
  };

  const handleCopy = (format: 'json' | 'text') => {
    if (!hasResults) return;
    const text =
      format === 'json'
        ? arrayToPrettyJSON(filteredResults)
        : arrayToFormattedText(filteredResults, effectiveColumns);
    navigator.clipboard.writeText(text).then(() => flash(format));
  };

  const handleDownloadCsv = () => {
    if (!hasResults) return;
    const csv = arrayToCSV(results, effectiveColumns);
    const stamp = new Date().toISOString().slice(0, 10);
    const suffix =
      selectedColumns.length > 0 && selectedColumns.length < availableColumns.length
        ? `-${selectedColumns.length}cols`
        : '';
    downloadTextFile(csv, `${filenameBase}${suffix}-${stamp}.csv`);
    flash('csv');
    setPickerOpen(false);
  };

  const toggleColumn = (col: string, checked: boolean) => {
    setSelectedColumns((prev) => {
      if (checked) {
        if (prev.includes(col)) return prev;
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
  const selectionLabel =
    selectedColumns.length === 0
      ? `All ${availableColumns.length} columns`
      : `${selectedColumns.length} column${selectedColumns.length === 1 ? '' : 's'}: ${selectedColumns.join(', ')}`;

  return (
    <Group gap={variant === 'compact' ? 4 : 'xs'}>
      <Popover
        width={320}
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
                ? `Filtered export: ${selectedColumns.join(', ')} — open to export`
                : 'Choose columns, then Export CSV / Copy in the panel'
            }
            withArrow
          >
            <ActionIcon
              variant="subtle"
              color={isFiltered ? 'orange' : 'gray'}
              aria-label="Select columns and export"
              onClick={() => setPickerOpen((o) => !o)}
            >
              <IconFilter size={iconSize} />
            </ActionIcon>
          </Tooltip>
        </Popover.Target>
        <Popover.Dropdown>
          <Text size="xs" fw={600} mb={4}>
            Columns to export
          </Text>
          <Text size="xs" c="dimmed" mb={8}>
            Check fields (e.g. certname + disks), then use <strong>Export CSV</strong> or Copy below.
            Uncheck all = every column.
          </Text>
          <Group gap={6} mb={8}>
            <Button size="compact-xs" variant="light" onClick={selectAll}>
              All
            </Button>
            <Button size="compact-xs" variant="subtle" color="gray" onClick={selectNone}>
              Clear (all cols)
            </Button>
          </Group>
          <ScrollArea.Autosize mah={220} type="auto" offsetScrollbars>
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
          <Text size="xs" c={isFiltered ? 'orange' : 'dimmed'} mt={8} mb={8}>
            {selectionLabel}
          </Text>
          <Divider mb={8} />
          <Stack gap={6}>
            <Button
              size="xs"
              leftSection={<IconDownload size={14} />}
              onClick={handleDownloadCsv}
              fullWidth
            >
              Export CSV
              {isFiltered ? ` (${selectedColumns.length} cols)` : ' (all columns)'}
            </Button>
            <Group grow gap={6}>
              <Button
                size="xs"
                variant="light"
                leftSection={<IconClipboard size={14} />}
                onClick={() => {
                  handleCopy('text');
                }}
              >
                Copy text
              </Button>
              <Button
                size="xs"
                variant="light"
                leftSection={<IconCode size={14} />}
                onClick={() => {
                  handleCopy('json');
                }}
              >
                Copy JSON
              </Button>
            </Group>
          </Stack>
        </Popover.Dropdown>
      </Popover>

      {showDownload && (
        <Tooltip
          label={
            isFiltered
              ? `Download CSV (${selectedColumns.length} selected columns)`
              : 'Download CSV (all columns — open filter to limit fields)'
          }
          withArrow
        >
          <ActionIcon
            variant="subtle"
            color={copied === 'csv' ? 'teal' : isFiltered ? 'orange' : 'gray'}
            onClick={handleDownloadCsv}
            aria-label="Download CSV"
          >
            {copied === 'csv' ? (
              <IconCheck size={iconSize} />
            ) : (
              <IconDownload size={iconSize} />
            )}
          </ActionIcon>
        </Tooltip>
      )}

      <Tooltip label="Copy as JSON (respects column filter)" withArrow>
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

      <Tooltip label="Copy as formatted text (respects column filter)" withArrow>
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
