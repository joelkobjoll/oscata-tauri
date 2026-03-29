import { useState } from "react";
import { useAuth } from "../lib/AuthContext";
import { apiBase } from "../lib/transport";

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      if (challengeId) {
        // Verify OTP
        const response = await fetch(`${apiBase}/auth/otp/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ challenge_id: challengeId, code: otp }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Invalid code");
        // Use regular login flow to store token
        await login(email, password);
      } else {
        const result = await login(email, password);
        if (result.otpRequired && result.challengeId) {
          setChallengeId(result.challengeId);
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const containerStyle: React.CSSProperties = {
    minHeight: "100dvh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--color-bg)",
    padding: "1.5rem",
  };

  const cardStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: 400,
    borderRadius: "var(--radius-lg)",
    border: "1px solid var(--color-border)",
    background: "var(--color-surface)",
    padding: "2rem",
    boxShadow: "0 20px 60px color-mix(in srgb, black 30%, transparent)",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    padding: "0.72rem 0.9rem",
    borderRadius: "var(--radius)",
    border: "1px solid var(--color-border)",
    background: "var(--color-surface-2)",
    color: "var(--color-text)",
    fontSize: 14,
    outline: "none",
  };

  const btnStyle: React.CSSProperties = {
    width: "100%",
    padding: "0.8rem",
    borderRadius: "var(--radius)",
    border: "none",
    background: "var(--color-primary)",
    color: "#fff",
    fontSize: 14,
    fontWeight: 700,
    cursor: loading ? "not-allowed" : "pointer",
    opacity: loading ? 0.7 : 1,
    transition: "opacity 0.15s ease",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--color-text-muted)",
    marginBottom: 6,
  };

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <div style={{ textAlign: "center", marginBottom: "1.75rem" }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: "var(--color-text)", letterSpacing: "-0.03em" }}>
            Oscata
          </div>
          <div style={{ fontSize: 14, color: "var(--color-text-muted)", marginTop: 4 }}>
            {challengeId ? "Enter your one-time code" : "Sign in to continue"}
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 16 }}>
          {!challengeId && (
            <>
              <div>
                <label style={labelStyle}>Email</label>
                <input
                  style={inputStyle}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  autoFocus
                />
              </div>
              <div>
                <label style={labelStyle}>Password</label>
                <input
                  style={inputStyle}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>
            </>
          )}

          {challengeId && (
            <div>
              <label style={labelStyle}>One-time code</label>
              <input
                style={{ ...inputStyle, letterSpacing: "0.2em", textAlign: "center", fontSize: 20 }}
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                required
                autoFocus
              />
              <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 6 }}>
                Check your email for a 6-digit code. It expires in 5 minutes.
              </div>
            </div>
          )}

          {error && (
            <div style={{ fontSize: 13, color: "var(--color-danger)", padding: "0.5rem 0.75rem", borderRadius: "var(--radius)", background: "color-mix(in srgb, var(--color-danger) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--color-danger) 30%, transparent)" }}>
              {error}
            </div>
          )}

          <button type="submit" style={btnStyle} disabled={loading}>
            {loading ? "Signing in…" : challengeId ? "Verify code" : "Sign in"}
          </button>

          {challengeId && (
            <button
              type="button"
              style={{ ...btnStyle, background: "var(--color-surface-2)", color: "var(--color-text-muted)" }}
              onClick={() => { setChallengeId(null); setOtp(""); setError(""); }}
            >
              ← Back
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
