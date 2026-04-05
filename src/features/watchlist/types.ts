export interface QualityProfile {
  id: number;
  name: string;
  min_resolution?: string;
  preferred_resolution?: string;
  prefer_hdr: boolean;
  preferred_codecs: string; // JSON array
  preferred_audio_codecs: string; // JSON array
  preferred_release_types: string; // JSON array
  min_size_gb?: number;
  max_size_gb?: number;
  is_builtin: boolean;
  created_at: string;
}

export interface WatchlistItem {
  id: number;
  user_id: number;
  tmdb_id: number;
  tmdb_type: "movie" | "tv";
  title: string;
  title_en?: string;
  poster?: string;
  overview?: string;
  overview_en?: string;
  status?: string;
  release_date?: string;
  year?: number;
  latest_season?: number;
  next_episode_date?: string;
  scope: "all" | "latest";
  auto_download: number;
  profile_id: number;
  added_at: string;
  library_count: number;
  library_status: "pending" | "available";
}

export interface WatchlistCoverageItem {
  season?: number;
  episode?: number;
  filename: string;
  resolution?: string;
  ftp_path: string;
}

export interface AddWatchlistParams {
  tmdb_id: number;
  tmdb_type: "movie" | "tv";
  title: string;
  title_en?: string;
  poster?: string;
  overview?: string;
  overview_en?: string;
  status?: string;
  release_date?: string;
  year?: number;
  latest_season?: number;
  scope?: "all" | "latest";
  auto_download?: boolean;
  profile_id?: number;
}
