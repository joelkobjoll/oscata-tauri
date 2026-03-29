import type { DownloadItem } from "../hooks/useDownloads";

interface DownloadRingProps {
  downloadItem: DownloadItem | undefined;
}

export default function DownloadRing({ downloadItem }: DownloadRingProps) {
  if (!downloadItem) return null;
  const { status, bytes_done, bytes_total, speed_bps } = downloadItem;
  if (status !== "queued" && status !== "downloading") return null;

  const r = 28; // Fixed radius
  const circumference = 2 * Math.PI * r;
  const pct =
    status === "downloading" && bytes_total > 0
      ? Math.min(100, (bytes_done / bytes_total) * 100)
      : 0;
  const offset = circumference * (1 - pct / 100);

  const formatSpeed = (bps: number): string => {
    if (bps >= 1_000_000) return (bps / 1_000_000).toFixed(1) + " MB/s";
    if (bps >= 1_000) return (bps / 1_000).toFixed(1) + " KB/s";
    return bps.toFixed(0) + " B/s";
  };

  const formatEta = (
    remainingBytes: number,
    bytesPerSec: number,
  ): string | null => {
    if (bytesPerSec <= 0) return null;
    const totalSeconds = Math.floor(remainingBytes / bytesPerSec);
    const hours = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${mins}m`;
    if (mins > 0) return `${mins}m`;
    return "< 1m";
  };

  const displaySpeed =
    status === "downloading" && speed_bps ? formatSpeed(speed_bps) : null;
  const displayEta =
    status === "downloading" && speed_bps
      ? formatEta(bytes_total - bytes_done, speed_bps)
      : null;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.6rem",
        background: `radial-gradient(
          ellipse 70% 70% at 50% 50%,
          color-mix(in srgb, black 72%, transparent) 0%,
          color-mix(in srgb, black 52%, transparent) 55%,
          color-mix(in srgb, black 30%, transparent) 100%
        )`,
        backdropFilter: "blur(1px)",
        WebkitBackdropFilter: "blur(1px)",
        zIndex: 3,
        pointerEvents: "none",
        borderRadius: "var(--radius-lg)",
        animation: "dl-fade-in 0.2s ease both",
      }}
    >
      {/* Ring container */}
      <div
        style={{
          position: "relative",
          width: 80,
          height: 80,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* SVG ring */}
        <svg
          viewBox="0 0 70 70"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            transform: "rotate(-90deg)",
            filter:
              "drop-shadow(0 0 5px color-mix(in srgb, var(--color-primary) 60%, transparent))",
          }}
        >
          {/* Track */}
          <circle
            cx={35}
            cy={35}
            r={r}
            fill="none"
            stroke="color-mix(in srgb, white 15%, transparent)"
            strokeWidth={4}
          />
          {/* Progress */}
          <circle
            cx={35}
            cy={35}
            r={r}
            fill="none"
            stroke="var(--color-primary)"
            strokeWidth={4.5}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 0.8s ease" }}
            className={status === "queued" ? "ring-pulse" : undefined}
          />
        </svg>

        {/* Percentage text overlay */}
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "baseline",
            gap: 0,
          }}
        >
          <span
            style={{
              fontSize: "1.45rem",
              fontWeight: 800,
              color: "#fff",
              lineHeight: 1,
              letterSpacing: "-0.03em",
              textShadow:
                "0 1px 6px color-mix(in srgb, black 90%, transparent)",
            }}
          >
            {pct.toFixed(0)}
          </span>
          <span
            style={{
              fontSize: "0.9rem",
              fontWeight: 700,
              letterSpacing: 0,
              opacity: 0.8,
              color: "#fff",
              textShadow:
                "0 1px 6px color-mix(in srgb, black 90%, transparent)",
            }}
          >
            %
          </span>
        </div>
      </div>

      {/* Metadata pills (speed & ETA) */}
      {(displaySpeed || displayEta) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.3rem",
          }}
        >
          {displaySpeed && (
            <span
              style={{
                fontSize: "0.65rem",
                fontWeight: 600,
                color: "color-mix(in srgb, white 90%, transparent)",
                background: "color-mix(in srgb, black 45%, transparent)",
                border: "1px solid color-mix(in srgb, white 12%, transparent)",
                borderRadius: "999px",
                padding: "0.15rem 0.5rem",
                letterSpacing: "0.02em",
                backdropFilter: "blur(4px)",
                WebkitBackdropFilter: "blur(4px)",
              }}
            >
              {displaySpeed}
            </span>
          )}
          {displayEta && (
            <span
              style={{
                fontSize: "0.65rem",
                fontWeight: 600,
                color: "color-mix(in srgb, white 65%, transparent)",
                background: "color-mix(in srgb, black 45%, transparent)",
                border: "1px solid color-mix(in srgb, white 12%, transparent)",
                borderRadius: "999px",
                padding: "0.15rem 0.5rem",
                letterSpacing: "0.02em",
                backdropFilter: "blur(4px)",
                WebkitBackdropFilter: "blur(4px)",
              }}
            >
              {displayEta}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
