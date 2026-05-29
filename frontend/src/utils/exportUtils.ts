/**
 * Export utilities for Tools query results (PQL Console, Fact Explorer, Resource Explorer, etc.).
 *
 * All functions are pure and have zero dependencies so they can be used
 * both in the browser (web UI) and potentially in scripts.
 *
 * Designed to produce output that pastes cleanly into Slack, email, wikis,
 * and spreadsheets.
 */

/**
 * Safely convert any value to a string suitable for tables/exports.
 * Handles objects, arrays, nulls, long strings, etc.
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
 * Uses the first object that has keys, then takes the union of keys from up to the first 50 rows.
 */
export function deriveColumns(results: any[]): string[] {
  if (!results || results.length === 0) return [];

  const columns = new Set<string>();

  // Look at up to 50 rows to build a good column set
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
 * Convert an array of objects into a GitHub-flavored Markdown table.
 * Excellent for Slack, email, GitHub issues, wikis, etc.
 */
export function arrayToMarkdownTable(rows: any[], columns?: string[]): string {
  if (!rows || rows.length === 0) {
    return '_No results_';
  }

  const cols = columns && columns.length > 0 ? columns : deriveColumns(rows);
  if (cols.length === 0) {
    return '_No columns to display_';
  }

  const header = `| ${cols.join(' | ')} |`;
  const separator = `| ${cols.map(() => '---').join(' | ')} |`;

  const body = rows
    .map((row) => {
      const cells = cols.map((col) => {
        const raw = row?.[col];
        // Escape pipe characters and newlines for Markdown table cells
        const cell = safeStringify(raw).replace(/\|/g, '\\|').replace(/\n/g, '<br>');
        return cell || '';
      });
      return `| ${cells.join(' | ')} |`;
    })
    .join('\n');

  return [header, separator, body].join('\n');
}

/**
 * Convert an array of objects to CSV (simple but practical implementation).
 * Good enough for the vast majority of OpenVoxDB result sets.
 */
export function arrayToCSV(rows: any[], columns?: string[]): string {
  if (!rows || rows.length === 0) {
    return '';
  }

  const cols = columns && columns.length > 0 ? columns : deriveColumns(rows);
  if (cols.length === 0) {
    return '';
  }

  const escapeCsv = (val: unknown): string => {
    const str = safeStringify(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const header = cols.join(',');
  const body = rows
    .map((row) => cols.map((col) => escapeCsv(row?.[col])).join(','))
    .join('\n');

  return [header, body].join('\n');
}

/**
 * Convenience helper: get a human-friendly summary line for a result set.
 */
export function getResultsSummary(rows: any[], queryLabel?: string): string {
  const count = rows?.length || 0;
  const label = queryLabel ? ` for "${queryLabel}"` : '';
  return `${count} row${count === 1 ? '' : 's'}${label}`;
}
