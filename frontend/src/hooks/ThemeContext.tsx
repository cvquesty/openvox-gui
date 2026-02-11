import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export type AppTheme = 'casual' | 'formal';

interface ThemeContextType {
  theme: AppTheme;
  setTheme: (t: AppTheme) => void;
  isFormal: boolean;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'casual',
  setTheme: () => {},
  isFormal: false,
});

export function useAppTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<AppTheme>(() => {
    const stored = localStorage.getItem('openvox_theme');
    return (stored === 'formal' ? 'formal' : 'casual') as AppTheme;
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
    <ThemeContext.Provider value={{ theme, setTheme, isFormal: theme === 'formal' }}>
      {children}
    </ThemeContext.Provider>
  );
}
