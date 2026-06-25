/**
 * Consistent search + status chips + optional extras (sruiux2 P1-1).
 */
import { ReactNode } from 'react';
import { Group, TextInput, Chip, Button, Stack, Text } from '@mantine/core';
import { IconSearch, IconX } from '@tabler/icons-react';

export type StatusChip = {
  value: string;
  label: string;
  color?: string;
};

const DEFAULT_STATUS_CHIPS: StatusChip[] = [
  { value: 'failed', label: 'Failed', color: 'red' },
  { value: 'changed', label: 'Changed', color: 'blue' },
  { value: 'unchanged', label: 'Unchanged', color: 'green' },
];

export function FilterBar({
  search,
  onSearchChange,
  searchPlaceholder = 'Search…',
  status,
  onStatusChange,
  statusChips = DEFAULT_STATUS_CHIPS,
  showStatusChips = true,
  rightSection,
  onClear,
  hint,
}: {
  search: string;
  onSearchChange: (v: string) => void;
  searchPlaceholder?: string;
  /** Active status filter (single); empty / null = all */
  status?: string | null;
  onStatusChange?: (v: string | null) => void;
  statusChips?: StatusChip[];
  showStatusChips?: boolean;
  rightSection?: ReactNode;
  onClear?: () => void;
  hint?: string;
}) {
  const hasFilters = Boolean(search) || Boolean(status);

  return (
    <Stack gap="xs">
      <Group justify="space-between" align="flex-end" wrap="wrap" gap="sm">
        <Group gap="sm" align="flex-end" style={{ flex: 1, minWidth: 240 }}>
          <TextInput
            placeholder={searchPlaceholder}
            leftSection={<IconSearch size={16} />}
            value={search}
            onChange={(e) => onSearchChange(e.currentTarget.value)}
            style={{ flex: 1, minWidth: 200, maxWidth: 360 }}
          />
          {showStatusChips && onStatusChange && (
            <Chip.Group
              multiple={false}
              value={status || ''}
              onChange={(v) => onStatusChange(v || null)}
            >
              <Group gap={6}>
                {statusChips.map((c) => (
                  <Chip key={c.value} value={c.value} size="xs" variant="light" color={c.color}>
                    {c.label}
                  </Chip>
                ))}
              </Group>
            </Chip.Group>
          )}
        </Group>
        <Group gap="xs">
          {hasFilters && (
            <Button
              size="xs"
              variant="subtle"
              color="gray"
              leftSection={<IconX size={14} />}
              onClick={() => {
                onSearchChange('');
                onStatusChange?.(null);
                onClear?.();
              }}
            >
              Clear
            </Button>
          )}
          {rightSection}
        </Group>
      </Group>
      {hint && (
        <Text size="xs" c="dimmed">
          {hint}
        </Text>
      )}
    </Stack>
  );
}
