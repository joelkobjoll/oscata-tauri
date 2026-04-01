import AppIcon from "./AppIcon";
import type { DownloadItem } from "../hooks/useDownloads";
import type { AppLanguage } from "../utils/mediaLanguage";
import { t } from "../utils/i18n";
import { isTauri } from "../lib/transport";

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

function formatEta(
  language: AppLanguage,
  bps: number | undefined,
  done: number,
  total: number,
): string {
  if (!bps || bps <= 0 || total <= 0) return "";
  const remaining = total - done;
  const secs = remaining / bps;
  if (secs < 60)
    return t(language, "downloads.secondsLeft", { count: Math.round(secs) });
  if (secs < 3600)
    return t(language, "downloads.minutesLeft", {
      minutes: Math.floor(secs / 60),
      seconds: Math.round(secs % 60),
    });
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

const STATUS_ICONS: Record<
  DownloadItem["status"],
  "clock" | "refresh-cw" | "check" | "close"
> = {
  queued: "clock",
  downloading: "refresh-cw",
  done: "check",
  error: "close",
  cancelled: "close",
};

function StatusBadge({
  language,
  status,
}: {
  language: AppLanguage;
  status: DownloadItem["status"];
}) {
  const color = STATUS_COLORS[status];

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "0.34rem 0.65rem",
        borderRadius: "var(--radius-full)",
        border: `1px solid color-mix(in srgb, ${color} 35%, transparent)`,
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
        color,
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
      }}
    >
      <AppIcon name={STATUS_ICONS[status]} size={13} strokeWidth={2.2} />
      {t(language, `downloads.${status}` as never)}
    </span>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
  tone = "neutral",
}: {
  icon: "close" | "refresh-cw" | "folder" | "trash";
  label: string;
  onClick: () => void;
  tone?: "neutral" | "primary" | "success" | "danger";
}) {
  const color =
    tone === "primary"
      ? "var(--color-primary)"
      : tone === "success"
        ? "var(--color-success)"
        : tone === "danger"
          ? "var(--color-danger)"
          : "var(--color-text-muted)";

  return (
    <button
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        height: 36,
        padding: "0 12px",
        borderRadius: "var(--radius-full)",
        border: `1px solid color-mix(in srgb, ${color} 28%, var(--color-border) 72%)`,
        background: `color-mix(in srgb, ${color} 10%, var(--color-surface) 90%)`,
        color,
        cursor: "pointer",
        fontSize: 12,
        fontWeight: 700,
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      <AppIcon name={icon} size={14} strokeWidth={2.25} />
      {label}
    </button>
  );
}

function StatCard({
  icon,
  value,
  label,
  tone = "neutral",
}: {
  icon: "download" | "refresh-cw" | "check" | "close" | "clock";
  value: string;
  label: string;
  tone?: "neutral" | "primary" | "success" | "danger";
}) {
  const color =
    tone === "primary"
      ? "var(--color-primary)"
      : tone === "success"
        ? "var(--color-success)"
        : tone === "danger"
          ? "var(--color-danger)"
          : "var(--color-text)";

  return (
    <div
      style={{
        borderRadius: "var(--radius-lg)",
        border:
          "1px solid color-mix(in srgb, var(--color-border) 78%, transparent)",
        background:
          "linear-gradient(180deg, color-mix(in srgb, var(--color-surface) 95%, transparent), color-mix(in srgb, var(--color-surface-2) 90%, transparent))",
        padding: "0.95rem 1rem",
        boxShadow:
          "0 14px 30px color-mix(in srgb, black 14%, transparent), inset 0 1px 0 color-mix(in srgb, white 4%, transparent)",
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: `color-mix(in srgb, ${color} 14%, transparent)`,
          color,
          flexShrink: 0,
        }}
      >
        <AppIcon name={icon} size={18} strokeWidth={2.1} />
      </div>
      <div>
        <div
          style={{
            fontSize: 19,
            fontWeight: 800,
            color: "var(--color-text)",
            lineHeight: 1.1,
          }}
        >
          {value}
        </div>
        <div
          style={{
            fontSize: 12,
            color: "var(--color-text-muted)",
            marginTop: 2,
          }}
        >
          {label}
        </div>
      </div>
    </div>
  );
}

function SectionTitle({
  icon,
  title,
  subtitle,
}: {
  icon: "activity" | "clock" | "check";
  title: string;
  subtitle: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: 12,
      }}
    >
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: 12,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background:
            "color-mix(in srgb, var(--color-primary) 14%, transparent)",
          color: "var(--color-primary)",
          flexShrink: 0,
        }}
      >
        <AppIcon name={icon} size={16} strokeWidth={2.1} />
      </div>
      <div>
        <div
          style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text)" }}
        >
          {title}
        </div>
        <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
          {subtitle}
        </div>
      </div>
    </div>
  );
}

function DownloadRow({
  item,
  language,
  onCancel,
  onRetry,
  onOpenFolder,
  onDelete,
}: {
  item: DownloadItem;
  language: AppLanguage;
  onCancel: () => void;
  onRetry: () => void;
  onOpenFolder: () => void;
  onDelete: () => void;
}) {
  const pct =
    item.bytes_total > 0
      ? Math.round((item.bytes_done / item.bytes_total) * 100)
      : 0;
  const isActive = item.status === "queued" || item.status === "downloading";
  const canRetry = item.status === "error" || item.status === "cancelled";
  const isDone = item.status === "done";
  const canOpenFolder = isDone && isTauri();

  return (
    <article
      style={{
        borderRadius: "calc(var(--radius-lg) + 2px)",
        border:
          "1px solid color-mix(in srgb, var(--color-border) 78%, transparent)",
        background:
          "linear-gradient(180deg, color-mix(in srgb, var(--color-surface) 95%, transparent), color-mix(in srgb, var(--color-surface-2) 90%, transparent))",
        boxShadow:
          "0 16px 34px color-mix(in srgb, black 16%, transparent), inset 0 1px 0 color-mix(in srgb, white 4%, transparent)",
        padding: "1rem",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius: 14,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: `color-mix(in srgb, ${STATUS_COLORS[item.status]} 14%, transparent)`,
            color: STATUS_COLORS[item.status],
            flexShrink: 0,
          }}
        >
          <AppIcon
            name={STATUS_ICONS[item.status]}
            size={18}
            strokeWidth={2.15}
          />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: "var(--color-text)",
                  lineHeight: 1.35,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {item.media_title ?? item.filename}
              </div>
              {item.media_title && item.media_title !== item.filename && (
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--color-text-muted)",
                    marginTop: 3,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {item.filename}
                </div>
              )}
            </div>
            <StatusBadge language={language} status={item.status} />
          </div>

          <div
            style={{
              display: "flex",
              gap: 8,
              marginTop: 10,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            {isActive && (
              <ActionButton
                icon="close"
                label={t(language, "downloads.cancel")}
                onClick={onCancel}
                tone="danger"
              />
            )}
            {canRetry && (
              <ActionButton
                icon="refresh-cw"
                label={t(language, "downloads.retry")}
                onClick={onRetry}
                tone="primary"
              />
            )}
            {canOpenFolder && (
              <ActionButton
                icon="folder"
                label={t(language, "downloads.openFolder")}
                onClick={onOpenFolder}
                tone="success"
              />
            )}
            {(canRetry || isDone) && (
              <ActionButton
                icon="trash"
                label={t(language, "downloads.delete")}
                onClick={onDelete}
                tone="danger"
              />
            )}
          </div>
        </div>
      </div>

      {item.status === "downloading" && (
        <div
          style={{
            borderRadius: "var(--radius)",
            border:
              "1px solid color-mix(in srgb, var(--color-primary) 18%, transparent)",
            background:
              "color-mix(in srgb, var(--color-primary) 8%, transparent)",
            padding: "0.85rem 0.9rem",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontSize: 12,
                color: "var(--color-text-muted)",
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
              }}
            >
              {formatBytes(item.bytes_done)} / {formatBytes(item.bytes_total)} (
              {pct}%)
            </span>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
                justifyContent: "flex-end",
              }}
            >
              {item.speed_bps != null && item.speed_bps > 0 && (
                <span
                  style={{
                    fontSize: 12,
                    color: "var(--color-primary)",
                    fontVariantNumeric: "tabular-nums",
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                  }}
                >
                  ↓ {formatSpeed(item.speed_bps)}
                </span>
              )}
              {item.speed_bps && item.bytes_total > 0 && (
                <span
                  style={{
                    fontSize: 11,
                    color: "var(--color-text-muted)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {formatEta(
                    language,
                    item.speed_bps,
                    item.bytes_done,
                    item.bytes_total,
                  )}
                </span>
              )}
              <span
                style={{
                  fontSize: 11,
                  color: "var(--color-text-muted)",
                  whiteSpace: "nowrap",
                }}
              >
                {formatDuration(item.started_at_ms)}
              </span>
            </div>
          </div>
          <div
            style={{
              height: 8,
              borderRadius: 999,
              overflow: "hidden",
              background:
                "color-mix(in srgb, var(--color-surface) 92%, transparent)",
              border:
                "1px solid color-mix(in srgb, var(--color-border) 72%, transparent)",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${pct}%`,
                borderRadius: 999,
                transition: "width 0.35s ease",
                background:
                  "linear-gradient(90deg, var(--color-primary), color-mix(in srgb, var(--color-primary-hover) 84%, white 16%))",
              }}
            />
          </div>
        </div>
      )}

      {item.status === "queued" && (
        <div
          style={{
            borderRadius: "var(--radius)",
            border:
              "1px solid color-mix(in srgb, var(--color-border) 76%, transparent)",
            background:
              "color-mix(in srgb, var(--color-surface-2) 70%, transparent)",
            padding: "0.8rem 0.9rem",
            display: "flex",
            alignItems: "center",
            gap: 8,
            color: "var(--color-text-muted)",
            fontSize: 12,
          }}
        >
          <AppIcon name="clock" size={14} strokeWidth={2.2} />
          {t(language, "downloads.waiting")}
        </div>
      )}

      {(isDone || item.status === "error" || item.status === "cancelled") && (
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontSize: 11,
              color: "var(--color-text-muted)",
              fontFamily: "monospace",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
              flex: 1,
            }}
            title={item.local_path}
          >
            {shortPath(item.local_path)}
          </span>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexShrink: 0,
              flexWrap: "wrap",
              justifyContent: "flex-end",
            }}
          >
            {item.bytes_total > 0 && (
              <span style={metaPill}>{formatBytes(item.bytes_total)}</span>
            )}
            {item.started_at_ms && (item.completed_at_ms || isDone) && (
              <span style={metaPill}>
                {formatDuration(item.started_at_ms, item.completed_at_ms)}
              </span>
            )}
          </div>
        </div>
      )}

      {item.status === "error" && item.error && (
        <div
          style={{
            borderRadius: "var(--radius)",
            border:
              "1px solid color-mix(in srgb, var(--color-danger) 22%, transparent)",
            background:
              "color-mix(in srgb, var(--color-danger) 8%, transparent)",
            padding: "0.8rem 0.9rem",
            color: "var(--color-danger)",
            fontSize: 12,
          }}
        >
          {item.error}
        </div>
      )}
    </article>
  );
}

export default function DownloadsTab({
  language,
  downloads,
  cancelDownload,
  clearCompleted,
  retryDownload,
  openDownloadFolder,
  deleteDownload,
}: {
  language: AppLanguage;
  downloads: DownloadItem[];
  cancelDownload: (id: number) => Promise<unknown>;
  clearCompleted: () => Promise<unknown>;
  retryDownload: (id: number) => Promise<unknown>;
  openDownloadFolder: (localPath: string) => Promise<unknown>;
  deleteDownload: (id: number) => Promise<unknown>;
}) {
  const activeDownloads = [...downloads]
    .filter((item) => item.status === "queued" || item.status === "downloading")
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "downloading" ? -1 : 1;
      return (
        (b.started_at_ms ?? b.added_at_ms ?? 0) -
        (a.started_at_ms ?? a.added_at_ms ?? 0)
      );
    });

  const historyDownloads = [...downloads]
    .filter((item) => item.status !== "queued" && item.status !== "downloading")
    .sort(
      (a, b) =>
        (b.completed_at_ms ?? b.added_at_ms ?? 0) -
        (a.completed_at_ms ?? a.added_at_ms ?? 0),
    );

  const downloading = activeDownloads.filter(
    (item) => item.status === "downloading",
  ).length;
  const queued = activeDownloads.filter(
    (item) => item.status === "queued",
  ).length;
  const done = historyDownloads.filter((item) => item.status === "done").length;
  const errors = historyDownloads.filter(
    (item) => item.status === "error",
  ).length;
  const totalSpeed = activeDownloads
    .filter((item) => item.status === "downloading" && item.speed_bps != null)
    .reduce((sum, item) => sum + (item.speed_bps ?? 0), 0);

  return (
    <div
      style={{
        padding: "0.35rem 0 2rem",
        display: "flex",
        flexDirection: "column",
        gap: 18,
      }}
    >
      <section
        style={{
          borderRadius: "calc(var(--radius-lg) + 4px)",
          border:
            "1px solid color-mix(in srgb, var(--color-border) 76%, transparent)",
          background:
            "linear-gradient(160deg, color-mix(in srgb, var(--color-surface) 94%, var(--color-bg) 6%), color-mix(in srgb, var(--color-surface-2) 88%, var(--color-bg) 12%))",
          boxShadow:
            "0 18px 38px color-mix(in srgb, black 18%, transparent), inset 0 1px 0 color-mix(in srgb, white 4%, transparent)",
          padding: "1.1rem",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 16,
            alignItems: "flex-start",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: 14,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background:
                  "color-mix(in srgb, var(--color-primary) 16%, transparent)",
                color: "var(--color-primary)",
                flexShrink: 0,
              }}
            >
              <AppIcon name="download" size={18} strokeWidth={2.1} />
            </div>
            <div>
              <div
                style={{
                  fontSize: 17,
                  fontWeight: 800,
                  color: "var(--color-text)",
                  marginBottom: 4,
                }}
              >
                {t(language, "nav.downloads")}
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: "var(--color-text-muted)",
                  lineHeight: 1.55,
                }}
              >
                {t(language, "downloads.subtitle")}
              </div>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              alignItems: "center",
            }}
          >
            {totalSpeed > 0 && (
              <span style={{ ...metaPill, color: "var(--color-primary)" }}>
                ↓ {formatSpeed(totalSpeed)}
              </span>
            )}
            {historyDownloads.length > 0 && (
              <ActionButton
                icon="close"
                label={t(language, "downloads.clearCompleted")}
                onClick={() => {
                  void clearCompleted();
                }}
              />
            )}
          </div>
        </div>
      </section>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
        }}
      >
        <StatCard
          icon="refresh-cw"
          value={String(downloading)}
          label={t(language, "downloads.downloadingCount", {
            count: downloading,
          })}
          tone="primary"
        />
        <StatCard
          icon="clock"
          value={String(queued)}
          label={t(language, "downloads.queuedCount", { count: queued })}
        />
        <StatCard
          icon="check"
          value={String(done)}
          label={t(language, "downloads.doneCount", { count: done })}
          tone="success"
        />
        <StatCard
          icon="close"
          value={String(errors)}
          label={t(language, "downloads.failedCount", { count: errors })}
          tone="danger"
        />
      </div>

      {downloads.length === 0 ? (
        <section
          style={{
            borderRadius: "calc(var(--radius-lg) + 4px)",
            border:
              "1px solid color-mix(in srgb, var(--color-border) 76%, transparent)",
            background:
              "linear-gradient(180deg, color-mix(in srgb, var(--color-surface) 94%, transparent), color-mix(in srgb, var(--color-surface-2) 90%, transparent))",
            boxShadow:
              "0 16px 34px color-mix(in srgb, black 14%, transparent), inset 0 1px 0 color-mix(in srgb, white 4%, transparent)",
            padding: "2.5rem 1.5rem",
            textAlign: "center",
          }}
        >
          <div
            style={{
              width: 54,
              height: 54,
              borderRadius: 18,
              margin: "0 auto 14px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background:
                "color-mix(in srgb, var(--color-primary) 14%, transparent)",
              color: "var(--color-primary)",
            }}
          >
            <AppIcon name="download" size={22} strokeWidth={2.1} />
          </div>
          <div
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: "var(--color-text)",
              marginBottom: 6,
            }}
          >
            {t(language, "downloads.emptyTitle")}
          </div>
          <div
            style={{
              fontSize: 13,
              color: "var(--color-text-muted)",
              lineHeight: 1.6,
              maxWidth: 460,
              margin: "0 auto",
            }}
          >
            {t(language, "downloads.emptyBody")}
          </div>
        </section>
      ) : (
        <>
          <section>
            <SectionTitle
              icon="activity"
              title={t(language, "downloads.activeSection")}
              subtitle={t(language, "downloads.activeSectionBody")}
            />
            {activeDownloads.length > 0 ? (
              <div
                style={{ display: "flex", flexDirection: "column", gap: 10 }}
              >
                {activeDownloads.map((item) => (
                  <DownloadRow
                    key={item.id}
                    item={item}
                    language={language}
                    onCancel={() => {
                      void cancelDownload(item.id);
                    }}
                    onRetry={() => {
                      void retryDownload(item.id);
                    }}
                    onOpenFolder={() => {
                      void openDownloadFolder(item.local_path);
                    }}
                    onDelete={() => {
                      void deleteDownload(item.id);
                    }}
                  />
                ))}
              </div>
            ) : (
              <div style={emptySectionStyle}>
                <AppIcon name="clock" size={18} strokeWidth={2.1} />
                <span>{t(language, "downloads.noActive")}</span>
              </div>
            )}
          </section>

          <section>
            <SectionTitle
              icon="check"
              title={t(language, "downloads.historySection")}
              subtitle={t(language, "downloads.historySectionBody")}
            />
            {historyDownloads.length > 0 ? (
              <div
                style={{ display: "flex", flexDirection: "column", gap: 10 }}
              >
                {historyDownloads.map((item) => (
                  <DownloadRow
                    key={item.id}
                    item={item}
                    language={language}
                    onCancel={() => {
                      void cancelDownload(item.id);
                    }}
                    onRetry={() => {
                      void retryDownload(item.id);
                    }}
                    onOpenFolder={() => {
                      void openDownloadFolder(item.local_path);
                    }}
                    onDelete={() => {
                      void deleteDownload(item.id);
                    }}
                  />
                ))}
              </div>
            ) : (
              <div style={emptySectionStyle}>
                <AppIcon name="check" size={18} strokeWidth={2.1} />
                <span>{t(language, "downloads.noHistory")}</span>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

const metaPill: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  minHeight: 30,
  padding: "0.25rem 0.65rem",
  borderRadius: "var(--radius-full)",
  border: "1px solid color-mix(in srgb, var(--color-border) 80%, transparent)",
  background: "color-mix(in srgb, var(--color-surface) 88%, transparent)",
  color: "var(--color-text-muted)",
  fontSize: 12,
  fontWeight: 700,
};

const emptySectionStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "1rem 1.1rem",
  borderRadius: "var(--radius-lg)",
  border: "1px dashed color-mix(in srgb, var(--color-border) 74%, transparent)",
  background: "color-mix(in srgb, var(--color-surface-2) 70%, transparent)",
  color: "var(--color-text-muted)",
  fontSize: 13,
};
