import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Upload,
  AlertTriangle,
  Clock,
  CheckCircle2,
  XCircle,
  Trash2,
} from "lucide-react";
import UploadCard from "./UploadCard";
import UploadPrepareModal from "./UploadPrepareModal";
import type { UploadItem } from "./types";
import type { AppLanguage } from "../../utils/mediaLanguage";

interface UploadsTabProps {
  uploads: UploadItem[];
  language: AppLanguage;
  onCancel: (id: number) => void;
  onRetry: (id: number) => void;
  onDelete: (id: number) => void;
  onClearCompleted: () => void;
}

export default function UploadsTab({
  uploads,
  language,
  onCancel,
  onRetry,
  onDelete,
  onClearCompleted,
}: UploadsTabProps) {
  const [showModal, setShowModal] = useState(false);
  const [ffprobeAvailable, setFfprobeAvailable] = useState(false);
  const [writeOk, setWriteOk] = useState<boolean | null>(null);
  const [checkingWrite, setCheckingWrite] = useState(true);

  useEffect(() => {
    invoke<string | null>("check_ffprobe")
      .then((p) => setFfprobeAvailable(p != null))
      .catch(() => setFfprobeAvailable(false));

    invoke<boolean>("check_ftp_write_permission")
      .then((ok) => setWriteOk(ok))
      .catch(() => setWriteOk(false))
      .finally(() => setCheckingWrite(false));
  }, []);

  const active = uploads.filter(
    (u) => u.status === "uploading" || u.status === "queued",
  );
  const history = uploads.filter(
    (u) =>
      u.status === "done" || u.status === "error" || u.status === "cancelled",
  );

  const uploading = uploads.filter((u) => u.status === "uploading").length;
  const queued = uploads.filter((u) => u.status === "queued").length;
  const done = uploads.filter((u) => u.status === "done").length;
  const errors = uploads.filter((u) => u.status === "error").length;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        padding: "20px",
        maxWidth: 900,
        margin: "0 auto",
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: 18,
            fontWeight: 700,
            color: "var(--color-text)",
            flex: 1,
          }}
        >
          Subidas
        </h2>

        {/* Write permission warning */}
        {!checkingWrite && writeOk === false && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "rgba(224,85,85,0.1)",
              border: "1px solid rgba(224,85,85,0.3)",
              borderRadius: "var(--radius-full)",
              padding: "5px 12px",
              fontSize: 12,
              color: "var(--color-danger)",
            }}
          >
            <AlertTriangle size={13} />
            Sin permiso de escritura en el FTP
          </div>
        )}

        <button
          disabled={!checkingWrite && writeOk === false}
          onClick={() => setShowModal(true)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            background: "var(--color-primary)",
            border: "none",
            borderRadius: "var(--radius)",
            color: "#fff",
            fontSize: 13,
            fontWeight: 600,
            padding: "9px 18px",
            cursor:
              !checkingWrite && writeOk === false ? "not-allowed" : "pointer",
            opacity: !checkingWrite && writeOk === false ? 0.5 : 1,
            transition: "opacity 0.15s ease",
          }}
        >
          <Upload size={14} />
          Subir archivos
        </button>
      </div>

      {/* Stats */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 10,
        }}
      >
        <StatCard
          label="Subiendo"
          value={uploading}
          icon={<Upload size={14} color="var(--color-primary)" />}
          color="var(--color-primary)"
        />
        <StatCard
          label="En cola"
          value={queued}
          icon={<Clock size={14} color="var(--color-text-muted)" />}
          color="var(--color-text-muted)"
        />
        <StatCard
          label="Completados"
          value={done}
          icon={<CheckCircle2 size={14} color="var(--color-success)" />}
          color="var(--color-success)"
        />
        <StatCard
          label="Errores"
          value={errors}
          icon={<XCircle size={14} color="var(--color-danger)" />}
          color="var(--color-danger)"
        />
      </div>

      {/* Active / queued */}
      {active.length > 0 && (
        <Section title={`Activos (${active.length})`}>
          {active.map((item) => (
            <UploadCard
              key={item.id}
              item={item}
              language={language}
              onCancel={onCancel}
              onRetry={onRetry}
              onDelete={onDelete}
            />
          ))}
        </Section>
      )}

      {/* History */}
      {history.length > 0 && (
        <Section
          title={`Historial (${history.length})`}
          action={
            <button
              onClick={onClearCompleted}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                background: "none",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius)",
                color: "var(--color-text-muted)",
                fontSize: 12,
                padding: "4px 10px",
                cursor: "pointer",
              }}
            >
              <Trash2 size={12} />
              Limpiar
            </button>
          }
        >
          {history.map((item) => (
            <UploadCard
              key={item.id}
              item={item}
              language={language}
              onCancel={onCancel}
              onRetry={onRetry}
              onDelete={onDelete}
            />
          ))}
        </Section>
      )}

      {/* Empty state */}
      {uploads.length === 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            padding: "60px 20px",
            color: "var(--color-text-muted)",
          }}
        >
          <Upload size={40} strokeWidth={1} />
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: "var(--color-text)",
            }}
          >
            No hay subidas
          </div>
          <div style={{ fontSize: 13 }}>
            Pulsa "Subir archivos" para añadir archivos a la cola
          </div>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <UploadPrepareModal
          ffprobeAvailable={ffprobeAvailable}
          onClose={() => setShowModal(false)}
          onQueued={() => setShowModal(false)}
        />
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius)",
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {icon}
        <span
          style={{
            fontSize: 11,
            color: "var(--color-text-muted)",
            fontWeight: 600,
          }}
        >
          {label.toUpperCase()}
        </span>
      </div>
      <span style={{ fontSize: 22, fontWeight: 700, color }}>{value}</span>
    </div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "var(--color-text-muted)",
            letterSpacing: "0.06em",
            flex: 1,
          }}
        >
          {title.toUpperCase()}
        </span>
        {action}
      </div>
      {children}
    </div>
  );
}
