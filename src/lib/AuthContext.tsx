import { createContext, useContext, useEffect, useState } from "react";
import { isTauri, getToken, setToken, clearToken, apiBase } from "./transport";

export interface WebUser {
  id: number;
  email: string;
  role: "admin" | "editor" | "user";
  is_active: boolean;
}

interface AuthState {
  /** null = not checked, false = unauthenticated, WebUser = authenticated */
  user: WebUser | null | false;
  token: string | null;
  login: (
    email: string,
    password: string,
    otp?: string,
  ) => Promise<{ otpRequired?: boolean; challengeId?: string }>;
  verifyOtp: (challengeId: string, code: string) => Promise<void>;
  acceptInvite: (
    token: string,
    email: string,
    password: string,
  ) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  token: null,
  login: async () => ({}),
  verifyOtp: async () => {},
  acceptInvite: async () => {},
  logout: () => {},
  refresh: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<WebUser | null | false>(null);
  const [token, setTokenState] = useState<string | null>(getToken);

  const refresh = async () => {
    const tok = getToken();
    if (!tok) {
      setUser(false);
      return;
    }
    try {
      const response = await fetch(`${apiBase}/auth/me`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (response.ok) {
        const u = await response.json();
        setUser(u);
      } else {
        clearToken();
        setTokenState(null);
        setUser(false);
      }
    } catch {
      setUser(false);
    }
  };

  useEffect(() => {
    if (!isTauri()) {
      refresh();
    }
  }, []);

  const login = async (
    email: string,
    password: string,
    otpCode?: string,
  ): Promise<{ otpRequired?: boolean; challengeId?: string }> => {
    const response = await fetch(`${apiBase}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Login failed");

    if (data.state === "otp_required") {
      if (otpCode) {
        // Verify OTP immediately
        const otpResp = await fetch(`${apiBase}/auth/otp/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            challenge_id: data.challenge_id,
            code: otpCode,
          }),
        });
        const otpData = await otpResp.json();
        if (!otpResp.ok)
          throw new Error(otpData.error ?? "OTP verification failed");
        setToken(otpData.token);
        setTokenState(otpData.token);
        setUser(otpData.user);
        return {};
      }
      return { otpRequired: true, challengeId: data.challenge_id };
    }

    setToken(data.token);
    setTokenState(data.token);
    setUser(data.user);
    return {};
  };

  const logout = () => {
    const tok = getToken();
    if (tok) {
      fetch(`${apiBase}/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tok}` },
      }).catch(() => {});
    }
    clearToken();
    setTokenState(null);
    setUser(false);
  };

  const verifyOtp = async (
    challengeId: string,
    code: string,
  ): Promise<void> => {
    const response = await fetch(`${apiBase}/auth/otp/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challenge_id: challengeId, code }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "OTP verification failed");
    setToken(data.token);
    setTokenState(data.token);
    setUser(data.user);
  };

  const acceptInvite = async (
    token: string,
    email: string,
    password: string,
  ): Promise<void> => {
    const response = await fetch(`${apiBase}/auth/invite/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, email, password }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Invite acceptance failed");

    if (data.state !== "ok") {
      throw new Error("Invite acceptance did not return a session");
    }
    setToken(data.token);
    setTokenState(data.token);
    setUser(data.user);
  };

  return (
    <AuthContext.Provider
      value={{ user, token, login, verifyOtp, acceptInvite, logout, refresh }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
