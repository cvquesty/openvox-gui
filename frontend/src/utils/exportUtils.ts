/**
 * Export utilities for query results across the UI.
 *
 * Focused on practical, copy/paste-friendly outputs:
 * - Pretty JSON (for machines / scripts)
 * - Formatted plain text table (for Slack, email, notes, wikis)
 *
 * All functions are pure and have zero dependencies.
 */

/**
 * Safely convert any value to a string suitable for tables/exports.
 */
export function safeStringify(value: unknown, maxLen: number = 300): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    if (value.length > maxLen) {
      return value.slice(0, maxLen - 3) + '...';
    }
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const str = JSON.stringify(value);
    return str.length > maxLen ? str.slice(0, maxLen - 3) + '...' : str;
  }

  if (typeof value === 'object') {
    try {
      const str = JSON.stringify(value);
      return str.length > maxLen ? str.slice(0, maxLen - 3) + '...' : str;
    } catch {
      return '[object]';
    }
  }

  return String(value);
}

/**
 * Derive column names from an array of result objects.
 */
export function deriveColumns(results: any[]): string[] {
  if (!results || results.length === 0) return [];

  const columns = new Set<string>();
  const sampleSize = Math.min(results.length, 50);

  for (let i = 0; i < sampleSize; i++) {
    const row = results[i];
    if (row && typeof row === 'object' && !Array.isArray(row)) {
      Object.keys(row).forEach((key) => columns.add(key));
    }
  }

  return Array.from(columns);
}

/**
 * Convert an array of objects into a clean, aligned plain-text table.
 * Excellent for pasting into Slack, email, runbooks, etc.
 * Columns are automatically sized to content.
 *
 * Special case: If only one column is selected, returns a simple vertical list
 * (one value per line). This is extremely useful for exporting just certnames.
 */
export function arrayToFormattedText(rows: any[], columns?: string[]): string {
  if (!rows || rows.length === 0) {
    return 'No results';
  }

  const cols = columns && columns.length > 0 ? columns : deriveColumns(rows);
  if (cols.length === 0) {
    return 'No columns to display';
  }

  // Special case: single column → clean vertical list (perfect for certnames)
  if (cols.length === 1) {
    const col = cols[0];
    return rows
      .map((row) => safeStringify(row?.[col]))
      .filter((v) => v !== '')
      .join('\n');
  }

  // Multi-column: nice aligned table
  const matrix: string[][] = [];
  const widths: number[] = cols.map(() => 0);

  const headerRow = cols.map((col, i) => {
    const s = col;
    widths[i] = Math.max(widths[i], s.length);
    return s;
  });
  matrix.push(headerRow);

  for (const row of rows) {
    const dataRow = cols.map((col, i) => {
      const s = safeStringify(row?.[col]);
      widths[i] = Math.max(widths[i], s.length);
      return s;
    });
    matrix.push(dataRow);
  }

  const separator = widths.map((w) => '-'.repeat(w)).join(' | ');

  const lines = matrix.map((row, rowIndex) => {
    const padded = row.map((cell, i) => cell.padEnd(widths[i]));
    const line = padded.join(' | ');
    if (rowIndex === 0) {
      return line + '\n' + separator;
    }
    return line;
  });

  return lines.join('\n');
}

/**
 * Convert results to pretty-printed JSON string.
 */
export function arrayToPrettyJSON(rows: any[]): string {
  return JSON.stringify(rows, null, 2);
}

/**
 * Filter results to only include the specified columns.
 * Useful for column-selective exports.
 */
export function filterResultsToColumns(results: any[], selectedColumns: string[]): any[] {
  if (!selectedColumns || selectedColumns.length === 0) {
    return results;
  }
  return results.map((row) => {
    const filtered: any = {};
    selectedColumns.forEach((col) => {
      if (row && col in row) {
        filtered[col] = row[col];
      }
    });
    return filtered;
  });
}
