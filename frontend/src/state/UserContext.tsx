import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, type User } from '../api/client';
import { useBackend } from './BackendContext';

// Remembered per browser so the demo opens with the last user selected (convenience only).
const STORAGE_KEY = 'formcoach.userId';

function readStoredId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredId(id: string | null): void {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage unavailable (private mode etc.) — selection just won't persist
  }
}

interface UserContextValue {
  users: User[];
  user: User | null;
  loading: boolean;
  error: string | null;
  selectUser: (id: string) => void;
  /** Creates a user and selects it. Throws ApiError (409 if the name exists). */
  createUser: (name: string) => Promise<User>;
  reload: () => Promise<void>;
}

const UserContext = createContext<UserContextValue | null>(null);

export function UserProvider({ children }: { children: ReactNode }) {
  const [users, setUsers] = useState<User[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(readStoredId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.listUsers();
      setUsers(list);
      setError(null);
      // Keep the stored selection if it still exists, else fall back to the first user.
      setSelectedId((current) => (current && list.some((u) => u.id === current) ? current : (list[0]?.id ?? null)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const { reconnects } = useBackend();
  useEffect(() => {
    void reload();
  }, [reload, reconnects]);

  useEffect(() => writeStoredId(selectedId), [selectedId]);

  const createUser = useCallback(async (name: string) => {
    const created = await api.createUser(name);
    setUsers((prev) => [...prev, created]);
    setSelectedId(created.id);
    return created;
  }, []);

  const value = useMemo<UserContextValue>(
    () => ({
      users,
      user: users.find((u) => u.id === selectedId) ?? null,
      loading,
      error,
      selectUser: setSelectedId,
      createUser,
      reload,
    }),
    [users, selectedId, loading, error, createUser, reload],
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUser(): UserContextValue {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error('useUser must be used inside <UserProvider>');
  return ctx;
}
