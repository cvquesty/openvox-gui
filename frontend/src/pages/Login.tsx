/**
 * OpenVox GUI - Login.tsx
 * 
 * Component documentation to be expanded.
 */
import { useState, useEffect } from 'react';
import {
  Center, Card, Title, TextInput, PasswordInput, Button, Alert, Stack,
  Group, Text,
} from '@mantine/core';
import { IconLock } from '@tabler/icons-react';
import { useLocation, useNavigate } from 'react-router';
import { useAuth } from '../hooks/AuthContext';
import { config } from '../services/api';
import { useAppTheme } from '../hooks/ThemeContext';
import {
  consumeReturnTo,
  destinationFromLocation,
  peekReturnTo,
  resolvePostLoginDestination,
} from '../utils/returnTo';
import { APP_VERSION } from '../version';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { isDark } = useAppTheme();
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
      // Stay in the SPA. The address bar is still the deep link because
      // login is a mode, not a route. A full reload is not required for
      // chunk upgrades: lazyWithRetry surfaces those, and versionChecker
      // asks for a refresh separately. Reloading here would drop `next`.
      const dest = resolvePostLoginDestination(
        destinationFromLocation(location),
        peekReturnTo(),
      );
      consumeReturnTo();
      navigate(dest, { replace: true });
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Center
      style={{
        minHeight: '100vh',
        background: !isDark
          ? 'radial-gradient(1200px 500px at 50% -10%, rgba(13,110,253,0.08), transparent 60%), #f3f5f8'
          : 'radial-gradient(1200px 500px at 50% -10%, rgba(236,134,34,0.12), transparent 55%), #12131c',
      }}
    >
      <Card shadow="lg" padding="xl" radius="lg" style={{ width: 400, border: '1px solid var(--ov-line)' }}>
        <Stack align="center" mb="lg" gap="xs">
          <img src={!isDark ? "/openvox-logo.svg" : "/openvox-logo-orange.svg"} alt="OpenVox" style={{ height: 56 }} />
          <Title order={2} mt="sm" style={{ letterSpacing: '-0.03em' }}>{appName}</Title>
          <Text size="sm" c="dimmed">Sign in to your fleet</Text>
        </Stack>

        <form onSubmit={handleSubmit}>
          <Stack>
            {error && (
              <Alert color="red" title="Login Failed" withCloseButton onClose={() => setError(null)}>
                <Text size="sm" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {error}
                </Text>
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
              color={!isDark ? '#0D6EFD' : '#EC8622'}
            >
              Sign In
            </Button>
          </Stack>
        </form>

        <Text size="xs" c="dimmed" ta="center" mt="lg">
          OpenVox GUI v{APP_VERSION}
        </Text>
      </Card>
    </Center>
  );
}
