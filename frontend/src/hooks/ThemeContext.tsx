/**
 * OpenVox GUI - ThemeContext.tsx
 * 
 * Component documentation to be expanded.
 */
import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export type AppTheme = 'light' | 'dark' | 'robots';

interface ThemeContextType {
  theme: AppTheme;
  setTheme: (t: AppTheme) => void;
  isDark: boolean;
  isRobots: boolean;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'light',
  setTheme: () => {},
  isDark: false,
  isRobots: false,
});

export function useAppTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<AppTheme>(() => {
    const stored = localStorage.getItem('openvox_theme');
    if (stored === 'light' || stored === 'dark' || stored === 'robots') {
      return stored;
    }
    // Migration from old theme names
    if (stored === 'casual') return 'robots';
    if (stored === 'formal') return 'light';
    return 'light';
  });

  const setTheme = (t: AppTheme) => {
    setThemeState(t);
    localStorage.setItem('openvox_theme', t);
    // persist to backend (fire-and-forget)
    const token = localStorage.getItem('openvox_token');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    fetch('/api/config/preferences', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ theme: t }),
    }).catch(() => {});
  };

  return (
    <ThemeContext.Provider value={{ 
      theme, 
      setTheme, 
      isDark: theme === 'dark' || theme === 'robots',
      isRobots: theme === 'robots' 
    }}>
      {children}
    </ThemeContext.Provider>
  );
}
