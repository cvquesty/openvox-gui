/**
 * In-flight / recent operator activity (sruiux1 P0 #1 / #3).
 */
import { createContext, useCallback, useContext, useMemo, useState, ReactNode } from 'react';

export type ActivityItem = {
  id: string;
  label: string;
  status: 'running' | 'done' | 'error';
  startedAt: number;
  href?: string;
  detail?: string;
};

type ActivityContextValue = {
  items: ActivityItem[];
  begin: (label: string, opts?: { href?: string; id?: string }) => string;
  end: (id: string, status?: 'done' | 'error', detail?: string) => void;
};

const ActivityContext = createContext<ActivityContextValue | null>(null);

export function ActivityProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ActivityItem[]>([]);

  const begin = useCallback((label: string, opts?: { href?: string; id?: string }) => {
    const id = opts?.id || `act-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setItems((prev) => [
      { id, label, status: 'running', startedAt: Date.now(), href: opts?.href },
      ...prev.filter((i) => i.id !== id).slice(0, 19),
    ]);
    return id;
  }, []);

  const end = useCallback((id: string, status: 'done' | 'error' = 'done', detail?: string) => {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, status, detail } : i))
    );
  }, []);

  const value = useMemo(() => ({ items, begin, end }), [items, begin, end]);
  return <ActivityContext.Provider value={value}>{children}</ActivityContext.Provider>;
}

export function useActivity() {
  const ctx = useContext(ActivityContext);
  if (!ctx) {
    return {
      items: [] as ActivityItem[],
      begin: (_label: string, _opts?: { href?: string; id?: string }) => 'noop',
      end: (_id: string, _status?: 'done' | 'error', _detail?: string) => {},
    };
  }
  return ctx;
}
