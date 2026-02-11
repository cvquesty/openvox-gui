import { Component, ErrorInfo, ReactNode } from 'react';
import { Alert, Button, Code, Stack, Text, Title, Center, Paper } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <Center h="100vh" p="xl">
          <Paper withBorder shadow="md" p="xl" radius="md" maw={600} w="100%">
            <Stack align="center" gap="md">
              <IconAlertTriangle size={48} color="var(--mantine-color-red-6)" />
              <Title order={3} c="red">Something went wrong</Title>
              <Text c="dimmed" ta="center">
                A component crashed. This is a bug — please report it. You can try
                recovering by clicking the button below.
              </Text>
              <Alert color="red" variant="light" w="100%" title={this.state.error?.message || 'Unknown error'}>
                <Code block style={{ fontSize: 11, maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                  {this.state.errorInfo?.componentStack || 'No stack trace available'}
                </Code>
              </Alert>
              <Button onClick={this.handleReset} color="blue" variant="outline">
                Try to Recover
              </Button>
              <Button onClick={() => window.location.reload()} variant="subtle" color="gray" size="xs">
                Reload Page
              </Button>
            </Stack>
          </Paper>
        </Center>
      );
    }

    return this.props.children;
  }
}
