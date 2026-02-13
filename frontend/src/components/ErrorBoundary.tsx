import { Component, ErrorInfo, ReactNode } from 'react';
import { Alert, Button, Code, Stack, Text, Title, Center, Paper } from '@mantine/core';
import { IconAlertTriangle, IconReload } from '@tabler/icons-react';
import { isChunkLoadError } from '../utils/versionCheck';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  isVersionError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null, isVersionError: false };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    const isVersionError = isChunkLoadError(error);
    return { hasError: true, error, isVersionError };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null, isVersionError: false });
  };

  render() {
    if (this.state.hasError) {
      // Special handling for version/deployment errors
      if (this.state.isVersionError) {
        return (
          <Center h="100vh" p="xl">
            <Paper withBorder shadow="md" p="xl" radius="md" maw={500} w="100%">
              <Stack align="center" gap="md">
                <IconReload size={48} color="var(--mantine-color-blue-6)" />
                <Title order={3} c="blue">Application Updated</Title>
                <Text c="dimmed" ta="center">
                  A new version of the application has been deployed. Please refresh the page to load the latest version.
                </Text>
                <Button 
                  onClick={() => window.location.reload()} 
                  color="blue" 
                  size="md"
                  leftSection={<IconReload size={16} />}
                >
                  Refresh Page
                </Button>
              </Stack>
            </Paper>
          </Center>
        );
      }

      // Regular error handling
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
