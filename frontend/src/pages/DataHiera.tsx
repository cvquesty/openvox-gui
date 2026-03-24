import { Stack, Title } from '@mantine/core';
import { HieraViewer } from './ConfigPuppet';

export function DataHieraPage() {
  return (
    <Stack>
      <Title order={2}>Hiera Data Files</Title>
      <HieraViewer />
    </Stack>
  );
}
