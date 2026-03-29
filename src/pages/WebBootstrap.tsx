import { useState } from "react";
import { apiBase } from "../lib/transport";

interface WebBootstrapProps {
  onComplete: () => void;
}

export default function WebBootstrap({ onComplete }: WebBootstrapProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setSuccess("");

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
      const response = await fetch(`${apiBase}/auth/bootstrap`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to create admin user");
      }

      setSuccess("Admin account created. You can now sign in.");
      setTimeout(() => onComplete(), 700);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Bootstrap failed");
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
    maxWidth: 460,
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
          <div style={{ fontSize: 27, fontWeight: 800, color: "var(--color-text)", letterSpacing: "-0.03em" }}>
            First-time Setup
          </div>
          <div style={{ fontSize: 14, color: "var(--color-text-muted)", marginTop: 4 }}>
            Create your first admin account to enable WebGUI access.
          </div>
        </div>

        <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
          <div>
            <label style={labelStyle}>Admin email</label>
            <input
              style={inputStyle}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
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
              minLength={8}
              required
            />
          </div>

          <div>
            <label style={labelStyle}>Confirm password</label>
            <input
              style={inputStyle}
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              minLength={8}
              required
            />
          </div>

          {error && (
            <div style={{ fontSize: 13, color: "var(--color-danger)", padding: "0.5rem 0.75rem", borderRadius: "var(--radius)", background: "color-mix(in srgb, var(--color-danger) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--color-danger) 30%, transparent)" }}>
              {error}
            </div>
          )}

          {success && (
            <div style={{ fontSize: 13, color: "var(--color-success)", padding: "0.5rem 0.75rem", borderRadius: "var(--radius)", background: "color-mix(in srgb, var(--color-success) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--color-success) 30%, transparent)" }}>
              {success}
            </div>
          )}

          <button type="submit" style={buttonStyle} disabled={loading}>
            {loading ? "Creating admin..." : "Create admin account"}
          </button>
        </form>
      </div>
    </div>
  );
}
