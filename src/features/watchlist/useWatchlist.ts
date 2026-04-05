import { useCallback, useEffect, useMemo, useState } from "react";
import { call } from "../../lib/transport";
import type {
  AddWatchlistParams,
  TmdbSeason,
  WatchlistCoverageItem,
  WatchlistItem,
} from "./types";

export interface UseWatchlistReturn {
  items: WatchlistItem[];
  loading: boolean;
  watchlistedTmdbIds: Set<number>;
  add: (params: AddWatchlistParams) => Promise<void>;
  remove: (id: number) => Promise<void>;
  update: (
    id: number,
    scope: "all" | "latest",
    autoDownload: boolean,
    profileId: number,
  ) => Promise<void>;
  getCoverage: (tmdbId: number) => Promise<WatchlistCoverageItem[]>;
  getSeasons: (tmdbId: number) => Promise<TmdbSeason[]>;
  refresh: () => Promise<void>;
}

export function useWatchlist(): UseWatchlistReturn {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchItems = useCallback(async () => {
    try {
      const result = await call<WatchlistItem[]>("get_watchlist");
      setItems(result);
    } catch (e) {
      console.error("[useWatchlist] fetch failed:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const watchlistedTmdbIds = useMemo(
    () => new Set(items.map((i) => i.tmdb_id)),
    [items],
  );

  const add = useCallback(
    async (params: AddWatchlistParams) => {
      await call<number>("add_to_watchlist", {
        tmdbId: params.tmdb_id,
        tmdbType: params.tmdb_type,
        title: params.title,
        titleEn: params.title_en ?? null,
        poster: params.poster ?? null,
        overview: params.overview ?? null,
        overviewEn: params.overview_en ?? null,
        status: params.status ?? null,
        releaseDate: params.release_date ?? null,
        year: params.year ?? null,
        latestSeason: params.latest_season ?? null,
        scope: params.scope ?? "all",
        autoDownload: params.auto_download ?? false,
        profileId: params.profile_id ?? null,
      });
      await fetchItems();
    },
    [fetchItems],
  );

  const remove = useCallback(async (id: number) => {
    await call<void>("remove_from_watchlist", { id });
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const update = useCallback(
    async (
      id: number,
      scope: "all" | "latest",
      autoDownload: boolean,
      profileId: number,
    ) => {
      await call<void>("update_watchlist_item", {
        id,
        scope,
        autoDownload,
        profileId,
      });
      setItems((prev) =>
        prev.map((item) =>
          item.id === id
            ? {
                ...item,
                scope,
                auto_download: autoDownload ? 1 : 0,
                profile_id: profileId,
              }
            : item,
        ),
      );
    },
    [],
  );

  const getCoverage = useCallback(
    async (tmdbId: number): Promise<WatchlistCoverageItem[]> => {
      return call<WatchlistCoverageItem[]>("get_watchlist_coverage", {
        tmdbId,
      });
    },
    [],
  );

  const getSeasons = useCallback(
    async (tmdbId: number): Promise<TmdbSeason[]> => {
      return call<TmdbSeason[]>("get_tv_seasons", { tmdbId });
    },
    [],
  );

  return {
    items,
    loading,
    watchlistedTmdbIds,
    add,
    remove,
    update,
    getCoverage,
    getSeasons,
    refresh: fetchItems,
  };
}
