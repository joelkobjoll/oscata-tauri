import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { call } from "../../lib/transport";
import type { UploadItem } from "./types";

export function useUploads() {
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const speedState = useRef<
    Record<
      number,
      { ts: number; bytes: number; uiTs?: number; smoothedBps?: number }
    >
  >({});

  const applySnapshotSpeed = (items: UploadItem[]): UploadItem[] => {
    const now = Date.now();
    return items.map((item) => {
      if (item.status !== "uploading") {
        delete speedState.current[item.id];
        return { ...item, speed_bps: undefined };
      }
      const prev = speedState.current[item.id];
      if (!prev) {
        speedState.current[item.id] = {
          ts: now,
          bytes: item.bytes_done,
          smoothedBps: item.speed_bps,
        };
        return item;
      }
      const dtMs = now - prev.ts;
      const dBytes = item.bytes_done - prev.bytes;
      let nextSpeed = prev.smoothedBps;
      if (dtMs > 0 && dBytes >= 0) {
        const instantBps = (dBytes / dtMs) * 1000;
        nextSpeed =
          prev.smoothedBps == null
            ? instantBps
            : prev.smoothedBps * 0.65 + instantBps * 0.35;
      }
      speedState.current[item.id] = {
        ts: now,
        bytes: item.bytes_done,
        smoothedBps: nextSpeed,
      };
      return { ...item, speed_bps: nextSpeed };
    });
  };

  useEffect(() => {
    call<UploadItem[]>("get_uploads")
      .then((items) => setUploads(applySnapshotSpeed(items)))
      .catch(console.error);

    const syncTimer = window.setInterval(() => {
      call<UploadItem[]>("get_uploads")
        .then((items) => {
          setUploads((current) => {
            const merged = items.map((fresh) => {
              const existing = current.find((u) => u.id === fresh.id);
              // Rust doesn't track bytes_done during transfer — preserve the
              // event-driven value so the progress bar never resets mid-upload.
              if (existing && fresh.status === "uploading") {
                return {
                  ...fresh,
                  bytes_done: existing.bytes_done,
                  bytes_total: existing.bytes_total,
                };
              }
              return fresh;
            });
            return applySnapshotSpeed(merged);
          });
        })
        .catch(() => {});
    }, 1200);

    // Tauri-only push events
    const unAdded = listen<UploadItem>("upload:added", ({ payload }) => {
      setUploads((prev) => [payload, ...prev]);
    });

    const unUpdate = listen<Partial<UploadItem> & { id: number }>(
      "upload:update",
      ({ payload }) => {
        setUploads((prev) =>
          prev.map((u) => (u.id === payload.id ? { ...u, ...payload } : u)),
        );
        if (payload.status && payload.status !== "uploading") {
          delete speedState.current[payload.id];
        }
      },
    );

    const unProgress = listen<{
      id: number;
      bytes_done: number;
      bytes_total: number;
      timestamp_ms: number;
    }>("upload:progress", ({ payload }) => {
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
      setUploads((prev) =>
        prev.map((u) =>
          u.id === payload.id
            ? {
                ...u,
                bytes_done: payload.bytes_done,
                bytes_total: payload.bytes_total,
                ...(shouldPatchSpeed && speed_bps != null ? { speed_bps } : {}),
              }
            : u,
        ),
      );
    });

    return () => {
      window.clearInterval(syncTimer);
      unAdded.then((f) => f());
      unUpdate.then((f) => f());
      unProgress.then((f) => f());
    };
  }, []);

  const cancelUpload = (id: number) => call("cancel_upload", { id });
  const retryUpload = (id: number) => call("retry_upload", { id });
  const deleteUpload = (id: number) =>
    call("delete_upload", { id }).then(() =>
      setUploads((prev) => prev.filter((u) => u.id !== id)),
    );
  const clearCompleted = () =>
    call("clear_completed_uploads").then(() =>
      setUploads((prev) =>
        prev.filter((u) => !["done", "error", "cancelled"].includes(u.status)),
      ),
    );

  return { uploads, cancelUpload, retryUpload, deleteUpload, clearCompleted };
}
