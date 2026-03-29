import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { MediaItem } from "./useIndexing";

type DownloadFeedbackDetail = {
  kind: "success" | "error";
  title: string;
};

export function useDownload() {
  const pendingPathsRef = useRef<Set<string>>(new Set());
  const pendingClearTimersRef = useRef<Record<string, number>>({});
  const [pendingPaths, setPendingPaths] = useState<Set<string>>(new Set());

  const syncPendingPaths = (next: Set<string>) => {
    pendingPathsRef.current = next;
    setPendingPaths(next);
  };

  const markPending = (ftpPath: string): boolean => {
    if (pendingPathsRef.current.has(ftpPath)) {
      return false;
    }

    const next = new Set(pendingPathsRef.current);
    next.add(ftpPath);
    syncPendingPaths(next);
    return true;
  };

  const clearPending = (ftpPath: string) => {
    const timerId = pendingClearTimersRef.current[ftpPath];
    if (timerId != null) {
      window.clearTimeout(timerId);
      delete pendingClearTimersRef.current[ftpPath];
    }

    if (!pendingPathsRef.current.has(ftpPath)) {
      return;
    }

    const next = new Set(pendingPathsRef.current);
    next.delete(ftpPath);
    syncPendingPaths(next);
  };

  const schedulePendingClear = (ftpPath: string) => {
    const existingTimerId = pendingClearTimersRef.current[ftpPath];
    if (existingTimerId != null) {
      window.clearTimeout(existingTimerId);
    }

    pendingClearTimersRef.current[ftpPath] = window.setTimeout(() => {
      delete pendingClearTimersRef.current[ftpPath];
      clearPending(ftpPath);
    }, 750);
  };

  useEffect(() => {
    return () => {
      Object.values(pendingClearTimersRef.current).forEach((timerId) => {
        window.clearTimeout(timerId);
      });
    };
  }, []);

  const startDownload = async (item: MediaItem): Promise<number> => {
    if (!markPending(item.ftp_path)) {
      return -1;
    }

    const title = item.tmdb_title ?? item.tmdb_title_en ?? item.title ?? item.filename;

    try {
      const id = await invoke<number>("queue_download", {
        ftpPath: item.ftp_path,
        filename: item.filename,
        mediaTitle: item.tmdb_title ?? item.title ?? undefined,
      });
      schedulePendingClear(item.ftp_path);
      window.dispatchEvent(new CustomEvent<DownloadFeedbackDetail>("download:feedback", {
        detail: { kind: "success", title },
      }));
      return id;
    } catch (error) {
      clearPending(item.ftp_path);
      window.dispatchEvent(new CustomEvent<DownloadFeedbackDetail>("download:feedback", {
        detail: { kind: "error", title },
      }));
      throw error;
    }
  };

  return {
    startDownload,
    isDownloadPending: (ftpPath: string) => pendingPaths.has(ftpPath),
  };
}
