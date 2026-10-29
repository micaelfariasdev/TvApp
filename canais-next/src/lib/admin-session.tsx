"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { appPath } from "@/lib/app-path";

type AdminSessionContextValue = {
  authenticated: boolean;
  isLoading: boolean;
  loginOpen: boolean;
  requestLogin: () => void;
  closeLogin: () => void;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AdminSessionContext = createContext<AdminSessionContextValue | null>(null);

export function AdminSessionProvider({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loginOpen, setLoginOpen] = useState(false);

  useEffect(() => {
    fetch(appPath("/api/session"), { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Falha ao verificar a sessão.");
        setAuthenticated(payload.authenticated === true);
      })
      .catch((error: unknown) => {
        console.error("Falha ao verificar a sessão administrativa:", error);
        setAuthenticated(false);
      })
      .finally(() => setIsLoading(false));
  }, []);

  const login = useCallback(async (password: string) => {
    const response = await fetch(appPath("/api/session"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Não foi possível entrar.");
    setAuthenticated(true);
    setLoginOpen(false);
  }, []);

  const logout = useCallback(async () => {
    const response = await fetch(appPath("/api/session"), { method: "DELETE" });
    if (!response.ok) throw new Error("Não foi possível encerrar a sessão.");
    setAuthenticated(false);
  }, []);

  const value = useMemo(
    () => ({
      authenticated,
      isLoading,
      loginOpen,
      requestLogin: () => setLoginOpen(true),
      closeLogin: () => setLoginOpen(false),
      login,
      logout,
    }),
    [authenticated, isLoading, login, loginOpen, logout],
  );

  return <AdminSessionContext.Provider value={value}>{children}</AdminSessionContext.Provider>;
}

export function useAdminSession() {
  const context = useContext(AdminSessionContext);
  if (!context) throw new Error("useAdminSession precisa estar dentro do AdminSessionProvider.");
  return context;
}
