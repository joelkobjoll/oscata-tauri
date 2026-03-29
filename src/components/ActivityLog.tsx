import { useEffect, useRef } from "react";
import type { AppLanguage } from "../utils/mediaLanguage";
import { t } from "../utils/i18n";

export interface LogEntry {
  ts: number;
  msg: string;
}

function entryColor(msg: string): string {
  if (msg.startsWith("📂")) return "#60a5fa"; // blue — scanning dir
  if (msg.startsWith("🎬")) return "#34d399"; // green — file found
  if (msg.startsWith("⚙")) return "#a78bfa"; // purple — indexing
  if (msg.startsWith("🌐")) return "#f9a8d4"; // pink — TMDB match
  if (msg.startsWith("⚠")) return "#fbbf24"; // yellow — warning
  if (msg.startsWith("✓") || msg.includes("complete")) return "#4ade80"; // green
  return "#d1d5db"; // default grey
}

function translateLogMessage(language: AppLanguage, msg: string): string {
  const patterns: Array<[RegExp, (match: RegExpExecArray) => string]> = [
    [
      /^Connected — starting crawl from (.+)$/u,
      (m) => t(language, "activity.connectedCrawl", { root: m[1] }),
    ],
    [
      /^Crawl complete — (\d+) media files found$/u,
      (m) => t(language, "activity.crawlComplete", { count: m[1] }),
    ],
    [
      /^📂 Scanning (.+)$/u,
      (m) => t(language, "activity.scanning", { path: m[1] }),
    ],
    [/^🎬 Found: (.+)$/u, (m) => t(language, "activity.found", { name: m[1] })],
    [
      /^🔄 Re-matching (\d+) items with TMDB…$/u,
      (m) => t(language, "activity.rematching", { count: m[1] }),
    ],
    [
      /^🌐 \[(\d+)\/(\d+)\] Matching: (.+) \((.+)\)$/u,
      (m) =>
        t(language, "activity.matching", {
          current: m[1],
          total: m[2],
          title: m[3],
          type: m[4],
        }),
    ],
    [
      /^✓ Matched: (.+) → (.+) \((.+)\)$/u,
      (m) =>
        t(language, "activity.matched", { from: m[1], to: m[2], year: m[3] }),
    ],
    [
      /^⚠ No match found for: (.+)$/u,
      (m) => t(language, "activity.noMatch", { title: m[1] }),
    ],
    [
      /^✓ Re-match complete — (\d+) items processed$/u,
      (m) => t(language, "activity.rematchComplete", { count: m[1] }),
    ],
    [
      /^✓ Done — (\d+) files indexed$/u,
      (m) => t(language, "activity.doneIndexed", { count: m[1] }),
    ],
    [
      /^⚠ Error: (.+)$/u,
      (m) => t(language, "activity.error", { message: m[1] }),
    ],
    [/^▶ Indexing started$/u, () => t(language, "activity.indexingStarted")],
  ];

  for (const [pattern, translator] of patterns) {
    const match = pattern.exec(msg);
    if (match) return translator(match);
  }
  return msg;
}

export default function ActivityLog({
  language,
  entries,
  onClear,
}: {
  language: AppLanguage;
  entries: LogEntry[];
  onClear: () => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length]);

  return (
    <div
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        height: 220,
        background: "#0f172a",
        borderTop: "1px solid #1e293b",
        display: "flex",
        flexDirection: "column",
        fontFamily: "monospace",
        zIndex: "var(--z-log)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "4px 12px",
          borderBottom: "1px solid #1e293b",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            color: "#64748b",
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          {t(language, "activity.title", { count: entries.length })}
        </span>
        <button
          onClick={onClear}
          style={{
            background: "none",
            border: "none",
            color: "#475569",
            cursor: "pointer",
            fontSize: 11,
          }}
        >
          {t(language, "activity.clear")}
        </button>
      </div>
      <div style={{ overflowY: "auto", flex: 1, padding: "6px 12px" }}>
        {entries.map((e) => (
          <div
            key={e.ts + e.msg}
            style={{ display: "flex", gap: 10, fontSize: 12, lineHeight: 1.6 }}
          >
            <span style={{ color: "#334155", flexShrink: 0 }}>
              {new Date(e.ts).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
            <span style={{ color: entryColor(e.msg) }}>
              {translateLogMessage(language, e.msg)}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
