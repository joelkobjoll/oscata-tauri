import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

export interface DownloadItem {
  id: number;
  ftp_path: string;
  filename: string;
  local_path: string;
  media_title?: string;
  status: "queued" | "downloading" | "done" | "error" | "cancelled";
  bytes_total: number;
  bytes_done: number;
  error?: string;
  added_at_ms?: number;
  started_at_ms?: number;
  completed_at_ms?: number;
  speed_bps?: number; // computed in hook
}

export function useDownloads() {
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  // Track last progress sample per download for speed calculation
  const speedState = useRef<
    Record<
      number,
      { ts: number; bytes: number; uiTs?: number; smoothedBps?: number }
    >
  >({});

  useEffect(() => {
    invoke<DownloadItem[]>("get_downloads")
      .then(setDownloads)
      .catch(console.error);

    const unAdded = listen<DownloadItem>("download:added", ({ payload }) => {
      setDownloads((prev) => [payload, ...prev]);
    });

    const unUpdate = listen<Partial<DownloadItem> & { id: number }>(
      "download:update",
      ({ payload }) => {
        setDownloads((prev) =>
          prev.map((d) => (d.id === payload.id ? { ...d, ...payload } : d)),
        );
        // Clear speed when no longer downloading
        if (payload.status && payload.status !== "downloading") {
          delete speedState.current[payload.id];
        }
      },
    );

    const unProgress = listen<{
      id: number;
      bytes_done: number;
      bytes_total: number;
      timestamp_ms: number;
    }>("download:progress", ({ payload }) => {
      const prev = speedState.current[payload.id];
      let speed_bps: number | undefined;
      let shouldPatchSpeed = false;
      if (prev) {
        const dtMs = payload.timestamp_ms - prev.ts;
        const dBytes = payload.bytes_done - prev.bytes;
        if (dtMs > 0) {
          const instantBps = (dBytes / dtMs) * 1000;
          const smoothedBps =
            prev.smoothedBps == null
              ? instantBps
              : prev.smoothedBps * 0.65 + instantBps * 0.35;
          speed_bps = smoothedBps;
          shouldPatchSpeed =
            prev.uiTs == null || payload.timestamp_ms - prev.uiTs >= 900;
        }
      }
      speedState.current[payload.id] = {
        ts: payload.timestamp_ms,
        bytes: payload.bytes_done,
        uiTs: shouldPatchSpeed ? payload.timestamp_ms : prev?.uiTs,
        smoothedBps: speed_bps ?? prev?.smoothedBps,
      };

      setDownloads((prev) =>
        prev.map((d) =>
          d.id === payload.id
            ? {
                ...d,
                bytes_done: payload.bytes_done,
                bytes_total: payload.bytes_total,
                ...(shouldPatchSpeed && speed_bps != null ? { speed_bps } : {}),
              }
            : d,
        ),
      );
    });

    return () => {
      unAdded.then((f) => f());
      unUpdate.then((f) => f());
      unProgress.then((f) => f());
    };
  }, []);

  const cancelDownload = (id: number) => invoke("cancel_download", { id });
  const retryDownload = (id: number) => invoke("retry_download", { id });
  const openDownloadFolder = (localPath: string) =>
    invoke("open_download_folder", { localPath });
  const deleteDownload = (id: number) =>
    invoke("delete_download", { id }).then(() =>
      setDownloads((prev) => prev.filter((d) => d.id !== id)),
    );
  const clearCompleted = () =>
    invoke("clear_completed").then(() =>
      setDownloads((prev) =>
        prev.filter((d) => !["done", "error", "cancelled"].includes(d.status)),
      ),
    );

  return {
    downloads,
    cancelDownload,
    clearCompleted,
    retryDownload,
    openDownloadFolder,
    deleteDownload,
  };
}
