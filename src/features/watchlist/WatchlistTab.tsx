import { useMemo, useState } from "react";
import type { UseWatchlistReturn } from "./useWatchlist";
import type { WatchlistItem } from "./types";
import type { AppLanguage } from "../../utils/mediaLanguage";
import WatchlistCard from "./WatchlistCard";
import WatchlistAddModal from "./WatchlistAddModal";
import WatchlistDetailPanel from "./WatchlistDetailPanel";

interface WatchlistTabProps {
  watchlist: UseWatchlistReturn;
  language: AppLanguage;
  onNavigateToItem?: (tmdbId: number, mediaType: string) => void;
}

type TypeFilter = "all" | "movie" | "tv";
type StatusFilter = "all" | "pending" | "available";

export default function WatchlistTab({
  watchlist,
  language,
  onNavigateToItem,
}: WatchlistTabProps) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState<WatchlistItem | null>(null);

  const filtered = useMemo(() => {
    return watchlist.items.filter((item) => {
      const title =
        language === "es" ? item.title : (item.title_en ?? item.title);
      if (search && !title.toLowerCase().includes(search.toLowerCase()))
        return false;
      if (typeFilter !== "all" && item.tmdb_type !== typeFilter) return false;
      if (statusFilter !== "all" && item.library_status !== statusFilter)
        return false;
      return true;
    });
  }, [watchlist.items, search, typeFilter, statusFilter, language]);

  const handleRemove = (id: number) => {
    void watchlist.remove(id);
    if (selected?.id === id) setSelected(null);
  };

  const handleUpdate = async (
    id: number,
    scope: "all" | "latest",
    autoDownload: boolean,
    profileId: number,
  ) => {
    await watchlist.update(id, scope, autoDownload, profileId);
    // Refresh the selected item from updated list
    setSelected((prev) =>
      prev?.id === id
        ? {
            ...prev,
            scope,
            auto_download: autoDownload ? 1 : 0,
            profile_id: profileId,
          }
        : prev,
    );
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 0,
        height: "100%",
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
          padding: "12px 16px",
          borderBottom: "1px solid var(--color-border)",
          background: "var(--color-surface)",
        }}
      >
        {/* Search */}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={language === "es" ? "Filtrar…" : "Filter…"}
          style={{
            flex: 1,
            minWidth: 160,
            background: "var(--color-surface-2)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius)",
            color: "var(--color-text)",
            padding: "6px 12px",
            fontSize: 13,
            outline: "none",
          }}
        />

        {/* Type filter */}
        <div style={{ display: "flex", gap: 4 }}>
          {(["all", "movie", "tv"] as TypeFilter[]).map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              style={chipStyle(typeFilter === t)}
            >
              {t === "all"
                ? language === "es"
                  ? "Todos"
                  : "All"
                : t === "movie"
                  ? language === "es"
                    ? "Películas"
                    : "Movies"
                  : "TV"}
            </button>
          ))}
        </div>

        {/* Status filter */}
        <div style={{ display: "flex", gap: 4 }}>
          {(["all", "pending", "available"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              style={chipStyle(statusFilter === s)}
            >
              {s === "all"
                ? language === "es"
                  ? "Todo"
                  : "All"
                : s === "pending"
                  ? language === "es"
                    ? "Pendiente"
                    : "Pending"
                  : language === "es"
                    ? "Disponible"
                    : "Available"}
            </button>
          ))}
        </div>

        <button
          onClick={() => setShowAdd(true)}
          style={{
            background: "var(--color-primary)",
            border: "none",
            color: "#fff",
            borderRadius: "var(--radius)",
            padding: "6px 14px",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 500,
            whiteSpace: "nowrap",
          }}
        >
          + {language === "es" ? "Agregar" : "Add"}
        </button>
      </div>

      {/* Grid */}
      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        {watchlist.loading ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: 200,
              color: "var(--color-text-muted)",
            }}
          >
            {language === "es" ? "Cargando…" : "Loading…"}
          </div>
        ) : filtered.length === 0 ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: 200,
              gap: 12,
              color: "var(--color-text-muted)",
            }}
          >
            <span style={{ fontSize: 36 }}>🔖</span>
            <span>
              {watchlist.items.length === 0
                ? language === "es"
                  ? "Tu lista de seguimiento está vacía"
                  : "Your watchlist is empty"
                : language === "es"
                  ? "No hay resultados"
                  : "No results"}
            </span>
            {watchlist.items.length === 0 && (
              <button
                onClick={() => setShowAdd(true)}
                style={{
                  background: "var(--color-primary)",
                  border: "none",
                  color: "#fff",
                  borderRadius: "var(--radius)",
                  padding: "7px 16px",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 500,
                }}
              >
                + {language === "es" ? "Agregar título" : "Add a title"}
              </button>
            )}
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
              gap: 16,
            }}
          >
            {filtered.map((item) => (
              <WatchlistCard
                key={item.id}
                item={item}
                language={language}
                onOpen={setSelected}
                onRemove={handleRemove}
              />
            ))}
          </div>
        )}
      </div>

      {/* Add modal */}
      {showAdd && (
        <WatchlistAddModal
          language={language}
          watchlistedTmdbIds={watchlist.watchlistedTmdbIds}
          onAdd={watchlist.add}
          onClose={() => setShowAdd(false)}
        />
      )}

      {/* Detail panel */}
      {selected && (
        <WatchlistDetailPanel
          item={selected}
          language={language}
          onClose={() => setSelected(null)}
          onRemove={handleRemove}
          onUpdate={handleUpdate}
          getCoverage={watchlist.getCoverage}
          getSeasons={watchlist.getSeasons}
          onNavigateToItem={(tmdbId, mediaType) => {
            setSelected(null);
            onNavigateToItem?.(tmdbId, mediaType);
          }}
        />
      )}
    </div>
  );
}

function chipStyle(active: boolean): React.CSSProperties {
  return {
    border: "none",
    borderRadius: "var(--radius-full)",
    padding: "4px 12px",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 500,
    background: active ? "var(--color-primary)" : "var(--color-surface-2)",
    color: active ? "#fff" : "var(--color-text-muted)",
    transition: "background 0.15s ease",
  };
}
