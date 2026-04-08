import { memo, useEffect, useRef } from "react";
import type { MediaItem } from "../hooks/useIndexing";
import type { DownloadItem } from "../hooks/useDownloads";
import MediaCard from "./MediaCard";
import type { AppLanguage } from "../utils/mediaLanguage";

export default memo(function VirtualMediaGrid({
  items,
  selecting,
  checkedIds,
  onToggleCheck,
  onCardSelect,
  onDownload,
  resetKey,
  language,
  badgeMap,
  downloadMap,
  hideEpisodeBadge = false,
  showFileSize = false,
  preferredRating = "tmdb",
}: {
  items: MediaItem[];
  selecting: boolean;
  checkedIds: Set<number>;
  onToggleCheck: (id: number) => void;
  onCardSelect: (item: MediaItem) => void;
  onDownload: (item: MediaItem) => void;
  resetKey: string;
  language: AppLanguage;
  badgeMap: Record<
    number,
    {
      downloaded?: boolean;
      inEmby?: boolean;
      plexInLibrary?: boolean;
      embyInLibrary?: boolean;
      cache?: string;
      debug?: string;
    }
  >;
  downloadMap: Map<string, DownloadItem>;
  hideEpisodeBadge?: boolean;
  showFileSize?: boolean;
  preferredRating?: string;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [resetKey]);

  return (
    <div
      ref={scrollRef}
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "1.5rem 1.5rem 6.5rem 1.5rem",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          gap: 16,
        }}
      >
        {items.map((item) => (
          <div key={item.id} style={{ position: "relative" }}>
            {selecting && (
              <input
                type="checkbox"
                checked={checkedIds.has(item.id)}
                onChange={() => onToggleCheck(item.id)}
                style={{
                  position: "absolute",
                  top: 8,
                  left: 8,
                  zIndex: 10,
                  width: 18,
                  height: 18,
                  cursor: "pointer",
                }}
              />
            )}
            <MediaCard
              item={item}
              language={language}
              badges={badgeMap[item.id]}
              downloadItem={downloadMap.get(item.ftp_path)}
              hideEpisodeBadge={hideEpisodeBadge}
              showFileSize={showFileSize}
              preferredRating={preferredRating}
              onDownload={onDownload}
              onSelect={(selected) => {
                if (selecting) onToggleCheck(selected.id);
                else onCardSelect(selected);
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
});
