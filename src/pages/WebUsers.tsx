import { useEffect, useState } from "react";
import { useAuth, type WebUser } from "../lib/AuthContext";
import { apiBase, getToken } from "../lib/transport";
import { formInputStandard, formSelectStandard } from "../lib/formStyles";

interface CreateForm {
  email: string;
  password: string;
  role: string;
}
interface EditForm {
  email?: string;
  password?: string;
  role?: string;
  is_active?: boolean;
}
interface InviteResult {
  invited: boolean;
  invite_token: string;
  invite_link: string;
  expires_at: string;
  email?: string;
  role: "user" | "editor" | "admin";
}

function apiFetch(path: string, method = "GET", body?: unknown) {
  const tok = getToken();
  return fetch(`${apiBase}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const inputStyle = formInputStandard;
const selectStyle = formSelectStandard;

const btnStyle: React.CSSProperties = {
  padding: "0.55rem 1rem",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  background: "var(--color-surface-2)",
  color: "var(--color-text)",
  fontSize: 13,
  cursor: "pointer",
};

export default function WebUsers() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<WebUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<CreateForm>({
    email: "",
    password: "",
    role: "user",
  });
  const [inviting, setInviting] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("user");
  const [inviteResult, setInviteResult] = useState<InviteResult | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({});

  const load = async () => {
    setLoading(true);
    try {
      const r = await apiFetch("/users");
      setUsers(await r.json());
    } catch {
      setError("Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const r = await apiFetch("/users", "POST", form);
      if (!r.ok) {
        const d = await r.json();
        setError(d.error);
        return;
      }
      setForm({ email: "", password: "", role: "user" });
      setCreating(false);
      load();
    } catch {
      setError("Failed to create user");
    }
  };

  const inviteUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const email = inviteEmail.trim();
      const r = await apiFetch("/users/invite", "POST", {
        email: email.length ? email : null,
        role: inviteRole,
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error ?? "Invite failed");
        return;
      }
      setInviteResult(data as InviteResult);
      setInviteEmail("");
      setInviting(false);
      load();
    } catch {
      setError("Failed to invite user");
    }
  };

  const updateUser = async (id: number) => {
    try {
      const r = await apiFetch(`/users/${id}`, "PUT", editForm);
      if (!r.ok) {
        const d = await r.json();
        setError(d.error);
        return;
      }
      setEditId(null);
      load();
    } catch {
      setError("Failed to update user");
    }
  };

  const deleteUser = async (id: number) => {
    if (!confirm("Delete this user?")) return;
    try {
      await apiFetch(`/users/${id}`, "DELETE");
      load();
    } catch {
      setError("Failed to delete user");
    }
  };

  if (me && (me as WebUser).role !== "admin") {
    return (
      <div style={{ padding: 24, color: "var(--color-text-muted)" }}>
        Admin access required.
      </div>
    );
  }

  return (
    <div style={{ padding: "1.5rem", maxWidth: 700 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1.25rem",
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: 20,
            fontWeight: 800,
            color: "var(--color-text)",
          }}
        >
          Web Users
        </h2>
        <button
          style={{
            ...btnStyle,
            background: "var(--color-primary)",
            color: "#fff",
            border: "none",
          }}
          onClick={() => setCreating(true)}
        >
          + Add User
        </button>
        <button
          style={{ ...btnStyle, marginLeft: 8 }}
          onClick={() => setInviting(true)}
        >
          Invite User
        </button>
      </div>

      {inviteResult && (
        <div
          style={{
            color: "var(--color-success)",
            fontSize: 13,
            marginBottom: 12,
            padding: "0.65rem 0.8rem",
            background:
              "color-mix(in srgb, var(--color-success) 12%, transparent)",
            borderRadius: "var(--radius)",
          }}
        >
          <div>
            Invite token created ({inviteResult.role}). Expires:{" "}
            {new Date(inviteResult.expires_at).toLocaleString()}
          </div>
          <div style={{ marginTop: 6, wordBreak: "break-all" }}>
            <strong>Link:</strong> {inviteResult.invite_link}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button
              style={{ ...btnStyle, padding: "0.4rem 0.65rem" }}
              onClick={() =>
                navigator.clipboard
                  .writeText(inviteResult.invite_link)
                  .catch(() => {})
              }
            >
              Copy Link
            </button>
            <button
              style={{ ...btnStyle, padding: "0.4rem 0.65rem" }}
              onClick={() =>
                navigator.clipboard
                  .writeText(inviteResult.invite_token)
                  .catch(() => {})
              }
            >
              Copy Token
            </button>
          </div>
        </div>
      )}

      {error && (
        <div
          style={{
            color: "var(--color-danger)",
            fontSize: 13,
            marginBottom: 12,
            padding: "0.5rem 0.75rem",
            background:
              "color-mix(in srgb, var(--color-danger) 12%, transparent)",
            borderRadius: "var(--radius)",
          }}
        >
          {error}{" "}
          <button
            style={{
              ...btnStyle,
              padding: "2px 8px",
              fontSize: 12,
              marginLeft: 8,
            }}
            onClick={() => setError("")}
          >
            ×
          </button>
        </div>
      )}

      {creating && (
        <form
          onSubmit={createUser}
          style={{
            display: "grid",
            gap: 10,
            padding: "1rem",
            borderRadius: "var(--radius-lg)",
            border: "1px solid var(--color-border)",
            background: "var(--color-surface)",
            marginBottom: 16,
          }}
        >
          <div
            style={{
              fontWeight: 700,
              fontSize: 14,
              color: "var(--color-text)",
              marginBottom: 4,
            }}
          >
            New User
          </div>
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}
          >
            <input
              style={inputStyle}
              type="email"
              placeholder="Email"
              required
              value={form.email}
              onChange={(e) =>
                setForm((f) => ({ ...f, email: e.target.value }))
              }
            />
            <input
              style={inputStyle}
              type="password"
              placeholder="Password (min 8 chars)"
              required
              minLength={8}
              value={form.password}
              onChange={(e) =>
                setForm((f) => ({ ...f, password: e.target.value }))
              }
            />
          </div>
          <select
            style={selectStyle}
            value={form.role}
            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
          >
            <option value="user">User</option>
            <option value="editor">Editor</option>
            <option value="admin">Admin</option>
          </select>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="submit"
              style={{
                ...btnStyle,
                background: "var(--color-primary)",
                color: "#fff",
                border: "none",
              }}
            >
              Create
            </button>
            <button
              type="button"
              style={btnStyle}
              onClick={() => setCreating(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {inviting && (
        <form
          onSubmit={inviteUser}
          style={{
            display: "grid",
            gap: 10,
            padding: "1rem",
            borderRadius: "var(--radius-lg)",
            border: "1px solid var(--color-border)",
            background: "var(--color-surface)",
            marginBottom: 16,
          }}
        >
          <div
            style={{
              fontWeight: 700,
              fontSize: 14,
              color: "var(--color-text)",
              marginBottom: 4,
            }}
          >
            Invite User
          </div>
          <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
            Email is optional. If omitted, share the link/token manually.
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: 10,
            }}
          >
            <input
              style={inputStyle}
              type="email"
              placeholder="Email (optional)"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
            <select
              style={selectStyle}
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
            >
              <option value="user">User</option>
              <option value="editor">Editor</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="submit"
              style={{
                ...btnStyle,
                background: "var(--color-primary)",
                color: "#fff",
                border: "none",
              }}
            >
              Create Invite
            </button>
            <button
              type="button"
              style={btnStyle}
              onClick={() => setInviting(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div style={{ color: "var(--color-text-muted)", fontSize: 14 }}>
          Loading…
        </div>
      ) : (
        <div
          style={{
            borderRadius: "var(--radius-lg)",
            border: "1px solid var(--color-border)",
            overflow: "hidden",
          }}
        >
          {users.map((u, i) => (
            <div
              key={u.id}
              style={{
                padding: "0.85rem 1rem",
                display: "flex",
                alignItems: "center",
                gap: 12,
                borderTop: i > 0 ? "1px solid var(--color-border)" : undefined,
                background: "var(--color-surface)",
              }}
            >
              {editId === u.id ? (
                <div style={{ flex: 1, display: "grid", gap: 8 }}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr auto",
                      gap: 8,
                    }}
                  >
                    <input
                      style={inputStyle}
                      type="email"
                      placeholder="Email"
                      defaultValue={u.email}
                      onChange={(e) =>
                        setEditForm((f) => ({ ...f, email: e.target.value }))
                      }
                    />
                    <input
                      style={inputStyle}
                      type="password"
                      placeholder="New password (optional)"
                      onChange={(e) =>
                        setEditForm((f) => ({
                          ...f,
                          password: e.target.value || undefined,
                        }))
                      }
                    />
                    <select
                      style={selectStyle}
                      defaultValue={u.role}
                      onChange={(e) =>
                        setEditForm((f) => ({ ...f, role: e.target.value }))
                      }
                    >
                      <option value="user">User</option>
                      <option value="editor">Editor</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      style={{
                        ...btnStyle,
                        background: "var(--color-primary)",
                        color: "#fff",
                        border: "none",
                      }}
                      onClick={() => updateUser(u.id)}
                    >
                      Save
                    </button>
                    <button style={btnStyle} onClick={() => setEditId(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: 14,
                        color: "var(--color-text)",
                      }}
                    >
                      {u.email}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--color-text-muted)",
                        marginTop: 2,
                      }}
                    >
                      {u.role} ·{" "}
                      {u.is_active ? (
                        "Active"
                      ) : (
                        <span style={{ color: "var(--color-danger)" }}>
                          Inactive
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    style={btnStyle}
                    onClick={() => {
                      setEditId(u.id);
                      setEditForm({});
                    }}
                  >
                    Edit
                  </button>
                  {(me as WebUser)?.id !== u.id && (
                    <button
                      style={{
                        ...btnStyle,
                        color: "var(--color-danger)",
                        borderColor:
                          "color-mix(in srgb, var(--color-danger) 40%, transparent)",
                      }}
                      onClick={() => deleteUser(u.id)}
                    >
                      Delete
                    </button>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
