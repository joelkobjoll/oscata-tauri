import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { LogEntry } from "../components/ActivityLog";
import { call, isTauri } from "../lib/transport";

export interface MediaItem {
  id: number;
  ftp_path: string;
  filename: string;
  size_bytes?: number;
  title?: string;
  year?: number;
  season?: number;
  episode?: number;
  episode_end?: number;
  resolution?: string;
  codec?: string;
  audio_codec?: string;
  hdr?: string;
  languages?: string;
  release_type?: string;
  release_group?: string;
  tmdb_id?: number;
  imdb_id?: string;
  tmdb_type?: string;
  media_type?: string;
  tmdb_release_date?: string;
  tmdb_title?: string;
  tmdb_title_en?: string;
  tmdb_poster?: string;
  tmdb_poster_en?: string;
  tmdb_rating?: number;
  tmdb_overview?: string;
  tmdb_overview_en?: string;
  tmdb_genres?: number[] | string;
  indexed_at?: string;
  metadata_at?: string;
}

const MAX_LOG = 500;
const ENABLE_ACTIVITY_LOG = import.meta.env.DEV;

export function useIndexing() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [isIndexing, setIsIndexing] = useState(false);
  const [crawlStats, setCrawlStats] = useState<{
    scannedFolders: number;
    foundFiles: number;
  }>({ scannedFolders: 0, foundFiles: 0 });
  const [progress, setProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const itemIndexRef = useRef<Map<number, number>>(new Map());

  const rebuildIndex = (nextItems: MediaItem[]) => {
    itemIndexRef.current = new Map(
      nextItems.map((item, index) => [item.id, index]),
    );
  };

  const addLog = useCallback((msg: string) => {
    if (!ENABLE_ACTIVITY_LOG) return;
    setLog((prev) => [...prev.slice(-MAX_LOG + 1), { ts: Date.now(), msg }]);
  }, []);

  // Hydrate from SQLite on mount
  useEffect(() => {
    call<MediaItem[]>("get_all_media")
      .then((loaded) => {
        rebuildIndex(loaded);
        setItems(loaded);
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!isTauri()) return;

    const unProgress = listen<MediaItem & { current: number; total: number }>(
      "index:progress",
      ({ payload }) => {
        setIndexError(null);
        setIsIndexing(true);
        setProgress({ current: payload.current, total: payload.total });
        setItems((prev) => {
          if (itemIndexRef.current.has(payload.id)) return prev;
          const next = [...prev, payload];
          itemIndexRef.current.set(payload.id, next.length - 1);
          return next;
        });
      },
    );

    const unComplete = listen<{ total: number; metadata_queued: number }>(
      "index:complete",
      ({ payload }) => {
        setProgress(null);
        setIsIndexing(false);
        addLog(
          `✓ Done — ${payload.total} files indexed, ${payload.metadata_queued} new items metadata-matched`,
        );
        // Re-fetch the full list so items added during a background index
        // (when progress events were suppressed) are visible immediately.
        call<MediaItem[]>("get_all_media")
          .then((loaded) => {
            rebuildIndex(loaded);
            setItems(loaded);
          })
          .catch(console.error);
      },
    );

    const unUpdate = listen<Partial<MediaItem> & { id: number }>(
      "index:update",
      ({ payload }) => {
        setItems((prev) => {
          const index = itemIndexRef.current.get(payload.id);
          if (index == null) return prev;
          const next = prev.slice();
          next[index] = { ...next[index], ...payload };
          return next;
        });
      },
    );

    const unError = listen<{ message: string }>(
      "index:error",
      ({ payload }) => {
        setIndexError(payload.message);
        setProgress(null);
        setIsIndexing(false);
        setCrawlStats({ scannedFolders: 0, foundFiles: 0 });
        addLog(`⚠ Error: ${payload.message}`);
      },
    );

    const unStart = listen("index:start", () => {
      setIndexError(null);
      setIsIndexing(true);
      setProgress(null);
      setCrawlStats({ scannedFolders: 0, foundFiles: 0 });
      addLog("▶ Indexing started");
    });

    const unLog = ENABLE_ACTIVITY_LOG
      ? listen<{ msg: string }>("index:log", ({ payload }) => {
          if (payload.msg.startsWith("📂 Scanning ")) {
            setCrawlStats((prev) => ({
              ...prev,
              scannedFolders: prev.scannedFolders + 1,
            }));
          } else if (payload.msg.startsWith("🎬 Found: ")) {
            setCrawlStats((prev) => ({
              ...prev,
              foundFiles: prev.foundFiles + 1,
            }));
          }
          addLog(payload.msg);
        })
      : Promise.resolve(() => {});

    return () => {
      unProgress.then((f) => f());
      unUpdate.then((f) => f());
      unError.then((f) => f());
      unStart.then((f) => f());
      unComplete.then((f) => f());
      unLog.then((f) => f());
    };
  }, []);

  return {
    items,
    isIndexing,
    crawlStats,
    progress,
    indexError,
    clearIndexError: () => setIndexError(null),
    retryIndexing: () => call("start_indexing").catch(console.error),
    log,
    appendLog: addLog,
    clearLog: () => setLog([]),
  };
}
