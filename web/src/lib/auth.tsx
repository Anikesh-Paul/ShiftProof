import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Models } from "appwrite";
import { account } from "./appwrite";
import { getErrorMessage, isUnauthorized } from "./errors";
import { rememberStaffName } from "./staffNames";
import type { RoleLabel } from "../types/shiftproof";

export type AppRole = RoleLabel | "none";

type AuthState = {
  user: Models.User<Models.Preferences> | null;
  role: AppRole;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  clearError: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

/** Manager label wins if both present; demo users are single-role. */
export function roleFromLabels(labels: string[] | undefined): AppRole {
  if (!labels?.length) return "none";
  if (labels.includes("manager")) return "manager";
  if (labels.includes("staff")) return "staff";
  return "none";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Models.User<Models.Preferences> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const me = await account.get();
      setUser(me);
      rememberStaffName(me.$id, me.name);
      setError(null);
    } catch (err) {
      setUser(null);
      if (!isUnauthorized(err)) {
        setError(getErrorMessage(err));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    setError(null);
    try {
      await account.createEmailPasswordSession({ email, password });
      const me = await account.get();
      setUser(me);
      rememberStaffName(me.$id, me.name);
    } catch (err) {
      setUser(null);
      setError(getErrorMessage(err, "Login failed"));
      throw err;
    }
  }, []);

  const logout = useCallback(async () => {
    setError(null);
    try {
      await account.deleteSession({ sessionId: "current" });
    } catch (err) {
      // Still clear local session on client
      if (!isUnauthorized(err)) {
        setError(getErrorMessage(err));
      }
    } finally {
      setUser(null);
    }
  }, []);

  const role = useMemo(() => roleFromLabels(user?.labels), [user]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      role,
      loading,
      error,
      login,
      logout,
      refresh,
      clearError: () => setError(null),
    }),
    [user, role, loading, error, login, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
