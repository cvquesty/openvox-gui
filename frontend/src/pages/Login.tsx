import { useState } from 'react';
import {
  Center, Card, Title, TextInput, PasswordInput, Button, Alert, Stack,
  Group, Text,
} from '@mantine/core';
import { IconLock } from '@tabler/icons-react';
import { useAuth } from '../hooks/AuthContext';

export function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(username, password);
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Center style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
      <Card shadow="xl" padding="xl" radius="lg" style={{ width: 400 }}>
        <Stack align="center" mb="lg">
          <img src="/openvox-logo.svg" alt="OpenVox" style={{ height: 72 }} />
          <Title order={2}>OpenVox GUI</Title>
          <Text size="sm" c="dimmed">Sign in to manage your Puppet infrastructure</Text>
        </Stack>

        <form onSubmit={handleSubmit}>
          <Stack>
            {error && (
              <Alert color="red" title="Login Failed" withCloseButton onClose={() => setError(null)}>
                {error}
              </Alert>
            )}

            <TextInput
              label="Username"
              placeholder="Enter your username"
              value={username}
              onChange={(e) => setUsername(e.currentTarget.value)}
              required
              autoFocus
              size="md"
            />

            <PasswordInput
              label="Password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
              required
              size="md"
            />

            <Button
              type="submit"
              fullWidth
              loading={loading}
              size="md"
              mt="sm"
              leftSection={<IconLock size={18} />}
              variant="gradient"
              gradient={{ from: 'violet', to: 'cyan' }}
            >
              Sign In
            </Button>
          </Stack>
        </form>

        <Text size="xs" c="dimmed" ta="center" mt="lg">
          OpenVox GUI v0.2.4
        </Text>
      </Card>
    </Center>
  );
}
