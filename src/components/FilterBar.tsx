import type { MediaItem } from "../hooks/useIndexing";
import AppIcon from "./AppIcon";
import type { AppLanguage } from "../utils/mediaLanguage";
import { t } from "../utils/i18n";
import { GENRE_LIST } from "../utils/genres";
import {
  type Filters,
  normalizeResolution,
  normalizeReleaseType,
  normalizeHdr,
} from "../utils/filterUtils";

export type { Filters };
export { normalizeResolution, normalizeReleaseType, normalizeHdr };

const SORT_OPTIONS = [
  { value: "release-desc", labelKey: "filter.sort.releaseDesc" },
  { value: "added-desc", labelKey: "filter.sort.addedDesc" },
  { value: "rating-desc", labelKey: "filter.sort.ratingDesc" },
  { value: "title-asc", labelKey: "filter.sort.titleAsc" },
  { value: "year-desc", labelKey: "filter.sort.yearDesc" },
] as const;

const RESOLUTION_OPTIONS = [
  { value: "2160P", label: "4K" },
  { value: "1080P", label: "1080p" },
  { value: "720P", label: "720p" },
  { value: "480P", label: "480p" },
] as const;

const HDR_OPTIONS = [
  { value: "DV", label: "Dolby Vision", labelKey: "filter.hdr.dolbyVision" },
  { value: "HDR10+", label: "HDR10+" },
  { value: "HDR10", label: "HDR10" },
  { value: "HDR", label: "HDR" },
] as const;

function countBy(items: MediaItem[], pick: (item: MediaItem) => string) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const value = pick(item);
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function countGenres(items: MediaItem[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const item of items) {
    const gs = item.tmdb_genres;
    const genres: number[] = gs
      ? typeof gs === "string"
        ? (JSON.parse(gs) as number[])
        : gs
      : [];
    for (const id of genres) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--color-text-muted)",
        }}
      >
        {label}
      </div>
      {children}
    </section>
  );
}

function Chip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        width: "100%",
        padding: "10px 12px",
        borderRadius: "var(--radius)",
        border: active
          ? "1px solid color-mix(in srgb, var(--color-primary) 45%, transparent)"
          : "1px solid color-mix(in srgb, var(--color-border) 82%, transparent)",
        background: active
          ? "color-mix(in srgb, var(--color-primary) 14%, transparent)"
          : "color-mix(in srgb, var(--color-surface-2) 78%, transparent)",
        color: active ? "var(--color-text)" : "var(--color-text-muted)",
        fontSize: 13,
        fontWeight: active ? 700 : 600,
        cursor: "pointer",
      }}
    >
      <span>{label}</span>
      {count != null && (
        <span
          style={{
            minWidth: 22,
            padding: "2px 7px",
            borderRadius: 999,
            background: active
              ? "color-mix(in srgb, var(--color-primary) 22%, transparent)"
              : "color-mix(in srgb, var(--color-surface) 92%, transparent)",
            color: active
              ? "var(--color-primary-hover)"
              : "var(--color-text-muted)",
            fontSize: 11,
            fontWeight: 700,
            textAlign: "center",
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}

export default function FilterBar({
  filters,
  items,
  language,
  searchInputRef,
  onChange,
}: {
  filters: Filters;
  items: MediaItem[];
  language: AppLanguage;
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
  onChange: (f: Filters) => void;
}) {
  const resolutionCounts = countBy(items, (item) =>
    normalizeResolution(item.resolution),
  );
  const releaseTypeCounts = countBy(items, (item) =>
    normalizeReleaseType(item.release_type),
  );
  const hdrCounts = countBy(items, (item) => normalizeHdr(item.hdr));
  const releaseTypeOptions = Array.from(
    new Set([
      "WEB-DL",
      "WEBRIP",
      "BDREMUX",
      "BLURAY",
      "BDRIP",
      "HDTV",
      ...releaseTypeCounts.keys(),
      ...(filters.releaseType ? [filters.releaseType] : []),
    ]),
  ).sort((a, b) => {
    const order = [
      "WEB-DL",
      "WEBRIP",
      "BDREMUX",
      "BLURAY",
      "BDRIP",
      "HDTV",
      "DVDRIP",
      "CAM",
    ];
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a.localeCompare(b);
  });
  const activeFilterCount = [
    filters.search,
    filters.releaseType,
    filters.resolution,
    filters.hdr,
    filters.genre,
  ].filter(Boolean).length;

  const releaseTypeFilterOptions = releaseTypeOptions.filter(
    (option) => releaseTypeCounts.has(option) || filters.releaseType === option,
  );
  const resolutionFilterOptions = RESOLUTION_OPTIONS.filter(
    (option) =>
      resolutionCounts.has(option.value) || filters.resolution === option.value,
  );
  const hdrFilterOptions = HDR_OPTIONS.filter(
    (option) => hdrCounts.has(option.value) || filters.hdr === option.value,
  );

  const showReleaseTypeSection =
    releaseTypeFilterOptions.length > 1 || !!filters.releaseType;
  const showResolutionSection =
    resolutionFilterOptions.length > 1 || !!filters.resolution;
  const showHdrSection = hdrFilterOptions.length > 1 || !!filters.hdr;

  const genreCounts = countGenres(items);
  const genreOptions = [...GENRE_LIST]
    .filter((g) => genreCounts.has(g.id) || filters.genre === String(g.id))
    .sort((a, b) =>
      t(language, a.i18nKey as never).localeCompare(
        t(language, b.i18nKey as never),
      ),
    );
  const showGenreSection = genreOptions.length > 1 || !!filters.genre;

  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });

  return (
    <aside
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        padding: "16px",
        borderRadius: "var(--radius-lg)",
        border:
          "1px solid color-mix(in srgb, var(--color-border) 78%, transparent)",
        background:
          "linear-gradient(160deg, color-mix(in srgb, var(--color-surface) 90%, var(--color-bg) 10%), color-mix(in srgb, var(--color-surface-2) 84%, var(--color-bg) 16%))",
        boxShadow: "0 16px 38px color-mix(in srgb, black 18%, transparent)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 17,
              fontWeight: 700,
              color: "var(--color-text)",
            }}
          >
            {t(language, "filter.filters")}
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--color-text-muted)",
              marginTop: 2,
            }}
          >
            {activeFilterCount > 0
              ? t(language, "filter.active", { count: activeFilterCount })
              : t(language, "filter.browseHint")}
          </div>
        </div>
        <button
          onClick={() =>
            set({
              search: "",
              releaseType: "",
              resolution: "",
              hdr: "",
              genre: "",
            })
          }
          disabled={activeFilterCount === 0}
          style={{
            padding: "7px 12px",
            borderRadius: "var(--radius-full)",
            border:
              "1px solid color-mix(in srgb, var(--color-border) 80%, transparent)",
            background:
              "color-mix(in srgb, var(--color-surface) 94%, transparent)",
            color:
              activeFilterCount === 0
                ? "var(--color-text-muted)"
                : "var(--color-text)",
            opacity: activeFilterCount === 0 ? 0.5 : 1,
            cursor: activeFilterCount === 0 ? "default" : "pointer",
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          {t(language, "filter.clear")}
        </button>
      </div>

      <Section label={t(language, "filter.search")}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            minHeight: 42,
            padding: "0 12px",
            borderRadius: "var(--radius)",
            border:
              "1px solid color-mix(in srgb, var(--color-border) 85%, transparent)",
            background:
              "color-mix(in srgb, var(--color-surface-2) 88%, transparent)",
          }}
        >
          <span style={{ color: "var(--color-text-muted)" }}>
            <AppIcon name="search" size={15} strokeWidth={2.2} />
          </span>
          <input
            ref={searchInputRef}
            value={filters.search}
            onChange={(e) => set({ search: e.target.value })}
            placeholder={t(language, "filter.searchPlaceholder")}
            style={{
              width: "100%",
              border: "none",
              outline: "none",
              background: "transparent",
              color: "var(--color-text)",
              fontSize: 14,
            }}
          />
        </div>
      </Section>

      <Section label={t(language, "filter.sort")}>
        <div style={{ display: "grid", gap: 8 }}>
          {SORT_OPTIONS.map((option) => (
            <Chip
              key={option.value}
              label={t(language, option.labelKey)}
              active={filters.sort === option.value}
              onClick={() => set({ sort: option.value })}
            />
          ))}
        </div>
      </Section>

      {showReleaseTypeSection && (
        <Section label={t(language, "filter.type")}>
          <div style={{ display: "grid", gap: 8 }}>
            <Chip
              label={t(language, "filter.allTypes")}
              count={items.length}
              active={!filters.releaseType}
              onClick={() => set({ releaseType: "" })}
            />
            {releaseTypeFilterOptions.map((option) => (
              <Chip
                key={option}
                label={option}
                count={releaseTypeCounts.get(option) ?? 0}
                active={filters.releaseType === option}
                onClick={() =>
                  set({
                    releaseType: filters.releaseType === option ? "" : option,
                  })
                }
              />
            ))}
          </div>
        </Section>
      )}

      {showResolutionSection && (
        <Section label={t(language, "filter.resolution")}>
          <div style={{ display: "grid", gap: 8 }}>
            <Chip
              label={t(language, "filter.allResolutions")}
              count={items.length}
              active={!filters.resolution}
              onClick={() => set({ resolution: "" })}
            />
            {resolutionFilterOptions.map((option) => (
              <Chip
                key={option.value}
                label={option.label}
                count={resolutionCounts.get(option.value) ?? 0}
                active={filters.resolution === option.value}
                onClick={() =>
                  set({
                    resolution:
                      filters.resolution === option.value ? "" : option.value,
                  })
                }
              />
            ))}
          </div>
        </Section>
      )}

      {showHdrSection && (
        <Section label={t(language, "filter.hdr")}>
          <div style={{ display: "grid", gap: 8 }}>
            <Chip
              label={t(language, "filter.allHdr")}
              count={items.length}
              active={!filters.hdr}
              onClick={() => set({ hdr: "" })}
            />
            {hdrFilterOptions.map((option) => (
              <Chip
                key={option.value}
                label={
                  "labelKey" in option
                    ? t(language, option.labelKey)
                    : option.label
                }
                count={hdrCounts.get(option.value) ?? 0}
                active={filters.hdr === option.value}
                onClick={() =>
                  set({ hdr: filters.hdr === option.value ? "" : option.value })
                }
              />
            ))}
          </div>
        </Section>
      )}

      {showGenreSection && (
        <Section label={t(language, "filter.genre")}>
          <div style={{ display: "grid", gap: 8 }}>
            <Chip
              label={t(language, "filter.allGenres")}
              count={items.length}
              active={!filters.genre}
              onClick={() => set({ genre: "" })}
            />
            {genreOptions.map((g) => (
              <Chip
                key={g.id}
                label={t(language, g.i18nKey as never)}
                count={genreCounts.get(g.id) ?? 0}
                active={filters.genre === String(g.id)}
                onClick={() =>
                  set({
                    genre: filters.genre === String(g.id) ? "" : String(g.id),
                  })
                }
              />
            ))}
          </div>
        </Section>
      )}
    </aside>
  );
}
