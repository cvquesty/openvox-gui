import { describe, expect, it } from 'vitest';
import { stepPaletteIndex } from './paletteKeyboard';

describe('stepPaletteIndex', () => {
  it('moves within the list and jumps with Home and End', () => {
    expect(stepPaletteIndex(0, 4, 'ArrowDown')).toBe(1);
    expect(stepPaletteIndex(3, 4, 'ArrowDown')).toBe(3);
    expect(stepPaletteIndex(2, 4, 'ArrowUp')).toBe(1);
    expect(stepPaletteIndex(0, 4, 'ArrowUp')).toBe(0);
    expect(stepPaletteIndex(2, 4, 'Home')).toBe(0);
    expect(stepPaletteIndex(1, 4, 'End')).toBe(3);
    expect(stepPaletteIndex(1, 0, 'ArrowDown')).toBeNull();
    expect(stepPaletteIndex(1, 4, 'Enter')).toBeNull();
  });
});
