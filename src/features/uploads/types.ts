export interface AudioTrack {
  codec: string;
  language: string | null;
  channels: number | null;
  is_default: boolean;
}

export interface LocalMediaInfo {
  resolution: string | null;
  width: number | null;
  height: number | null;
  codec: string | null;
  audio_tracks: AudioTrack[];
  languages: string[];
  hdr: string | null;
  duration_secs: number | null;
  size_bytes: number;
  format: string | null;
}

export type MediaType = "movie" | "tv" | "documentary";

export interface UploadSuggestion {
  dest: string;
  media_type: MediaType;
  detected_title: string | null;
  detected_season: number | null;
  detected_episode: number | null;
  detected_year: number | null;
  /** Release type detected from the filename, e.g. "BDREMUX", "WEB-DL", "BDRip" */
  detected_release_type: string | null;
  detected_resolution: string | null;
  detected_codec: string | null;
  detected_audio_codec: string | null;
  detected_languages: string[];
  detected_hdr: string | null;
  /** Sanitised FTP base folder for movies from config */
  movie_dest: string;
  /** Sanitised FTP base folder for TV shows from config */
  tv_dest: string;
  /** tv_dest + resolved category subfolder (e.g. Temporadas en emision). Use this as the base for season folder uploads. */
  tv_category_dest: string;
}

/** Mirrors TmdbMovie from Rust — returned by search_tmdb */
export interface TmdbMatch {
  id: number;
  imdb_id: string | null;
  title: string;
  title_en: string | null;
  release_date: string | null;
  overview: string | null;
  overview_en: string | null;
  poster_path: string | null;
  poster_path_en: string | null;
  vote_average: number | null;
  genre_ids: number[];
}

export interface UploadItem {
  id: number;
  local_path: string;
  ftp_dest_path: string;
  filename: string;
  media_title?: string;
  tmdb_id?: number;
  status: "queued" | "uploading" | "done" | "error" | "cancelled";
  bytes_total: number;
  bytes_done: number;
  error?: string;
  added_at_ms?: number;
  started_at_ms?: number;
  completed_at_ms?: number;
  resolution?: string | null;
  hdr?: string | null;
  languages?: string[];
  codec?: string | null;
  speed_bps?: number; // computed in hook
}

export interface AnalysisResult {
  path: string;
  filename: string;
  info: LocalMediaInfo | null;
  error: string | null;
}
