import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ApiError, api, type User } from "../lib/api";

type AuthStatus = "loading" | "authenticated" | "anonymous";

interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  error: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api
      .me(controller.signal)
      .then((nextUser) => {
        if (controller.signal.aborted) return;
        setUser(nextUser);
        setStatus("authenticated");
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setUser(null);
        setStatus("anonymous");
        if (!(reason instanceof ApiError && reason.status === 401)) {
          setError(reason instanceof Error ? reason.message : "Could not reach the server.");
        }
      });
    return () => controller.abort();
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    setError(null);
    const nextUser = await api.login(username, password);
    setUser(nextUser);
    setStatus("authenticated");
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // The local UI still returns to the login screen if the network fails.
    } finally {
      setUser(null);
      setStatus("anonymous");
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, error, login, logout, clearError }),
    [status, user, error, login, logout, clearError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider.");
  return value;
}
