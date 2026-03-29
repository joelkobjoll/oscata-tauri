import { invoke } from "@tauri-apps/api/core";
import type { MediaItem } from "./useIndexing";

type DownloadFeedbackDetail = {
  kind: "success" | "error";
  title: string;
};

export function useDownload() {
  const startDownload = async (item: MediaItem): Promise<number> => {
    const title = item.tmdb_title ?? item.tmdb_title_en ?? item.title ?? item.filename;

    try {
      const id = await invoke<number>("queue_download", {
        ftpPath: item.ftp_path,
        filename: item.filename,
        mediaTitle: item.tmdb_title ?? item.title ?? undefined,
      });
      window.dispatchEvent(new CustomEvent<DownloadFeedbackDetail>("download:feedback", {
        detail: { kind: "success", title },
      }));
      return id;
    } catch (error) {
      window.dispatchEvent(new CustomEvent<DownloadFeedbackDetail>("download:feedback", {
        detail: { kind: "error", title },
      }));
      throw error;
    }
  };

  return { startDownload };
}
