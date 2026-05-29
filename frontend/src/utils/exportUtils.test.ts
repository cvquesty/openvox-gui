/**
 * Basic tests for export utilities.
 * Run with: npx vitest run src/utils/exportUtils.test.ts (once Vitest is configured)
 */

import { describe, it, expect } from 'vitest';
import {
  safeStringify,
  deriveColumns,
  arrayToMarkdownTable,
  arrayToCSV,
} from './exportUtils';

describe('exportUtils', () => {
  const sample = [
    { certname: 'web01', os: 'Rocky', count: 3 },
    { certname: 'db01', os: 'Ubuntu', count: 1 },
  ];

  it('deriveColumns', () => {
    expect(deriveColumns(sample)).toEqual(['certname', 'os', 'count']);
  });

  it('safeStringify handles objects and truncation', () => {
    expect(safeStringify({ a: 1 })).toContain('a');
    expect(safeStringify('x'.repeat(400)).length).toBeLessThan(305);
  });

  it('arrayToMarkdownTable produces usable Slack-friendly output', () => {
    const md = arrayToMarkdownTable(sample);
    expect(md).toContain('| certname | os | count |');
    expect(md).toContain('| web01');
  });

  it('arrayToCSV produces valid-ish CSV', () => {
    const csv = arrayToCSV(sample);
    expect(csv).toContain('certname,os,count');
    expect(csv).toContain('web01,Rocky,3');
  });

  it('empty results are handled gracefully', () => {
    expect(arrayToMarkdownTable([])).toBe('_No results_');
    expect(arrayToCSV([])).toBe('');
  });
});
