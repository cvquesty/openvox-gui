/**
 * ExportActions
 *
 * Reusable component for exporting/copying query results from the Tools pages
 * (PQL Console, Fact Explorer, Resource Explorer, etc.).
 *
 * Uses the project's established <CopyButton> pattern from Installer.tsx
 * for consistent UX (teal success state, etc.).
 *
 * Supports Markdown (best for Slack/email), CSV, and pretty JSON.
 */

import { useState } from 'react';
import {
  Group,
  ActionIcon,
  Tooltip,
  Button,
  Menu,
  Text,
} from '@mantine/core';
import { IconCopy, IconCheck, IconDownload } from '@tabler/icons-react';
import {
  arrayToMarkdownTable,
  arrayToCSV,
  safeStringify,
  getResultsSummary,
} from '../utils/exportUtils';

export interface ExportActionsProps {
  /** The rows to export (use the *visible/filtered/limited* set the user sees) */
  results: any[];
  /** Optional explicit column order */
  columns?: string[];
  /** Optional context string (e.g. the PQL query) shown in notifications */
  queryContext?: string;
  /** Base filename for downloads (without extension) */
  filenameBase?: string;
  /** Visual style */
  variant?: 'buttons' | 'compact' | 'menu';
  /** Show download buttons in addition to copy */
  showDownload?: boolean;
  /** Called after a successful copy (for analytics / toasts if parent wants) */
  onCopied?: (format: 'json' | 'markdown' | 'csv') => void;
}

function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ExportActions({
  results,
  columns,
  queryContext,
  filenameBase = 'openvox-query',
  variant = 'compact',
  showDownload = false,
  onCopied,
}: ExportActionsProps) {
  const [copiedFormat, setCopiedFormat] = useState<'json' | 'markdown' | 'csv' | null>(null);

  const hasResults = Array.isArray(results) && results.length > 0;

  const handleCopy = (format: 'json' | 'markdown' | 'csv') => {
    if (!hasResults) return;

    let text = '';
    let filename = filenameBase;

    if (format === 'json') {
      text = JSON.stringify(results, null, 2);
      filename += '.json';
    } else if (format === 'markdown') {
      text = arrayToMarkdownTable(results, columns);
      filename += '.md';
    } else {
      text = arrayToCSV(results, columns);
      filename += '.csv';
    }

    navigator.clipboard.writeText(text).then(() => {
      setCopiedFormat(format);
      onCopied?.(format);

      // Reset the visual feedback after 2 seconds
      setTimeout(() => setCopiedFormat(null), 2000);
    });
  };

  const handleDownload = (format: 'json' | 'markdown' | 'csv') => {
    if (!hasResults) return;

    let content = '';
    let mime = 'text/plain';
    let ext = format;

    if (format === 'json') {
      content = JSON.stringify(results, null, 2);
      mime = 'application/json';
    } else if (format === 'markdown') {
      content = arrayToMarkdownTable(results, columns);
      mime = 'text/markdown';
    } else {
      content = arrayToCSV(results, columns);
      mime = 'text/csv';
    }

    downloadFile(content, `${filenameBase}.${ext}`, mime);
  };

  if (!hasResults) {
    return null;
  }

  const summary = getResultsSummary(results, queryContext);

  // Compact icon-only version (good for table headers)
  if (variant === 'compact') {
    return (
      <Group gap={4}>
        <Tooltip label={`Copy ${summary} as JSON`} withArrow>
          <ActionIcon
            variant="subtle"
            color={copiedFormat === 'json' ? 'teal' : 'gray'}
            onClick={() => handleCopy('json')}
            aria-label="Copy as JSON"
          >
            {copiedFormat === 'json' ? <IconCheck size={16} /> : <IconCopy size={16} />}
          </ActionIcon>
        </Tooltip>

        <Tooltip label={`Copy ${summary} as Markdown table (great for Slack)`} withArrow>
          <ActionIcon
            variant="subtle"
            color={copiedFormat === 'markdown' ? 'teal' : 'gray'}
            onClick={() => handleCopy('markdown')}
            aria-label="Copy as Markdown"
          >
            {copiedFormat === 'markdown' ? <IconCheck size={16} /> : <IconCopy size={16} />}
          </ActionIcon>
        </Tooltip>

        <Tooltip label={`Copy ${summary} as CSV`} withArrow>
          <ActionIcon
            variant="subtle"
            color={copiedFormat === 'csv' ? 'teal' : 'gray'}
            onClick={() => handleCopy('csv')}
            aria-label="Copy as CSV"
          >
            {copiedFormat === 'csv' ? <IconCheck size={16} /> : <IconCopy size={16} />}
          </ActionIcon>
        </Tooltip>

        {showDownload && (
          <>
            <Tooltip label="Download JSON" withArrow>
              <ActionIcon
                variant="subtle"
                color="gray"
                onClick={() => handleDownload('json')}
                aria-label="Download JSON"
              >
                <IconDownload size={15} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Download Markdown" withArrow>
              <ActionIcon
                variant="subtle"
                color="gray"
                onClick={() => handleDownload('markdown')}
                aria-label="Download Markdown"
              >
                <IconDownload size={15} />
              </ActionIcon>
            </Tooltip>
          </>
        )}
      </Group>
    );
  }

  // Full button version
  if (variant === 'buttons') {
    return (
      <Group gap="xs">
        <Button
          size="xs"
          variant="light"
          leftSection={copiedFormat === 'json' ? <IconCheck size={14} /> : <IconCopy size={14} />}
          color={copiedFormat === 'json' ? 'teal' : 'blue'}
          onClick={() => handleCopy('json')}
        >
          JSON
        </Button>
        <Button
          size="xs"
          variant="light"
          leftSection={copiedFormat === 'markdown' ? <IconCheck size={14} /> : <IconCopy size={14} />}
          color={copiedFormat === 'markdown' ? 'teal' : 'blue'}
          onClick={() => handleCopy('markdown')}
        >
          Markdown
        </Button>
        <Button
          size="xs"
          variant="light"
          leftSection={copiedFormat === 'csv' ? <IconCheck size={14} /> : <IconCopy size={14} />}
          color={copiedFormat === 'csv' ? 'teal' : 'blue'}
          onClick={() => handleCopy('csv')}
        >
          CSV
        </Button>
      </Group>
    );
  }

  // Menu version (most compact for crowded headers)
  return (
    <Menu shadow="md" width={200}>
      <Menu.Target>
        <ActionIcon variant="subtle" color="gray" aria-label="Export results">
          <IconCopy size={16} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>{summary}</Menu.Label>
        <Menu.Item leftSection={<IconCopy size={14} />} onClick={() => handleCopy('json')}>
          Copy as JSON
        </Menu.Item>
        <Menu.Item leftSection={<IconCopy size={14} />} onClick={() => handleCopy('markdown')}>
          Copy as Markdown table
        </Menu.Item>
        <Menu.Item leftSection={<IconCopy size={14} />} onClick={() => handleCopy('csv')}>
          Copy as CSV
        </Menu.Item>
        {showDownload && (
          <>
            <Menu.Divider />
            <Menu.Item leftSection={<IconDownload size={14} />} onClick={() => handleDownload('json')}>
              Download JSON
            </Menu.Item>
            <Menu.Item leftSection={<IconDownload size={14} />} onClick={() => handleDownload('markdown')}>
              Download Markdown
            </Menu.Item>
          </>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}
