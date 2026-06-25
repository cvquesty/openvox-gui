/**
 * Mantine confirm dialog (sruiux1 P0 / quick win — replace window.confirm).
 */
import { Modal, Text, Group, Button, Stack, List } from '@mantine/core';

export interface ConfirmModalProps {
  opened: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  body: string;
  /** Optional bullet details (e.g. resolved targets) */
  details?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  confirmColor?: string;
  loading?: boolean;
  /** Destructive / privileged tone */
  danger?: boolean;
}

export function ConfirmModal({
  opened,
  onClose,
  onConfirm,
  title,
  body,
  details,
  confirmLabel = 'Continue',
  cancelLabel = 'Cancel',
  confirmColor,
  loading,
  danger,
}: ConfirmModalProps) {
  return (
    <Modal opened={opened} onClose={onClose} title={title} centered>
      <Stack gap="md">
        <Text size="sm">{body}</Text>
        {details && details.length > 0 && (
          <List size="sm" spacing={4} withPadding>
            {details.slice(0, 20).map((d) => (
              <List.Item key={d}>{d}</List.Item>
            ))}
            {details.length > 20 && (
              <List.Item>…and {details.length - 20} more</List.Item>
            )}
          </List>
        )}
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            color={confirmColor ?? (danger ? 'red' : 'blue')}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
