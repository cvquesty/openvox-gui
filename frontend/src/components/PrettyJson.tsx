/**
 * PrettyJson component - displays JSON data in a nicely formatted, syntax-highlighted way
 * Similar to output from `jq` command
 */
import { Code, ScrollArea, Box } from '@mantine/core';
import { useMemo } from 'react';

interface PrettyJsonProps {
  data: any;
  maxHeight?: number | string;
  withBorder?: boolean;
  compact?: boolean;
}

export function PrettyJson({ data, maxHeight = 400, withBorder = true, compact = false }: PrettyJsonProps) {
  const formattedJson = useMemo(() => {
    if (data === null || data === undefined) return 'null';
    
    try {
      // Pretty print with 2-space indentation by default
      const spacing = compact ? 0 : 2;
      return JSON.stringify(data, null, spacing);
    } catch (error) {
      // If JSON.stringify fails, try to show something useful
      return String(data);
    }
  }, [data, compact]);

  // For simple values, don't use scrollarea
  const isSimpleValue = typeof data !== 'object' || data === null;
  
  if (isSimpleValue && !Array.isArray(data)) {
    return (
      <Code block style={{ fontSize: 12 }}>
        {formattedJson}
      </Code>
    );
  }

  return (
    <Box
      style={{
        border: withBorder ? '1px solid var(--mantine-color-default-border)' : undefined,
        borderRadius: withBorder ? 'var(--mantine-radius-default)' : undefined,
        overflow: 'hidden',
      }}
    >
      <ScrollArea style={{ maxHeight }} offsetScrollbars>
        <Code
          block
          style={{
            fontSize: 12,
            whiteSpace: 'pre',
            wordBreak: 'break-word',
            padding: '12px',
            margin: 0,
            background: 'var(--mantine-color-dark-8)',
            color: 'var(--mantine-color-gray-0)',
          }}
        >
          {formattedJson}
        </Code>
      </ScrollArea>
    </Box>
  );
}

// Convenience function to check if a value is JSON-like
export function isJsonLike(value: any): boolean {
  return value !== null && 
         value !== undefined && 
         (typeof value === 'object' || Array.isArray(value));
}