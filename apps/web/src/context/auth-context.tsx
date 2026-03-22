"use client";

import { createContext, useContext, useCallback, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4002";

interface User {
  id: string;
  email: string;
  name: string | null;
  role: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  login: async () => ({ success: false }),
  logout: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  // Check auth on mount
  useEffect(() => {
    const token = typeof window !== "undefined" ? sessionStorage.getItem("accessToken") : null;
    if (token) {
      setAccessToken(token);
      fetchUser(token);
    } else {
      tryRefresh();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isLoading && !user && pathname !== "/login") {
      router.push("/login");
    }
  }, [isLoading, user, pathname, router]);

  async function fetchUser(token: string) {
    try {
      const res = await fetch(`${API_URL}/api/user/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      } else {
        // Token expired — try refresh
        await tryRefresh();
      }
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }

  async function tryRefresh() {
    try {
      const res = await fetch(`${API_URL}/api/user/refresh`, {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setAccessToken(data.accessToken);
        sessionStorage.setItem("accessToken", data.accessToken);
        await fetchUser(data.accessToken);
        return;
      }
    } catch {
      // ignore
    }
    setUser(null);
    setIsLoading(false);
  }

  const login = useCallback(async (email: string, password: string) => {
    try {
      const res = await fetch(`${API_URL}/api/user/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        return { success: false, error: data.error || "Login failed" };
      }

      setAccessToken(data.accessToken);
      setUser(data.user);
      sessionStorage.setItem("accessToken", data.accessToken);
      return { success: true };
    } catch {
      return { success: false, error: "Connection failed" };
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch(`${API_URL}/api/user/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // ignore
    }
    setUser(null);
    setAccessToken(null);
    sessionStorage.removeItem("accessToken");
    router.push("/login");
  }, [router]);

  // Auto-refresh token every 13 minutes (before 15 min expiry)
  useEffect(() => {
    if (!accessToken) return;
    const interval = setInterval(tryRefresh, 13 * 60 * 1000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
