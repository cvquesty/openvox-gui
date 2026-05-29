/**
 * ExportActions
 *
 * Simple, obvious export/copy component for tables and query results.
 *
 * Currently offers only two practical options:
 * - JSON (structured data)
 * - Formatted Text (clean aligned table, great for Slack/email)
 *
 * Designed to be obvious at a glance with no mystery icons.
 */

import { useState } from 'react';
import { Group, ActionIcon, Tooltip } from '@mantine/core';
import { IconCode, IconAlignLeft, IconCheck } from '@tabler/icons-react';
import {
  arrayToPrettyJSON,
  arrayToFormattedText,
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
  columns,
  filenameBase = 'openvox-results',
  variant = 'compact',
  onCopied,
}: ExportActionsProps) {
  const [copied, setCopied] = useState<'json' | 'text' | null>(null);

  const hasResults = Array.isArray(results) && results.length > 0;

  const handleCopy = (format: 'json' | 'text') => {
    if (!hasResults) return;

    let text = '';
    let ext = format;

    if (format === 'json') {
      text = arrayToPrettyJSON(results);
      ext = 'json';
    } else {
      text = arrayToFormattedText(results, columns);
      ext = 'txt';
    }

    navigator.clipboard.writeText(text).then(() => {
      setCopied(format);
      onCopied?.(format);
      setTimeout(() => setCopied(null), 1800);
    });
  };

  if (!hasResults) return null;

  const iconSize = variant === 'compact' ? 16 : 14;

  return (
    <Group gap={variant === 'compact' ? 4 : 'xs'}>
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

      {/* Formatted Text (plain text table) */}
      <Tooltip label="Copy as formatted text table" withArrow>
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
