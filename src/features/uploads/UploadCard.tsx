import { useState } from "react";
import {
  AlertCircle,
  Check,
  Clock,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type { UploadItem } from "./types";
import type { AppLanguage } from "../../utils/mediaLanguage";
import { t } from "../../utils/i18n";
import { formatBytes } from "../../lib/format";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatSpeed(bps: number): string {
  if (bps >= 1024 ** 2) return `${(bps / 1024 ** 2).toFixed(1)} MB/s`;
  if (bps >= 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${bps.toFixed(0)} B/s`;
}

function formatEta(bps: number, remaining: number): string {
  if (bps <= 0) return "—";
  const secs = remaining / bps;
  if (secs < 60) return `${Math.ceil(secs)}s`;
  if (secs < 3600) return `${Math.ceil(secs / 60)}m`;
  return `${(secs / 3600).toFixed(1)}h`;
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

const STATUS_COLORS: Record<UploadItem["status"], string> = {
  queued: "var(--color-text-muted)",
  uploading: "var(--color-primary)",
  done: "var(--color-success)",
  error: "var(--color-danger)",
  cancelled: "var(--color-text-muted)",
};

const STATUS_ICONS: Record<UploadItem["status"], React.ReactNode> = {
  queued: <Clock size={12} />,
  uploading: <Upload size={12} />,
  done: <Check size={12} />,
  error: <AlertCircle size={12} />,
  cancelled: <X size={12} />,
};

const STATUS_LABEL_KEY: Record<
  UploadItem["status"],
  keyof ReturnType<typeof t> extends never ? string : any
> = {
  queued: "upload.status.queued",
  uploading: "upload.status.uploading",
  done: "upload.status.done",
  error: "upload.status.error",
  cancelled: "upload.status.cancelled",
};

interface UploadCardProps {
  item: UploadItem;
  language: AppLanguage;
  onCancel: (id: number) => void;
  onRetry: (id: number) => void;
  onDelete: (id: number) => void;
}

export default function UploadCard({
  item,
  language,
  onCancel,
  onRetry,
  onDelete,
}: UploadCardProps) {
  const [hovered, setHovered] = useState(false);
  const pct =
    item.bytes_total > 0
      ? Math.min(100, Math.round((item.bytes_done / item.bytes_total) * 100))
      : 0;
  const remaining = item.bytes_total - item.bytes_done;
  const elapsedMs =
    item.started_at_ms && item.completed_at_ms
      ? item.completed_at_ms - item.started_at_ms
      : item.started_at_ms
        ? Date.now() - item.started_at_ms
        : 0;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: "var(--color-surface)",
        border: `1px solid ${hovered ? "var(--color-border)" : "var(--color-border)"}`,
        borderRadius: "var(--radius-lg)",
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        transition: "border-color 0.15s ease",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        {/* Icon avatar */}
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: "var(--radius)",
            background: "var(--color-surface-2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            color: STATUS_COLORS[item.status],
          }}
        >
          <Upload size={16} />
        </div>

        {/* Title + filename */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {item.media_title && (
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--color-text)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {item.media_title}
            </div>
          )}
          <div
            style={{
              fontSize: 11,
              color: "var(--color-text-muted)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {item.filename}
          </div>
        </div>

        {/* Status badge */}
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 11,
            fontWeight: 600,
            color: STATUS_COLORS[item.status],
            background: `${STATUS_COLORS[item.status]}18`,
            borderRadius: "var(--radius-full)",
            padding: "2px 8px",
            flexShrink: 0,
          }}
        >
          {STATUS_ICONS[item.status]}
          {t(language, STATUS_LABEL_KEY[item.status])}
        </span>
      </div>

      {/* Progress (uploading) */}
      {item.status === "uploading" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 11,
            }}
          >
            <span style={{ color: "var(--color-text)" }}>
              {formatBytes(item.bytes_done)} / {formatBytes(item.bytes_total)}
            </span>
            <span style={{ color: "var(--color-primary)", fontWeight: 600 }}>
              {pct}%
            </span>
          </div>
          <div
            style={{
              height: 4,
              background: "var(--color-surface-2)",
              borderRadius: "var(--radius-full)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${pct}%`,
                background: "var(--color-primary)",
                borderRadius: "var(--radius-full)",
                transition: "width 0.3s ease",
              }}
            />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {item.speed_bps != null && (
              <span
                style={{
                  fontSize: 11,
                  color: "var(--color-text-muted)",
                  background: "var(--color-surface-2)",
                  borderRadius: "var(--radius-full)",
                  padding: "2px 7px",
                }}
              >
                {formatSpeed(item.speed_bps)}
              </span>
            )}
            {item.speed_bps != null && item.bytes_total > 0 && (
              <span
                style={{
                  fontSize: 11,
                  color: "var(--color-text-muted)",
                  background: "var(--color-surface-2)",
                  borderRadius: "var(--radius-full)",
                  padding: "2px 7px",
                }}
              >
                ETA {formatEta(item.speed_bps, remaining)}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Done / error summary */}
      {(item.status === "done" ||
        item.status === "error" ||
        item.status === "cancelled") && (
        <div
          style={{
            display: "flex",
            gap: 6,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          {item.bytes_total > 0 && (
            <span
              style={{
                fontSize: 11,
                color: "var(--color-text-muted)",
                background: "var(--color-surface-2)",
                borderRadius: "var(--radius-full)",
                padding: "2px 7px",
              }}
            >
              {formatBytes(item.bytes_total)}
            </span>
          )}
          {elapsedMs > 1000 && (
            <span
              style={{
                fontSize: 11,
                color: "var(--color-text-muted)",
                background: "var(--color-surface-2)",
                borderRadius: "var(--radius-full)",
                padding: "2px 7px",
              }}
            >
              {formatDuration(elapsedMs)}
            </span>
          )}
          {item.error && (
            <div
              style={{
                width: "100%",
                fontSize: 11,
                color: "var(--color-danger)",
                background: "#e0555518",
                border: "1px solid #e0555528",
                borderRadius: "var(--radius)",
                padding: "6px 10px",
              }}
            >
              {item.error}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {(item.status === "queued" || item.status === "uploading") && (
          <ActionButton
            label={t(language, "upload.cancel")}
            tone="neutral"
            icon={<X size={12} />}
            onClick={() => onCancel(item.id)}
          />
        )}
        {(item.status === "error" || item.status === "cancelled") && (
          <ActionButton
            label={t(language, "upload.retry")}
            tone="primary"
            icon={<RefreshCw size={12} />}
            onClick={() => onRetry(item.id)}
          />
        )}
        {(item.status === "done" ||
          item.status === "error" ||
          item.status === "cancelled") && (
          <ActionButton
            label={t(language, "upload.delete")}
            tone="danger"
            icon={<Trash2 size={12} />}
            onClick={() => {
              const fromFtp = item.status === "done";
              const msg = fromFtp
                ? `¿Eliminar "${item.filename}" de la cola y del servidor FTP?`
                : `¿Eliminar "${item.filename}" de la cola?`;
              if (window.confirm(msg)) onDelete(item.id);
            }}
          />
        )}
      </div>
    </div>
  );
}

// ─── ActionButton ─────────────────────────────────────────────────────────────

interface ActionButtonProps {
  label: string;
  icon: React.ReactNode;
  tone: "neutral" | "primary" | "danger";
  onClick: () => void;
}

const TONE_COLOR: Record<ActionButtonProps["tone"], string> = {
  neutral: "var(--color-text-muted)",
  primary: "var(--color-primary)",
  danger: "var(--color-danger)",
};

function ActionButton({ label, icon, tone, onClick }: ActionButtonProps) {
  const [hov, setHov] = useState(false);
  const color = TONE_COLOR[tone];
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 11,
        fontWeight: 600,
        color,
        background: hov ? `${color}20` : `${color}10`,
        border: `1px solid ${color}30`,
        borderRadius: "var(--radius-full)",
        padding: "4px 10px",
        cursor: "pointer",
        transition: "background 0.15s ease",
      }}
    >
      {icon}
      {label}
    </button>
  );
}
