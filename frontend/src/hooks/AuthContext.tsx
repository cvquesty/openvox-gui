import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface User {
  username: string;
  role: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  login: async () => {},
  logout: () => {},
  loading: true,
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // On mount, check if we have a stored token and validate it
  useEffect(() => {
    const stored = localStorage.getItem('openvox_token');
    if (stored) {
      // Validate the token by calling /api/auth/me
      fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${stored}` },
      })
        .then((res) => {
          if (res.ok) return res.json();
          throw new Error('Invalid token');
        })
        .then((data) => {
          setUser({ username: data.user_id || data.username, role: data.role });
          setToken(stored);
        })
        .catch(() => {
          localStorage.removeItem('openvox_token');
        })
        .finally(() => setLoading(false));
    } else {
      // Also check if auth is even required
      fetch('/api/auth/status')
        .then((res) => res.json())
        .then((data) => {
          if (!data.auth_required) {
            // No auth needed, set anonymous user
            setUser({ username: 'anonymous', role: 'admin' });
          }
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, []);

  const login = async (username: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Login failed' }));
      throw new Error(err.detail || 'Login failed');
    }
    const data = await res.json();
    const newToken = data.token;
    setToken(newToken);
    setUser(data.user);
    localStorage.setItem('openvox_token', newToken);
  };

  const logout = () => {
    fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
    setToken(null);
    localStorage.removeItem('openvox_token');
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}
