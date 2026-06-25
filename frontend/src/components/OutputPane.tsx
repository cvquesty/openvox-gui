/**
 * Standardized command / Bolt output container (sruiux1 P0 #1).
 */
import { useState } from 'react';
import { Box, Code, Group, ScrollArea, TextInput, ActionIcon, Tooltip, Text } from '@mantine/core';
import { IconCopy, IconSearch } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';

export function OutputPane({
  output,
  error,
  maxHeight = '65vh',
  title,
}: {
  output?: string | null;
  error?: string | null;
  maxHeight?: string | number;
  title?: string;
}) {
  const [filter, setFilter] = useState('');
  const raw = [output, error].filter(Boolean).join('\n--- stderr ---\n') || '(no output)';
  const lines = raw.split('\n');
  const shown =
    filter.trim() === ''
      ? lines
      : lines.filter((l) => l.toLowerCase().includes(filter.toLowerCase()));
  const text = shown.join('\n');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(raw);
      notifications.show({ message: 'Copied output', color: 'green' });
    } catch {
      notifications.show({ message: 'Copy failed', color: 'red' });
    }
  };

  return (
    <Box>
      <Group justify="space-between" mb="xs" wrap="wrap" gap="xs">
        {title ? (
          <Text size="sm" fw={600}>
            {title}
          </Text>
        ) : (
          <span />
        )}
        <Group gap="xs">
          <TextInput
            size="xs"
            placeholder="Filter lines…"
            leftSection={<IconSearch size={14} />}
            value={filter}
            onChange={(e) => setFilter(e.currentTarget.value)}
            w={200}
          />
          <Tooltip label="Copy full output">
            <ActionIcon variant="light" onClick={copy} aria-label="Copy output">
              <IconCopy size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
      <ScrollArea h={maxHeight} type="auto" offsetScrollbars>
        <Code block style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12 }}>
          {text}
        </Code>
      </ScrollArea>
    </Box>
  );
}
