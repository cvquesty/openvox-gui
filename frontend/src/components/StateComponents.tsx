/**
 * Consistent loading / empty / error states (sruiux1 P0 #3).
 */
import { ReactNode } from 'react';
import { Alert, Button, Center, Stack, Text, Title, Skeleton, Table } from '@mantine/core';
import { IconAlertCircle, IconInbox } from '@tabler/icons-react';

export function LoadingState({ height = 400, label }: { height?: number | string; label?: string }) {
  return (
    <Center h={height}>
      <Stack align="center" gap="sm">
        <Skeleton height={48} width={48} circle />
        <Skeleton height={12} width={160} />
        {label && (
          <Text size="sm" c="dimmed">
            {label}
          </Text>
        )}
      </Stack>
    </Center>
  );
}

export function EmptyState({
  title = 'Nothing here yet',
  description,
  action,
  icon,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <Center py="xl" px="md">
      <Stack align="center" gap="sm" maw={420} ta="center">
        {icon ?? <IconInbox size={40} stroke={1.25} opacity={0.45} />}
        <Title order={4}>{title}</Title>
        {description && (
          <Text size="sm" c="dimmed">
            {description}
          </Text>
        )}
        {action}
      </Stack>
    </Center>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <Alert
      color="red"
      icon={<IconAlertCircle size={18} />}
      title={title}
      m="md"
    >
      <Stack gap="sm">
        <Text size="sm" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {message || 'An unexpected error occurred.'}
        </Text>
        {onRetry && (
          <Button size="xs" variant="light" color="red" onClick={onRetry} w="fit-content">
            Retry
          </Button>
        )}
      </Stack>
    </Alert>
  );
}

export function SkeletonTable({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <Table>
      <Table.Thead>
        <Table.Tr>
          {Array.from({ length: cols }).map((_, i) => (
            <Table.Th key={i}>
              <Skeleton height={12} width="70%" />
            </Table.Th>
          ))}
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {Array.from({ length: rows }).map((_, r) => (
          <Table.Tr key={r}>
            {Array.from({ length: cols }).map((_, c) => (
              <Table.Td key={c}>
                <Skeleton height={10} />
              </Table.Td>
            ))}
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
