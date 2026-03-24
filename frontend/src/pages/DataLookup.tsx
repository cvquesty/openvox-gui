/**
 * OpenVox GUI - DataLookup.tsx
 * 
 * Component documentation to be expanded.
 */
import { Stack, Title } from '@mantine/core';
import { LookupTrace } from './ConfigPuppet';

export function DataLookupPage() {
  return (
    <Stack>
      <Title order={2}>Hiera Lookup</Title>
      <LookupTrace />
    </Stack>
  );
}
