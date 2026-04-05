import { useState } from "react";
import type { MediaItem } from "../hooks/useIndexing";
import { formSelectCompact } from "../lib/formStyles";
import AppIcon from "./AppIcon";
import type { AppLanguage } from "../utils/mediaLanguage";
import { t } from "../utils/i18n";
import { GENRE_LIST } from "../utils/genres";
import {
  type Filters,
  normalizeResolution,
  normalizeReleaseType,
  normalizeHdr,
  normalizeCodec,
} from "../utils/filterUtils";

export type { Filters };
export {
  normalizeResolution,
  normalizeReleaseType,
  normalizeHdr,
  normalizeCodec,
};

const CODEC_OPTIONS = [
  { value: "HEVC", label: "HEVC / H.265" },
  { value: "AVC", label: "AVC / H.264" },
  { value: "AV1", label: "AV1" },
  { value: "VP9", label: "VP9" },
] as const;

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

// Compact section with collapsible toggle
function Section({
  label,
  children,
  hasActive,
}: {
  label: string;
  children: React.ReactNode;
  hasActive?: boolean;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 6,
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          width: "100%",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.09em",
              textTransform: "uppercase" as const,
              color: hasActive
                ? "var(--color-primary)"
                : "var(--color-text-muted)",
            }}
          >
            {label}
          </span>
          {hasActive && (
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: 999,
                background: "var(--color-primary)",
                flexShrink: 0,
              }}
            />
          )}
        </div>
        <span
          style={{
            color: "var(--color-text-muted)",
            transform: open ? "rotate(0deg)" : "rotate(-90deg)",
            transition: "transform 0.15s ease",
            lineHeight: 1,
          }}
        >
          <AppIcon name="chevron-down" size={12} />
        </span>
      </button>
      {open && children}
    </section>
  );
}

// Compact pill-style chip, wraps horizontally with siblings
function Pill({
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
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "5px 10px",
        borderRadius: "var(--radius-full)",
        border: active
          ? "1px solid color-mix(in srgb, var(--color-primary) 55%, transparent)"
          : `1px solid color-mix(in srgb, var(--color-border) ${hovered ? "100%" : "75%"}, transparent)`,
        background: active
          ? "color-mix(in srgb, var(--color-primary) 18%, transparent)"
          : hovered
            ? "color-mix(in srgb, var(--color-surface-2) 100%, transparent)"
            : "color-mix(in srgb, var(--color-surface-2) 65%, transparent)",
        color: active
          ? "var(--color-primary)"
          : hovered
            ? "var(--color-text)"
            : "var(--color-text-muted)",
        fontSize: 12,
        fontWeight: active ? 700 : 500,
        cursor: "pointer",
        transition:
          "background 0.12s ease, border-color 0.12s ease, color 0.12s ease",
        whiteSpace: "nowrap",
      }}
    >
      <span>{label}</span>
      {count != null && (
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: active ? "var(--color-primary)" : "var(--color-text-muted)",
            opacity: 0.8,
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
  const codecCounts = countBy(items, (item) => normalizeCodec(item.codec));
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
    filters.codec,
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
  const codecFilterOptions = CODEC_OPTIONS.filter(
    (option) => codecCounts.has(option.value) || filters.codec === option.value,
  );

  const showReleaseTypeSection =
    releaseTypeFilterOptions.length > 1 || !!filters.releaseType;
  const showResolutionSection =
    resolutionFilterOptions.length > 1 || !!filters.resolution;
  const showHdrSection = hdrFilterOptions.length > 1 || !!filters.hdr;
  const showCodecSection = codecFilterOptions.length > 1 || !!filters.codec;

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

  const selectStyle = formSelectCompact;

  return (
    <aside
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: "14px 12px",
        borderRadius: "var(--radius-lg)",
        border:
          "1px solid color-mix(in srgb, var(--color-border) 78%, transparent)",
        background:
          "linear-gradient(160deg, color-mix(in srgb, var(--color-surface) 90%, var(--color-bg) 10%), color-mix(in srgb, var(--color-surface-2) 84%, var(--color-bg) 16%))",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span
          style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text)" }}
        >
          {t(language, "filter.filters")}
          {activeFilterCount > 0 && (
            <span
              style={{
                marginLeft: 7,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                minWidth: 18,
                height: 18,
                padding: "0 5px",
                borderRadius: 999,
                background: "var(--color-primary)",
                color: "#fff",
                fontSize: 10,
                fontWeight: 700,
              }}
            >
              {activeFilterCount}
            </span>
          )}
        </span>
        <button
          onClick={() =>
            set({
              search: "",
              releaseType: "",
              resolution: "",
              hdr: "",
              codec: "",
              genre: "",
            })
          }
          disabled={activeFilterCount === 0}
          style={{
            padding: "4px 9px",
            borderRadius: "var(--radius-full)",
            border:
              "1px solid color-mix(in srgb, var(--color-border) 80%, transparent)",
            background: "none",
            color:
              activeFilterCount === 0
                ? "var(--color-text-muted)"
                : "var(--color-text)",
            opacity: activeFilterCount === 0 ? 0.4 : 1,
            cursor: activeFilterCount === 0 ? "default" : "pointer",
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          {t(language, "filter.clear")}
        </button>
      </div>

      {/* Search */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          minHeight: 36,
          padding: "0 10px",
          borderRadius: "var(--radius)",
          border:
            "1px solid color-mix(in srgb, var(--color-border) 85%, transparent)",
          background:
            "color-mix(in srgb, var(--color-surface-2) 88%, transparent)",
        }}
      >
        <span style={{ color: "var(--color-text-muted)", flexShrink: 0 }}>
          <AppIcon name="search" size={14} strokeWidth={2.2} />
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
            fontSize: 13,
          }}
        />
        {filters.search && (
          <button
            onClick={() => set({ search: "" })}
            style={{
              flexShrink: 0,
              background: "none",
              border: "none",
              padding: 2,
              cursor: "pointer",
              color: "var(--color-text-muted)",
              lineHeight: 1,
            }}
          >
            <AppIcon name="close" size={12} />
          </button>
        )}
      </div>

      <div
        style={{
          height: 1,
          background:
            "color-mix(in srgb, var(--color-border) 55%, transparent)",
          margin: "2px 0",
        }}
      />

      {/* Sort */}
      <Section label={t(language, "filter.sort")}>
        <select
          style={selectStyle}
          value={filters.sort}
          onChange={(e) => set({ sort: e.target.value as Filters["sort"] })}
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {t(language, option.labelKey)}
            </option>
          ))}
        </select>
      </Section>

      {/* Release type */}
      {showReleaseTypeSection && (
        <Section
          label={t(language, "filter.type")}
          hasActive={!!filters.releaseType}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {releaseTypeFilterOptions.map((option) => (
              <Pill
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

      {/* Resolution */}
      {showResolutionSection && (
        <Section
          label={t(language, "filter.resolution")}
          hasActive={!!filters.resolution}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {resolutionFilterOptions.map((option) => (
              <Pill
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

      {/* HDR */}
      {showHdrSection && (
        <Section label={t(language, "filter.hdr")} hasActive={!!filters.hdr}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {hdrFilterOptions.map((option) => (
              <Pill
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

      {/* Codec */}
      {showCodecSection && (
        <Section
          label={t(language, "filter.codec")}
          hasActive={!!filters.codec}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {codecFilterOptions.map((option) => (
              <Pill
                key={option.value}
                label={option.label}
                count={codecCounts.get(option.value) ?? 0}
                active={filters.codec === option.value}
                onClick={() =>
                  set({
                    codec: filters.codec === option.value ? "" : option.value,
                  })
                }
              />
            ))}
          </div>
        </Section>
      )}

      {/* Genre */}
      {showGenreSection && (
        <Section
          label={t(language, "filter.genre")}
          hasActive={!!filters.genre}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {genreOptions.map((g) => (
              <Pill
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
