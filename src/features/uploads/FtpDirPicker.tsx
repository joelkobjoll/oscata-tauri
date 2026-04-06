import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FolderOpen, ChevronRight, Loader2, ChevronLeft } from "lucide-react";

interface FtpDirPickerProps {
  initialPath: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}

/** Returns '/' if the path looks like a local OS path, otherwise returns it as-is. */
function sanitizeFtpPath(p: string): string {
  if (!p) return "/";
  // macOS / Linux home dirs, Windows drive letters
  if (
    p.startsWith("/Users/") ||
    p.startsWith("/home/") ||
    /^[A-Za-z]:[/\\]/.test(p)
  ) {
    return "/";
  }
  return p || "/";
}

export default function FtpDirPicker({
  initialPath,
  onSelect,
  onClose,
}: FtpDirPickerProps) {
  const [path, setPath] = useState(() => sanitizeFtpPath(initialPath));
  const [dirs, setDirs] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Load the initial path automatically when the picker opens
  useEffect(() => {
    load(sanitizeFtpPath(initialPath));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async (p: string) => {
    setLoading(true);
    setError("");
    try {
      const result = await invoke<string[]>("ftp_list_dir", { path: p });
      setPath(p);
      setDirs(result.sort((a, b) => a.localeCompare(b)));
    } catch (e: unknown) {
      // If the directory doesn't exist (550), walk up to the nearest parent that does
      const msg = String(e);
      if (
        msg.includes("550") ||
        msg.toLowerCase().includes("failed to change directory")
      ) {
        const parent = p.replace(/\/[^/]+\/?$/, "") || "/";
        if (parent !== p) {
          // Try the parent silently — keep going up until we succeed or hit root
          setError(`Carpeta no encontrada, abriendo: ${parent}`);
          setLoading(false);
          load(parent);
          return;
        }
      }
      setError(msg);
      setDirs([]);
    } finally {
      setLoading(false);
    }
  };

  const goToRoot = () => load("/");

  const goUp = () => {
    const parent = path.replace(/\/[^/]+\/?$/, "") || "/";
    load(parent);
  };

  const enter = (dir: string) => {
    const newPath = `${path.replace(/\/$/, "")}/${dir}`;
    load(newPath);
  };

  // Breadcrumb segments
  const segments = path.split("/").filter(Boolean);

  return (
    <div
      style={{
        position: "absolute",
        top: "calc(100% + 4px)",
        left: 0,
        right: 0,
        zIndex: 100,
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        overflow: "hidden",
      }}
    >
      {/* Breadcrumb / current path */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "8px 10px",
          borderBottom: "1px solid var(--color-border)",
          background: "var(--color-surface-2)",
          flexWrap: "wrap",
        }}
      >
        {path !== "/" && (
          <button
            onClick={goUp}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--color-text-muted)",
              display: "flex",
              padding: "2px 4px",
              flexShrink: 0,
            }}
          >
            <ChevronLeft size={13} />
          </button>
        )}
        <span
          style={{
            fontSize: 11,
            color: "var(--color-text-muted)",
            fontFamily: "monospace",
          }}
        >
          /
        </span>
        {segments.map((seg, i) => (
          <span
            key={i}
            style={{ display: "flex", alignItems: "center", gap: 2 }}
          >
            <span
              style={{
                fontSize: 11,
                color: "var(--color-text-muted)",
                fontFamily: "monospace",
              }}
            >
              {seg}
            </span>
            {i < segments.length - 1 && (
              <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                /
              </span>
            )}
          </span>
        ))}
        {loading && (
          <Loader2
            size={12}
            color="var(--color-primary)"
            style={{ animation: "spin 1s linear infinite", marginLeft: "auto" }}
          />
        )}
      </div>

      {/* Directory list */}
      <div style={{ maxHeight: 220, overflowY: "auto" }}>
        {dirs === null && !loading && !error && (
          <div
            style={{
              fontSize: 11,
              color: "var(--color-text-muted)",
              padding: "10px",
              textAlign: "center",
            }}
          >
            Cargando…
          </div>
        )}

        {error && (
          <div
            style={{
              fontSize: 11,
              color: "var(--color-danger)",
              padding: "8px 10px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <span style={{ flex: 1 }}>{error}</span>
            {path !== "/" && (
              <button
                onClick={goToRoot}
                style={{
                  background: "none",
                  border: "1px solid var(--color-danger)",
                  borderRadius: "var(--radius)",
                  color: "var(--color-danger)",
                  fontSize: 11,
                  padding: "3px 8px",
                  cursor: "pointer",
                  flexShrink: 0,
                  whiteSpace: "nowrap",
                }}
              >
                Ir a raíz (/)
              </button>
            )}
          </div>
        )}

        {dirs !== null && dirs.length === 0 && !loading && !error && (
          <div
            style={{
              fontSize: 11,
              color: "var(--color-text-muted)",
              padding: "10px",
              textAlign: "center",
            }}
          >
            Sin subcarpetas
          </div>
        )}

        {dirs?.map((dir) => (
          <button
            key={dir}
            onClick={() => enter(dir)}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "none",
              border: "none",
              borderBottom: "1px solid var(--color-border)",
              cursor: "pointer",
              color: "var(--color-text)",
              fontSize: 12,
              padding: "8px 10px",
              textAlign: "left",
              transition: "background 0.1s ease",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                "var(--color-surface-2)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "none";
            }}
          >
            <FolderOpen
              size={12}
              color="var(--color-text-muted)"
              style={{ flexShrink: 0 }}
            />
            <span
              style={{
                flex: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {dir}
            </span>
            <ChevronRight
              size={12}
              color="var(--color-text-muted)"
              style={{ flexShrink: 0 }}
            />
          </button>
        ))}
      </div>

      {/* Footer actions */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 8,
          padding: "8px 10px",
          borderTop: "1px solid var(--color-border)",
          background: "var(--color-surface-2)",
        }}
      >
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius)",
            color: "var(--color-text-muted)",
            fontSize: 12,
            padding: "5px 10px",
            cursor: "pointer",
          }}
        >
          Cancelar
        </button>
        <button
          onClick={() => {
            onSelect(path);
            onClose();
          }}
          style={{
            background: "var(--color-primary)",
            border: "none",
            borderRadius: "var(--radius)",
            color: "#fff",
            fontSize: 12,
            fontWeight: 600,
            padding: "5px 12px",
            cursor: "pointer",
          }}
        >
          Seleccionar esta carpeta
        </button>
      </div>
    </div>
  );
}
