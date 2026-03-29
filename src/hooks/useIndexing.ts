import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type { LogEntry } from "../components/ActivityLog";

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

export function useIndexing() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const itemIndexRef = useRef<Map<number, number>>(new Map());

  const rebuildIndex = (nextItems: MediaItem[]) => {
    itemIndexRef.current = new Map(nextItems.map((item, index) => [item.id, index]));
  };

  const addLog = (msg: string) =>
    setLog((prev) => [...prev.slice(-MAX_LOG + 1), { ts: Date.now(), msg }]);

  // Hydrate from SQLite on mount
  useEffect(() => {
    invoke<MediaItem[]>("get_all_media")
      .then((loaded) => {
        rebuildIndex(loaded);
        setItems(loaded);
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    const unProgress = listen<MediaItem & { current: number; total: number }>(
      "index:progress",
        ({ payload }) => {
          setIndexError(null);
          setProgress({ current: payload.current, total: payload.total });
          setItems((prev) => {
            if (itemIndexRef.current.has(payload.id)) return prev;
            const next = [...prev, payload];
            itemIndexRef.current.set(payload.id, next.length - 1);
            return next;
          });
          if (payload.current === payload.total) {
            setProgress(null);
            addLog(`✓ Done — ${payload.total} files indexed`);
        }
      }
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
        }
      );

    const unError = listen<{ message: string }>("index:error", ({ payload }) => {
      setIndexError(payload.message);
      setProgress(null);
      addLog(`⚠ Error: ${payload.message}`);
    });

    const unStart = listen("index:start", () => {
      setIndexError(null);
      addLog("▶ Indexing started");
    });

    const unLog = listen<{ msg: string }>("index:log", ({ payload }) => {
      addLog(payload.msg);
    });

    return () => {
      unProgress.then((f) => f());
      unUpdate.then((f) => f());
      unError.then((f) => f());
      unStart.then((f) => f());
      unLog.then((f) => f());
    };
  }, []);

  return { items, progress, indexError, log, clearLog: () => setLog([]) };
}
