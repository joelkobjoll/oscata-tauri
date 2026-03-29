import { useState } from "react";
import { useAuth } from "../lib/AuthContext";

interface InviteAcceptProps {
  token: string;
  onAccepted: () => void;
}

export default function InviteAccept({ token, onAccepted }: InviteAcceptProps) {
  const { acceptInvite } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");

    if (!email.trim()) {
      setError("Email is required.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      await acceptInvite(token, email, password);
      onAccepted();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to accept invite");
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
    maxWidth: 440,
    borderRadius: "var(--radius-lg)",
    border: "1px solid var(--color-border)",
    background: "var(--color-surface)",
    padding: "2rem",
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

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--color-text-muted)",
    marginBottom: 6,
  };

  const buttonStyle: React.CSSProperties = {
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

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
          <div style={{ fontSize: 26, fontWeight: 800, color: "var(--color-text)", letterSpacing: "-0.03em" }}>
            Accept Invitation
          </div>
          <div style={{ fontSize: 14, color: "var(--color-text-muted)", marginTop: 4 }}>
            Complete your account setup to join Oscata.
          </div>
        </div>

        <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
          <div>
            <label style={labelStyle}>Email</label>
            <input style={inputStyle} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </div>

          <div>
            <label style={labelStyle}>Password</label>
            <input style={inputStyle} type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
          </div>

          <div>
            <label style={labelStyle}>Confirm password</label>
            <input style={inputStyle} type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} minLength={8} required />
          </div>

          {error && (
            <div style={{ fontSize: 13, color: "var(--color-danger)", padding: "0.5rem 0.75rem", borderRadius: "var(--radius)", background: "color-mix(in srgb, var(--color-danger) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--color-danger) 30%, transparent)" }}>
              {error}
            </div>
          )}

          <button type="submit" style={buttonStyle} disabled={loading}>
            {loading ? "Accepting invite..." : "Create account"}
          </button>
        </form>
      </div>
    </div>
  );
}
