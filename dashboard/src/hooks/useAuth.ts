import { useState, useEffect, useCallback } from "react";
import { api, ApiError } from "../api/client";

interface User {
  id: string;
  username: string;
  email: string | null;
  role: string;
  totpEnabled: boolean;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  setupComplete: boolean | null;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    loading: true,
    setupComplete: null,
  });

  const checkStatus = useCallback(async () => {
    try {
      const { setupComplete } = await api<{ setupComplete: boolean }>(
        "/auth/status"
      );
      setState((s) => ({ ...s, setupComplete }));

      if (setupComplete) {
        try {
          const { user } = await api<{ user: User }>("/auth/me");
          setState((s) => ({ ...s, user, loading: false }));
        } catch {
          setState((s) => ({ ...s, user: null, loading: false }));
        }
      } else {
        setState((s) => ({ ...s, loading: false }));
      }
    } catch {
      setState((s) => ({ ...s, loading: false }));
    }
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const setup = async (input: {
    username: string;
    email: string;
    password: string;
  }) => {
    const { user } = await api<{ user: User }>("/auth/setup", {
      method: "POST",
      body: JSON.stringify(input),
    });
    setState({ user, loading: false, setupComplete: true });
  };

  const login = async (input: {
    username: string;
    password: string;
    totpCode?: string;
  }) => {
    const data = await api<{ user?: User; requireTotp?: boolean }>(
      "/auth/login",
      {
        method: "POST",
        body: JSON.stringify(input),
      }
    );

    if (data.requireTotp) {
      return { requireTotp: true };
    }

    if (data.user) {
      setState((s) => ({ ...s, user: data.user! }));
    }

    return { requireTotp: false };
  };

  const logout = async () => {
    await api("/auth/logout", { method: "POST" });
    setState((s) => ({ ...s, user: null }));
  };

  return { ...state, setup, login, logout, refresh: checkStatus };
}
