/**
 * Tests for export utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  safeStringify,
  deriveColumns,
  arrayToFormattedText,
  arrayToPrettyJSON,
} from './exportUtils';

describe('exportUtils', () => {
  const sample = [
    { certname: 'web01', status: 'changed', env: 'prod' },
    { certname: 'db01', status: 'unchanged', env: 'staging' },
  ];

  it('deriveColumns works', () => {
    expect(deriveColumns(sample)).toEqual(['certname', 'status', 'env']);
  });

  it('arrayToFormattedText produces aligned text table', () => {
    const text = arrayToFormattedText(sample);
    expect(text).toContain('certname');
    expect(text).toContain('web01');
    expect(text).toContain('prod');
  });

  it('arrayToPrettyJSON works', () => {
    const json = arrayToPrettyJSON(sample);
    expect(json).toContain('"certname": "web01"');
  });

  it('handles empty results', () => {
    expect(arrayToFormattedText([])).toBe('No results');
  });
});
