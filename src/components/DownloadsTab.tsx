import type { DownloadItem } from "../hooks/useDownloads";
import type { AppLanguage } from "../utils/mediaLanguage";
import { t } from "../utils/i18n";

function formatBytes(b: number): string {
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(2)} GB`;
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${b} B`;
}

function formatSpeed(bps?: number): string {
  if (bps == null || bps <= 0) return "";
  if (bps >= 1024 ** 2) return `${(bps / 1024 ** 2).toFixed(1)} MB/s`;
  if (bps >= 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${bps.toFixed(0)} B/s`;
}

function formatEta(language: AppLanguage, bps: number | undefined, done: number, total: number): string {
  if (!bps || bps <= 0 || total <= 0) return "";
  const remaining = total - done;
  const secs = remaining / bps;
  if (secs < 60) return t(language, "downloads.secondsLeft", { count: Math.round(secs) });
  if (secs < 3600) return t(language, "downloads.minutesLeft", { minutes: Math.floor(secs / 60), seconds: Math.round(secs % 60) });
  return t(language, "downloads.hoursLeft", { hours: Math.floor(secs / 3600) });
}

function formatDuration(startMs?: number, endMs?: number): string {
  if (!startMs) return "";
  const end = endMs ?? Date.now();
  const secs = Math.round((end - startMs) / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

function shortPath(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length <= 2) return p;
  return "…/" + parts.slice(-2).join("/");
}

const STATUS_COLORS: Record<DownloadItem["status"], string> = {
  queued: "var(--color-text-muted)",
  downloading: "var(--color-primary)",
  done: "var(--color-success)",
  error: "var(--color-danger)",
  cancelled: "var(--color-text-muted)",
};

function DownloadRow({
  item,
  language,
  onCancel,
  onRetry,
  onOpenFolder,
}: {
  item: DownloadItem;
  language: AppLanguage;
  onCancel: () => void;
  onRetry: () => void;
  onOpenFolder: () => void;
}) {
  const pct = item.bytes_total > 0 ? Math.round((item.bytes_done / item.bytes_total) * 100) : 0;
  const isActive = item.status === "queued" || item.status === "downloading";
  const canRetry = item.status === "error" || item.status === "cancelled";
  const isDone = item.status === "done";

  const borderColor = item.status === "error"
    ? "color-mix(in srgb, var(--color-danger) 40%, transparent)"
    : item.status === "done"
      ? "color-mix(in srgb, var(--color-success) 40%, transparent)"
      : "color-mix(in srgb, var(--color-border) 78%, transparent)";

  return (
    <div style={{ background: "color-mix(in srgb, var(--color-surface) 90%, transparent)", border: `1px solid ${borderColor}`, borderRadius: "var(--radius-lg)", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: "var(--color-text)", fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {item.media_title ?? item.filename}
          </div>
          {item.media_title && item.media_title !== item.filename && (
            <div style={{ color: "var(--color-text-muted)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>
              {item.filename}
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: `color-mix(in srgb, ${STATUS_COLORS[item.status]} 14%, transparent)`, color: STATUS_COLORS[item.status], border: `1px solid color-mix(in srgb, ${STATUS_COLORS[item.status]} 35%, transparent)`, whiteSpace: "nowrap" }}>
            {t(language, `downloads.${item.status}` as never)}
          </span>

          {isActive && <button onClick={onCancel} title={t(language, "downloads.cancel")} style={iconBtn}>✕</button>}
          {canRetry && <button onClick={onRetry} title={t(language, "downloads.retry")} style={{ ...iconBtn, color: "var(--color-primary)", borderColor: "color-mix(in srgb, var(--color-primary) 40%, transparent)" }}>↺</button>}
          {isDone && <button onClick={onOpenFolder} title={t(language, "downloads.openFolder")} style={{ ...iconBtn, color: "var(--color-success)", borderColor: "color-mix(in srgb, var(--color-success) 40%, transparent)" }}>📂</button>}
        </div>
      </div>

      {item.status === "downloading" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--color-text-muted)", fontVariantNumeric: "tabular-nums" }}>
              {formatBytes(item.bytes_done)} / {formatBytes(item.bytes_total)} ({pct}%)
            </span>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {item.speed_bps != null && item.speed_bps > 0 && <span style={{ fontSize: 12, color: "var(--color-primary)", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{formatSpeed(item.speed_bps)}</span>}
              {item.speed_bps && item.bytes_total > 0 && <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{formatEta(language, item.speed_bps, item.bytes_done, item.bytes_total)}</span>}
              <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{formatDuration(item.started_at_ms)}</span>
            </div>
          </div>
          <div style={{ background: "var(--color-surface-2)", borderRadius: 4, height: 6, overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: 4, width: `${pct}%`, transition: "width 0.4s ease", background: pct === 100 ? "var(--color-success)" : "var(--color-primary)" }} />
          </div>
        </div>
      )}

      {item.status === "queued" && <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{t(language, "downloads.waiting")}</div>}

      {isDone && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <span style={{ fontSize: 11, color: "var(--color-text-muted)", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={item.local_path}>
              {shortPath(item.local_path)}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0, alignItems: "center" }}>
            {item.bytes_total > 0 && <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{formatBytes(item.bytes_total)}</span>}
            {item.started_at_ms && item.completed_at_ms && <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{formatDuration(item.started_at_ms, item.completed_at_ms)}</span>}
          </div>
        </div>
      )}

      {item.status === "error" && (
        <div>
          <div style={{ fontSize: 12, color: "var(--color-danger)", marginBottom: 4 }}>⚠ {item.error}</div>
          <div style={{ fontSize: 11, color: "var(--color-text-muted)", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={item.local_path}>
            {shortPath(item.local_path)}
          </div>
        </div>
      )}
    </div>
  );
}

export default function DownloadsTab({
  language,
  downloads,
  cancelDownload,
  clearCompleted,
  retryDownload,
  openDownloadFolder,
}: {
  language: AppLanguage;
  downloads: DownloadItem[];
  cancelDownload: (id: number) => Promise<unknown>;
  clearCompleted: () => Promise<unknown>;
  retryDownload: (id: number) => Promise<unknown>;
  openDownloadFolder: (localPath: string) => Promise<unknown>;
}) {

  const byStatus = (s: DownloadItem["status"]) => downloads.filter((d) => d.status === s).length;
  const downloading = byStatus("downloading");
  const queued = byStatus("queued");
  const done = byStatus("done");
  const errors = byStatus("error");

  const totalSpeed = downloads.filter((d) => d.status === "downloading" && d.speed_bps != null).reduce((sum, d) => sum + (d.speed_bps ?? 0), 0);

  return (
    <div style={{ padding: "16px 0" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {downloading > 0 && <span style={statPill("var(--color-primary)", "color-mix(in srgb, var(--color-primary) 12%, transparent)")}>{t(language, "downloads.downloadingCount", { count: downloading })}</span>}
          {queued > 0 && <span style={statPill("var(--color-text-muted)", "var(--color-surface-2)")}>{t(language, "downloads.queuedCount", { count: queued })}</span>}
          {done > 0 && <span style={statPill("var(--color-success)", "color-mix(in srgb, var(--color-success) 12%, transparent)")}>{t(language, "downloads.doneCount", { count: done })}</span>}
          {errors > 0 && <span style={statPill("var(--color-danger)", "color-mix(in srgb, var(--color-danger) 12%, transparent)")}>{t(language, "downloads.failedCount", { count: errors })}</span>}
          {totalSpeed > 0 && <span style={{ fontSize: 13, color: "var(--color-primary)", fontWeight: 700 }}>↓ {formatSpeed(totalSpeed)}</span>}
          {downloads.length === 0 && <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>{t(language, "downloads.none")}</span>}
        </div>

        {downloads.some((d) => ["done", "error", "cancelled"].includes(d.status)) && (
          <button onClick={clearCompleted} style={{ padding: "6px 14px", border: "1px solid color-mix(in srgb, var(--color-border) 80%, transparent)", borderRadius: "var(--radius-full)", background: "color-mix(in srgb, var(--color-surface-2) 80%, transparent)", color: "var(--color-text-muted)", cursor: "pointer", fontSize: 13 }}>
            {t(language, "downloads.clearCompleted")}
          </button>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {downloads.map((item) => (
          <DownloadRow key={item.id} item={item} language={language} onCancel={() => cancelDownload(item.id)} onRetry={() => retryDownload(item.id)} onOpenFolder={() => openDownloadFolder(item.local_path)} />
        ))}
      </div>
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 999,
  border: "1px solid color-mix(in srgb, var(--color-border) 80%, transparent)",
  background: "transparent",
  color: "var(--color-text-muted)",
  cursor: "pointer",
  fontSize: 14,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

function statPill(color: string, bg: string): React.CSSProperties {
  return { fontSize: 12, color, background: bg, padding: "2px 8px", borderRadius: 12 };
}
