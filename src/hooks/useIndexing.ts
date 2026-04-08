import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { LogEntry } from "../components/ActivityLog";
import { call, connectWs, isTauri } from "../lib/transport";

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
  imdb_rating?: number;
  youtube_trailer_url?: string;
  imdb_trailer_url?: string;
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
  const [completionSummary, setCompletionSummary] = useState<{
    newItems: number;
    removed: number;
  } | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [tmdbProgress, setTmdbProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [metaRefreshProgress, setMetaRefreshProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
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

    const unProgress = listen<
      Array<MediaItem & { current: number; total: number }>
    >("index:progress", ({ payload }) => {
      // payload is now an array of up to 50 progress items (batched on Rust side).
      // Process all items in a single state update to minimise re-renders.
      if (!Array.isArray(payload) || payload.length === 0) return;

      setIndexError(null);
      setIsIndexing(true);

      // Use the last item in the batch for progress display (it has the highest current).
      const last = payload[payload.length - 1];
      setProgress({ current: last.current, total: last.total });

      setItems((prev) => {
        // Only append items that are genuinely new (not already in the index map).
        const additions: MediaItem[] = [];
        for (const item of payload) {
          if (!itemIndexRef.current.has(item.id)) {
            additions.push(item);
          }
        }
        if (additions.length === 0) return prev;
        const next = [...prev, ...additions];
        // Rebuild index for all newly added items.
        for (let i = prev.length; i < next.length; i++) {
          itemIndexRef.current.set(next[i].id, i);
        }
        return next;
      });
    });

    const unComplete = listen<{
      total: number;
      new_items: number;
      metadata_queued: number;
      removed?: number;
    }>("index:complete", ({ payload }) => {
      setProgress(null);
      setTmdbProgress(null);
      setIsIndexing(false);
      setCompletionSummary({
        newItems: payload.new_items,
        removed: payload.removed ?? 0,
      });
      addLog(
        `✓ Done — ${payload.total} files indexed, ${payload.new_items} new, ${payload.metadata_queued} sent to TMDB, ${payload.removed ?? 0} stale items removed`,
      );
      // Re-fetch the full list so items added during a background index
      // (when progress events were suppressed) are visible immediately.
      // Merge with in-memory state to preserve any TMDB patches (index:update)
      // that arrived between index:complete and when get_all_media resolves —
      // those writes may have been missed by the DB snapshot due to the race.
      call<MediaItem[]>("get_all_media")
        .then((loaded) => {
          setItems((prev) => {
            const prevById = new Map(prev.map((item) => [item.id, item]));
            const merged = loaded.map((dbItem) => {
              if (dbItem.tmdb_id != null) return dbItem;
              const memItem = prevById.get(dbItem.id);
              if (memItem?.tmdb_id != null) {
                // index:update arrived before get_all_media resolved — keep TMDB fields
                return {
                  ...dbItem,
                  tmdb_id: memItem.tmdb_id,
                  imdb_id: memItem.imdb_id,
                  tmdb_type: memItem.tmdb_type,
                  tmdb_title: memItem.tmdb_title,
                  tmdb_title_en: memItem.tmdb_title_en,
                  tmdb_release_date: memItem.tmdb_release_date,
                  tmdb_overview: memItem.tmdb_overview,
                  tmdb_overview_en: memItem.tmdb_overview_en,
                  tmdb_poster: memItem.tmdb_poster,
                  tmdb_poster_en: memItem.tmdb_poster_en,
                  tmdb_rating: memItem.tmdb_rating,
                  imdb_rating: memItem.imdb_rating,
                  youtube_trailer_url: memItem.youtube_trailer_url,
                  imdb_trailer_url: memItem.imdb_trailer_url,
                  tmdb_genres: memItem.tmdb_genres,
                  metadata_at: memItem.metadata_at,
                };
              }
              return dbItem;
            });
            rebuildIndex(merged);
            return merged;
          });
        })
        .catch(console.error);
    });

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
      setTmdbProgress(null);
      setCompletionSummary(null);
      setCrawlStats({ scannedFolders: 0, foundFiles: 0 });
      addLog("▶ Indexing started");
    });

    const unLog = ENABLE_ACTIVITY_LOG
      ? listen<{ msg: string }>("index:log", ({ payload }) => {
          // crawl stat tracking removed
          addLog(payload.msg);
        })
      : Promise.resolve(() => {});

    const unTmdbProgress = listen<{ done: number; total: number }>(
      "index:tmdb_progress",
      ({ payload }) => {
        setTmdbProgress({ done: payload.done, total: payload.total });
        if (payload.done >= payload.total) {
          // All TMDB tasks finished — clear after a brief delay so the 100% state is visible
          setTimeout(() => setTmdbProgress(null), 1500);
        }
      },
    );

    const unMetaRefresh = listen<{ done: number; total: number }>(
      "metadata:refresh_progress",
      ({ payload }) => {
        setMetaRefreshProgress({ done: payload.done, total: payload.total });
        if (payload.done >= payload.total) {
          setTimeout(() => setMetaRefreshProgress(null), 1500);
        }
      },
    );

    const unMetaComplete = listen<{ total: number }>(
      "metadata:refresh_complete",
      () => {
        call<MediaItem[]>("get_all_media")
          .then((loaded) => {
            rebuildIndex(loaded);
            setItems(loaded);
          })
          .catch(console.error);
      },
    );

    return () => {
      unProgress.then((f) => f());
      unUpdate.then((f) => f());
      unError.then((f) => f());
      unStart.then((f) => f());
      unComplete.then((f) => f());
      unLog.then((f) => f());
      unTmdbProgress.then((f) => f());
      unMetaRefresh.then((f) => f());
      unMetaComplete.then((f) => f());
    };
  }, []);

  // In web mode: connect via WebSocket for real-time events, with polling as a fallback.
  useEffect(() => {
    if (isTauri()) return;

    // ── WebSocket (real-time push) ────────────────────────────────────────
    const handleWsEvent = (event: string, payload: unknown) => {
      const p = payload as Record<string, unknown>;
      if (event === "index:start") {
        setIndexError(null);
        setIsIndexing(true);
        setProgress({ current: 0, total: 0 });
        setTmdbProgress(null);
        setCompletionSummary(null);
        addLog("▶ Indexing started");
      } else if (event === "index:complete") {
        setProgress(null);
        setTmdbProgress(null);
        setIsIndexing(false);
        setCompletionSummary({
          newItems: (p.new_items as number) ?? 0,
          removed: (p.removed as number) ?? 0,
        });
        addLog(
          `✓ Done — ${p.total} files indexed, ${p.new_items} new, ${p.removed ?? 0} stale items removed`,
        );
        call<MediaItem[]>("get_all_media")
          .then((loaded) => {
            rebuildIndex(loaded);
            setItems(loaded);
          })
          .catch(console.error);
      } else if (event === "index:error") {
        setIndexError((p.message as string) ?? "Unknown error");
        setProgress(null);
        setIsIndexing(false);
        addLog(`⚠ Error: ${p.message}`);
      } else if (event === "index:update") {
        setItems((prev) => {
          const index = itemIndexRef.current.get(p.id as number);
          if (index == null) return prev;
          const next = prev.slice();
          next[index] = { ...next[index], ...(p as Partial<MediaItem>) };
          return next;
        });
      } else if (event === "metadata:refresh_complete") {
        call<MediaItem[]>("get_all_media")
          .then((loaded) => {
            rebuildIndex(loaded);
            setItems(loaded);
          })
          .catch(console.error);
      }
    };

    const stopWs = connectWs(handleWsEvent);

    // ── Polling fallback (status check only) ─────────────────────────────
    // Polls every 5 s (less frequent than before since WS handles real-time).
    // Primarily keeps `isIndexing` in sync when the WS reconnects mid-index.
    const POLL_INTERVAL_MS = 5000;
    let wasRunning = false;

    const poll = async () => {
      try {
        const status = await call<{ running: boolean }>("get_indexing_status");
        const running = status.running;
        setIsIndexing(running);

        if (wasRunning && !running) {
          // Transition detected via poll (WS event may have been missed during reconnect).
          setProgress(null);
          setTmdbProgress(null);
          const loaded = await call<MediaItem[]>("get_all_media");
          rebuildIndex(loaded);
          setItems(loaded);
          setCompletionSummary({ newItems: 0, removed: 0 });
        } else if (!wasRunning && running) {
          setIndexError(null);
          setCompletionSummary(null);
          setProgress((prev) => prev ?? { current: 0, total: 0 });
        }

        wasRunning = running;
      } catch {
        // Server unreachable — ignore
      }
    };

    const timerId = window.setInterval(poll, POLL_INTERVAL_MS);
    poll();

    return () => {
      stopWs();
      window.clearInterval(timerId);
    };
  }, []);

  return {
    items,
    isIndexing,
    crawlStats,
    progress,
    tmdbProgress,
    metaRefreshProgress,
    completionSummary,
    dismissCompletion: () => setCompletionSummary(null),
    /** Force-clear all indexing/TMDB state. Use when tasks are stuck and never complete. */
    forceClearIndexing: () => {
      setIsIndexing(false);
      setProgress(null);
      setTmdbProgress(null);
      setCompletionSummary(null);
    },
    indexError,
    clearIndexError: () => setIndexError(null),
    retryIndexing: () => call("start_indexing").catch(console.error),
    log,
    appendLog: addLog,
    clearLog: () => setLog([]),
  };
}
