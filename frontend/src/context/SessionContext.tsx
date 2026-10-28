import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { SessionRuntime } from "../lib/session";
import type { RuntimeSnapshot } from "../lib/types";

interface SessionContextValue {
  runtime: SessionRuntime | null;
  startSession: (runtime: SessionRuntime) => Promise<void>;
  closeSession: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [runtime, setRuntime] = useState<SessionRuntime | null>(null);
  const runtimeRef = useRef<SessionRuntime | null>(null);

  useEffect(() => {
    return () => {
      const active = runtimeRef.current;
      runtimeRef.current = null;
      if (active) void active.close();
    };
  }, []);

  const startSession = useCallback(async (next: SessionRuntime) => {
    const previous = runtimeRef.current;
    if (previous) {
      setRuntime(null);
      runtimeRef.current = null;
      await previous.close();
    }
    runtimeRef.current = next;
    setRuntime(next);
  }, []);

  const closeSession = useCallback(async () => {
    const active = runtimeRef.current;
    runtimeRef.current = null;
    setRuntime(null);
    if (active) await active.close();
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({ runtime, startSession, closeSession }),
    [runtime, startSession, closeSession],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider.");
  return value;
}

const emptySubscribe = () => () => {};
const getNullSnapshot = () => null;

export function useSessionSnapshot(): RuntimeSnapshot | null {
  const { runtime } = useSession();
  const subscribe = useCallback(
    (listener: () => void) => (runtime ? runtime.subscribe(listener) : emptySubscribe()),
    [runtime],
  );
  const getSnapshot = useCallback(() => (runtime ? runtime.getSnapshot() : null), [runtime]);
  return useSyncExternalStore(subscribe, getSnapshot, getNullSnapshot);
}
