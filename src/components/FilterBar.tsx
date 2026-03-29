import type { MediaItem } from "../hooks/useIndexing";
import AppIcon from "./AppIcon";
import type { AppLanguage } from "../utils/mediaLanguage";
import { t } from "../utils/i18n";

export interface Filters {
  search: string;
  releaseType: string;
  resolution: string;
  codec: string;
  hdr: string;
  sort: string;
}

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

export function normalizeResolution(raw?: string): string {
  const value = raw?.trim().toUpperCase() ?? "";
  if (!value) return "";
  if (value.includes("2160") || value.includes("4K")) return "2160P";
  if (value.includes("1080")) return "1080P";
  if (value.includes("720")) return "720P";
  if (value.includes("480")) return "480P";
  return value;
}

export function normalizeCodec(raw?: string): string {
  const value = raw?.trim().toUpperCase() ?? "";
  if (!value) return "";
  if (value.includes("AV1")) return "AV1";
  if (value.includes("VP9")) return "VP9";
  if (value.includes("VC1") || value.includes("VC-1")) return "VC1";
  if (value.includes("MPEG2") || value.includes("MPEG-2")) return "MPEG2";
  if (value.includes("MPEG4") || value.includes("MPEG-4")) return "MPEG4";
  if (value.includes("XVID")) return "XVID";
  if (value.includes("DIVX")) return "DIVX";
  if (value.includes("265") || value.includes("HEVC")) return "X265";
  if (value.includes("264") || value.includes("AVC")) return "X264";
  return value;
}

function codecLabel(codec: string): string {
  switch (codec) {
    case "X265":
      return "x265 / HEVC";
    case "X264":
      return "x264 / AVC";
    case "VC1":
      return "VC-1";
    case "MPEG2":
      return "MPEG-2";
    case "MPEG4":
      return "MPEG-4";
    default:
      return codec;
  }
}

export function normalizeReleaseType(raw?: string): string {
  const value = raw?.trim().toUpperCase() ?? "";
  if (!value) return "";
  if (value.includes("BDREMUX")) return "BDREMUX";
  if (value.includes("BDRIP")) return "BDRIP";
  if (value.includes("BLURAY") || value.includes("BLU-RAY")) return "BLURAY";
  if (value.includes("WEB-DL") || value == "WEBDL" || value.includes("WEB DL"))
    return "WEB-DL";
  if (
    value.includes("WEBRIP") ||
    value.includes("WEB-RIP") ||
    value.includes("WEB RIP")
  )
    return "WEBRIP";
  if (value.includes("HDTV")) return "HDTV";
  if (value.includes("DVDRIP")) return "DVDRIP";
  if (value.includes("CAM")) return "CAM";
  return value;
}

export function normalizeHdr(raw?: string): string {
  const value = raw?.trim().toUpperCase() ?? "";
  if (!value) return "";
  if (value.includes("HDR10+") || value.includes("HDR10PLUS")) return "HDR10+";
  if (
    value.includes("DOVI") ||
    value.includes("DOLBY VISION") ||
    /\bDV\b/.test(value)
  )
    return "DV";
  if (value.includes("HDR10")) return "HDR10";
  if (value.includes("HDR")) return "HDR";
  return value;
}

function countBy(items: MediaItem[], pick: (item: MediaItem) => string) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const value = pick(item);
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
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
  const codecCounts = countBy(items, (item) => normalizeCodec(item.codec));
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
  const codecOptions = Array.from(
    new Set([
      "X265",
      "X264",
      "AV1",
      "VP9",
      ...codecCounts.keys(),
      ...(filters.codec ? [filters.codec] : []),
    ]),
  ).sort((a, b) => {
    const order = [
      "X265",
      "X264",
      "AV1",
      "VP9",
      "VC1",
      "MPEG2",
      "MPEG4",
      "XVID",
      "DIVX",
    ];
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a.localeCompare(b);
  });
  const activeFilterCount = [
    filters.search,
    filters.releaseType,
    filters.resolution,
    filters.codec,
    filters.hdr,
  ].filter(Boolean).length;
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });

  return (
    <aside
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        padding: "16px",
        borderRadius: "calc(var(--radius-lg) + 4px)",
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
              codec: "",
              hdr: "",
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

      <Section label={t(language, "filter.type")}>
        <div style={{ display: "grid", gap: 8 }}>
          <Chip
            label={t(language, "filter.allTypes")}
            count={items.length}
            active={!filters.releaseType}
            onClick={() => set({ releaseType: "" })}
          />
          {releaseTypeOptions
            .filter(
              (option) =>
                releaseTypeCounts.has(option) || filters.releaseType === option,
            )
            .map((option) => (
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

      <Section label={t(language, "filter.resolution")}>
        <div style={{ display: "grid", gap: 8 }}>
          <Chip
            label={t(language, "filter.allResolutions")}
            count={items.length}
            active={!filters.resolution}
            onClick={() => set({ resolution: "" })}
          />
          {RESOLUTION_OPTIONS.filter(
            (option) =>
              resolutionCounts.has(option.value) ||
              filters.resolution === option.value,
          ).map((option) => (
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

      <Section label={t(language, "filter.codec")}>
        <div style={{ display: "grid", gap: 8 }}>
          <Chip
            label={t(language, "filter.allCodecs")}
            count={items.length}
            active={!filters.codec}
            onClick={() => set({ codec: "" })}
          />
          {codecOptions
            .filter(
              (option) => codecCounts.has(option) || filters.codec === option,
            )
            .map((option) => (
              <Chip
                key={option}
                label={codecLabel(option)}
                count={codecCounts.get(option) ?? 0}
                active={filters.codec === option}
                onClick={() =>
                  set({ codec: filters.codec === option ? "" : option })
                }
              />
            ))}
        </div>
      </Section>

      <Section label={t(language, "filter.hdr")}>
        <div style={{ display: "grid", gap: 8 }}>
          <Chip
            label={t(language, "filter.allHdr")}
            count={items.length}
            active={!filters.hdr}
            onClick={() => set({ hdr: "" })}
          />
          {HDR_OPTIONS.filter(
            (option) =>
              hdrCounts.has(option.value) || filters.hdr === option.value,
          ).map((option) => (
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
    </aside>
  );
}
