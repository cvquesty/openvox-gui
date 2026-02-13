import { useState, useEffect } from 'react';
import {
  Center, Card, Title, TextInput, PasswordInput, Button, Alert, Stack,
  Group, Text,
} from '@mantine/core';
import { IconLock } from '@tabler/icons-react';
import { useAuth } from '../hooks/AuthContext';
import { config } from '../services/api';
import { useAppTheme } from '../hooks/ThemeContext';

export function LoginPage() {
  const { login } = useAuth();
  const { isFormal } = useAppTheme();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [appName, setAppName] = useState('OpenVox GUI');

  useEffect(() => {
    config.getAppName().then((data: any) => {
      if (data?.app_name) { setAppName(data.app_name); document.title = data.app_name; }
    }).catch(() => {});
  }, []);

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
    <Center style={{ minHeight: '100vh', background: isFormal ? '#f8f9fa' : 'linear-gradient(135deg, #1a1b2e 0%, #252540 100%)' }}>
      <Card shadow="xl" padding="xl" radius="lg" style={{ width: 400 }}>
        <Stack align="center" mb="lg">
          <img src={isFormal ? "/openvox-logo.svg" : "/openvox-logo-orange.svg"} alt="OpenVox" style={{ height: 72 }} />
          <Title order={2}>{appName}</Title>
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
              color={isFormal ? '#0D6EFD' : '#EC8622'}
            >
              Sign In
            </Button>
          </Stack>
        </form>

        <Text size="xs" c="dimmed" ta="center" mt="lg">
          OpenVox GUI v1.2.0
        </Text>
      </Card>
    </Center>
  );
}
