/**
 * Command palette list movement. Enter is handled by the caller.
 * Arrow keys stop at the ends; Home and End jump.
 */
export function stepPaletteIndex(current: number, length: number, key: string): number | null {
  if (length <= 0) return null;
  const index = Math.min(Math.max(current, 0), length - 1);
  if (key === 'ArrowDown') return Math.min(length - 1, index + 1);
  if (key === 'ArrowUp') return Math.max(0, index - 1);
  if (key === 'Home') return 0;
  if (key === 'End') return length - 1;
  return null;
}
