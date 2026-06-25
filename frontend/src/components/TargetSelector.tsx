/**
 * Target picker with resolved-count affordance (sruiux1 P0 #1).
 * Produces the same comma-separated targets string the Bolt API expects.
 * Accepts Mantine 7 MultiSelect data (flat strings, items, or { group, items }[]).
 */
import { MultiSelect, Text, Group, Badge, Stack, ComboboxItem, ComboboxItemGroup } from '@mantine/core';

export type TargetOption = { value: string; label: string; group?: string };

export type TargetSelectData = (string | ComboboxItem | ComboboxItemGroup)[];

export function targetsToString(selected: string[]): string {
  return selected.join(',');
}

export function TargetSelector({
  data,
  value,
  onChange,
  label = 'Targets',
  description,
  required,
  placeholder = 'Select one or more groups or nodes',
  /** Optional resolved certnames when groups expand client-side (display only) */
  resolvedPreview,
}: {
  data: TargetSelectData | TargetOption[] | string[];
  value: string[];
  onChange: (v: string[]) => void;
  label?: string;
  description?: string;
  required?: boolean;
  placeholder?: string;
  resolvedPreview?: string[];
}) {
  const count = resolvedPreview?.length ?? value.length;

  return (
    <Stack gap={6}>
      <MultiSelect
        label={label}
        description={description}
        required={required}
        searchable
        clearable
        data={data as TargetSelectData}
        value={value}
        onChange={onChange}
        nothingFoundMessage="No matching targets"
        placeholder={placeholder}
      />
      <Group gap="xs">
        <Badge size="sm" variant="light" color={count > 0 ? 'blue' : 'gray'}>
          {count} selected{resolvedPreview ? ' (resolved)' : ''}
        </Badge>
        {value.includes('all') && (
          <Text size="xs" c="dimmed">
            “all” expands on the server via PuppetDB / ENC
          </Text>
        )}
      </Group>
      {resolvedPreview && resolvedPreview.length > 0 && resolvedPreview.length <= 12 && (
        <Text size="xs" c="dimmed" lineClamp={3}>
          {resolvedPreview.join(', ')}
        </Text>
      )}
    </Stack>
  );
}
