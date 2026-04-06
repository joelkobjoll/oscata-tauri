import { useState, useEffect } from "react";
import { Copy, FolderOpen, FileVideo } from "lucide-react";
import type { LocalMediaInfo, MediaType } from "./types";
import { formInputCompact, formSelectCompact } from "../../lib/formStyles";
import Toggle from "../../components/Toggle";

interface FilenameBuilderProps {
  info: LocalMediaInfo | null;
  mediaType: MediaType;
  defaultTitle?: string; // Movie: title. TV: episode title (optional)
  defaultShowName?: string; // TV only: show name
  defaultYear?: number; // Movie only
  defaultSeason?: number; // TV only
  defaultEpisode?: number; // TV only
  defaultReleaseType?: string; // Detected from filename (e.g. "BDREMUX", "WEB-DL")
  extension: string;
  dest?: string; // FTP destination folder — shows full path preview
  onChange: (filename: string) => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SOURCE_OPTIONS = [
  "",
  "CUSTOM",
  "WEB-DL",
  "WEB-DL Micro",
  "WEBRip",
  "BDREMUX",
  "BDRip",
  "BluRay",
  "HDTV",
  "REMUX",
];
const RESOLUTIONS = ["", "2160p", "1080p", "720p", "480p"];
const CODECS = ["", "HEVC", "AVC", "AV1", "VP9", "MPEG2"];
const AUDIO_CODECS = [
  "",
  "TrueHD Atmos",
  "TrueHD",
  "DTS-HD MA",
  "DTS:X",
  "DTS-HD HRA",
  "DTS",
  "EAC3",
  "AC3",
  "AAC",
  "FLAC",
  "MP3",
];
const HDR_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "—" },
  { value: "HDR", label: "HDR" },
  { value: "HDR10", label: "HDR10" },
  { value: "HDR10+", label: "HDR10+" },
  { value: "HLG", label: "HLG" },
  { value: "DV", label: "Dolby Vision" },
  { value: "HDR+DV", label: "HDR + Dolby Vision" },
  { value: "SDR", label: "SDR" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Remove " - " subtitle separators from a title string and collapse spaces. */
function stripDash(s: string): string {
  return s
    .replace(/\s+-\s+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Channel count → display string (6 → "5.1", 8 → "7.1", 2 → "2.0"). */
function formatChannels(n: number | null): string {
  if (!n) return "";
  if (n <= 2) return `${n}.0`;
  if (n === 6) return "5.1";
  if (n === 8) return "7.1";
  return `${n}.0`;
}

/** The HDR label to embed in the metadata parens (empty when DV-only). */
function hdrCore(h: string): string {
  if (!h || h === "DV") return "";
  if (h === "HDR+DV") return "HDR";
  return h;
}

/** Whether to append [Dolby Vision] bracket. */
function isDV(h: string): boolean {
  return h === "DV" || h === "HDR+DV";
}

/** Map a parser release_type string to a SOURCE_OPTIONS value. */
function mapReleaseType(rt: string | null | undefined): string {
  if (!rt) return "";
  const r = rt.toUpperCase();
  if (r === "BDREMUX" || r === "BD REMUX" || r === "REMUX") return "BDREMUX";
  if (r === "BDRIP") return "BDRip";
  if (r === "BRRIP") return "BDRip";
  if (r === "BLURAY") return "BluRay";
  if (r === "WEB-DL" || r === "WEBDL") return "WEB-DL";
  if (r === "WEBRIP") return "WEBRip";
  if (r === "HDTV") return "HDTV";
  return "";
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function FilenameBuilder({
  info,
  mediaType,
  defaultTitle = "",
  defaultShowName = "",
  defaultYear,
  defaultSeason = 1,
  defaultEpisode, // undefined = season mode (no episode number in filename)
  defaultReleaseType,
  extension,
  dest,
  onChange,
}: FilenameBuilderProps) {
  // Shared fields
  const [resolution, setResolution] = useState(info?.resolution ?? "");
  const [codec, setCodec] = useState(info?.codec ?? "");
  const [hdr, setHdr] = useState(info?.hdr ?? "");
  const [audioCodec, setAudioCodec] = useState(
    info?.audio_tracks?.[0]?.codec ?? "",
  );
  const [channels, setChannels] = useState(
    formatChannels(info?.audio_tracks?.[0]?.channels ?? null),
  );
  const [langs, setLangs] = useState(
    (info?.languages ?? []).map((l) => l.toUpperCase()).join(", "),
  );
  const [source, setSource] = useState(() =>
    mapReleaseType(defaultReleaseType),
  );
  const [subs, setSubs] = useState(
    () => (info?.subtitle_tracks?.length ?? 0) > 0,
  );
  const [copied, setCopied] = useState(false);

  // Movie-specific (strip subtitle dashes on init)
  const [title, setTitle] = useState(() => stripDash(defaultTitle));
  const [year, setYear] = useState(defaultYear ? String(defaultYear) : "");

  // TV-specific
  const episodeMode = defaultEpisode !== undefined;
  const [showName, setShowName] = useState(() => stripDash(defaultShowName));
  const [season, setSeason] = useState(defaultSeason);
  const [episode, setEpisode] = useState(defaultEpisode ?? 1);
  const [episodeTitle, setEpisodeTitle] = useState(() =>
    stripDash(defaultTitle),
  );

  const buildFilename = () => {
    const ext = extension.startsWith(".") ? extension.slice(1) : extension;

    if (mediaType === "tv") {
      // TV: dot-separated format — Show.Name.S01E01.Episode.Title.1080p.HEVC.SPA.ENG.mkv
      const parts: string[] = [];
      if (showName.trim()) parts.push(stripDash(showName).replace(/\s+/g, "."));
      const s = String(season).padStart(2, "0");
      if (episodeMode) {
        const e = String(episode).padStart(2, "0");
        parts.push(`S${s}E${e}`);
        if (episodeTitle.trim())
          parts.push(stripDash(episodeTitle).replace(/\s+/g, "."));
      } else {
        parts.push(`S${s}`);
      }
      if (source.trim()) parts.push(source.trim().toUpperCase());
      if (resolution.trim()) parts.push(resolution.trim());
      if (codec.trim()) parts.push(codec.trim());
      const core = hdrCore(hdr);
      if (core) parts.push(core);
      if (isDV(hdr)) parts.push("DV");
      if (audioCodec.trim()) {
        const ch = channels.trim();
        parts.push(ch ? `${audioCodec.trim()}.${ch}` : audioCodec.trim());
      }
      const langList = langs
        .split(/[,\s]+/)
        .filter(Boolean)
        .map((l) => l.toUpperCase());
      parts.push(...langList);
      const name = parts.join(".");
      return ext ? `${name}.${ext}` : name;
    }

    // Movie: Title (Year.SOURCE.RESOLUTION.CODEC.HDR.LANG.AUDIO CHANNELS.SUBS)[Dolby Vision].ext
    const titleClean = stripDash(title);
    const tags: string[] = [];
    if (year.trim()) tags.push(year.trim());
    if (source.trim()) tags.push(source.trim().toUpperCase());
    if (resolution.trim()) tags.push(resolution.trim().toUpperCase());
    if (codec.trim()) tags.push(codec.trim().toUpperCase());
    const core = hdrCore(hdr);
    if (core) tags.push(core.toUpperCase());
    const langList = langs
      .split(/[,\s]+/)
      .filter(Boolean)
      .map((l) => l.toUpperCase());
    tags.push(...langList);
    if (audioCodec.trim()) {
      const ch = channels.trim();
      tags.push(ch ? `${audioCodec.trim()} ${ch}` : audioCodec.trim());
    }
    if (subs) tags.push("SUBS");

    const inner = tags.join(".");
    const dvBracket = isDV(hdr) ? "[Dolby Vision]" : "";
    const base = titleClean
      ? `${titleClean} (${inner})${dvBracket}`
      : inner
        ? `(${inner})${dvBracket}`
        : "";
    return ext ? `${base}.${ext}` : base;
  };

  const filename = buildFilename();
  const notify = () => onChange(buildFilename());

  // Push the initial computed filename to the parent immediately on mount
  // so customFilename is correct even if the user never touches any field.
  useEffect(() => {
    onChange(buildFilename());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const copy = () => {
    navigator.clipboard.writeText(filename).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        background: "var(--color-surface-2)",
        borderRadius: "var(--radius)",
        padding: "12px 14px",
      }}
    >
      {/* Movie fields */}
      {mediaType !== "tv" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 80px",
            gap: "8px 10px",
          }}
        >
          <Field label="Título">
            <input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                notify();
              }}
              placeholder="The Dark Knight"
              style={inputStyle}
            />
          </Field>
          <Field label="Año">
            <input
              value={year}
              onChange={(e) => {
                setYear(e.target.value);
                notify();
              }}
              placeholder="2008"
              style={inputStyle}
              maxLength={4}
            />
          </Field>
        </div>
      )}

      {/* TV fields */}
      {mediaType === "tv" && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: episodeMode ? "1fr 60px 60px" : "1fr 60px",
              gap: "8px 10px",
            }}
          >
            <Field label="Nombre de la serie">
              <input
                value={showName}
                onChange={(e) => {
                  setShowName(e.target.value);
                  notify();
                }}
                placeholder="Breaking Bad"
                style={inputStyle}
              />
            </Field>
            <Field label="Temp.">
              <input
                type="number"
                min={1}
                max={99}
                value={season}
                onChange={(e) => {
                  setSeason(Number(e.target.value));
                  notify();
                }}
                style={inputStyle}
              />
            </Field>
            {episodeMode && (
              <Field label="Ep.">
                <input
                  type="number"
                  min={1}
                  max={999}
                  value={episode}
                  onChange={(e) => {
                    setEpisode(Number(e.target.value));
                    notify();
                  }}
                  style={inputStyle}
                />
              </Field>
            )}
          </div>
          {episodeMode && (
            <Field label="Título del episodio (opcional)">
              <input
                value={episodeTitle}
                onChange={(e) => {
                  setEpisodeTitle(e.target.value);
                  notify();
                }}
                placeholder="Pilot"
                style={inputStyle}
              />
            </Field>
          )}
        </>
      )}

      {/* Quality row 1: Source / Resolution / Codec */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: "8px 10px",
        }}
      >
        <Field label="Fuente">
          <select
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              notify();
            }}
            style={selectStyle}
          >
            {SOURCE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s || "—"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Resolución">
          <select
            value={resolution}
            onChange={(e) => {
              setResolution(e.target.value);
              notify();
            }}
            style={selectStyle}
          >
            {RESOLUTIONS.map((r) => (
              <option key={r} value={r}>
                {r || "—"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Códec vídeo">
          <select
            value={codec}
            onChange={(e) => {
              setCodec(e.target.value);
              notify();
            }}
            style={selectStyle}
          >
            {CODECS.map((c) => (
              <option key={c} value={c}>
                {c || "—"}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {/* Quality row 2: HDR / Audio codec / Channels */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 80px",
          gap: "8px 10px",
        }}
      >
        <Field label="HDR">
          <select
            value={hdr}
            onChange={(e) => {
              setHdr(e.target.value);
              notify();
            }}
            style={selectStyle}
          >
            {HDR_OPTIONS.map((h) => (
              <option key={h.value} value={h.value}>
                {h.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Códec audio">
          <select
            value={audioCodec}
            onChange={(e) => {
              setAudioCodec(e.target.value);
              notify();
            }}
            style={selectStyle}
          >
            {AUDIO_CODECS.map((a) => (
              <option key={a} value={a}>
                {a || "—"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Canales">
          <input
            value={channels}
            onChange={(e) => {
              setChannels(e.target.value);
              notify();
            }}
            placeholder="5.1"
            style={inputStyle}
          />
        </Field>
      </div>

      {/* Languages + Subs (subs only for movies) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: mediaType !== "tv" ? "1fr auto" : "1fr",
          gap: "8px 16px",
          alignItems: "end",
        }}
      >
        <Field label="Idiomas (ej: SPA, ENG)">
          <input
            value={langs}
            onChange={(e) => {
              setLangs(e.target.value);
              notify();
            }}
            placeholder="SPA, ENG"
            style={inputStyle}
          />
        </Field>
        {mediaType !== "tv" && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              paddingBottom: 1,
            }}
          >
            <span
              style={{
                fontSize: 10,
                color: "var(--color-text-muted)",
                fontWeight: 600,
                letterSpacing: "0.04em",
                whiteSpace: "nowrap",
              }}
            >
              SUBS
            </span>
            <Toggle
              checked={subs}
              onChange={(v) => {
                setSubs(v);
                notify();
              }}
            />
          </div>
        )}
      </div>

      {/* Preview */}
      <div
        style={{ borderTop: "1px solid var(--color-border)", paddingTop: 10 }}
      >
        <div
          style={{
            fontSize: 11,
            color: "var(--color-text-muted)",
            marginBottom: 4,
          }}
        >
          Vista previa
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "var(--color-surface)",
            borderRadius: "var(--radius)",
            border: "1px solid var(--color-border)",
            padding: "7px 10px",
          }}
        >
          <span
            style={{
              flex: 1,
              fontSize: 11,
              color: "var(--color-text)",
              wordBreak: "break-all",
              fontFamily: "monospace",
            }}
          >
            {filename}
          </span>
          <button
            onClick={copy}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: 11,
              color: copied
                ? "var(--color-success)"
                : "var(--color-text-muted)",
              flexShrink: 0,
              padding: "2px 6px",
            }}
            title="Copiar"
          >
            <Copy size={12} />
            {copied ? "Copiado" : "Copiar"}
          </button>
        </div>

        {/* Full FTP path tree */}
        {dest && (
          <div
            style={{
              marginTop: 8,
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius)",
              padding: "8px 10px",
              fontFamily: "monospace",
              fontSize: 11,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                color: "var(--color-text-muted)",
              }}
            >
              <FolderOpen size={12} color="var(--color-warning)" />
              <span>{dest.endsWith("/") ? dest : dest + "/"}</span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                color: "var(--color-text)",
                marginTop: 3,
                paddingLeft: 4,
              }}
            >
              <span style={{ color: "var(--color-border)" }}>└──</span>
              <FileVideo size={12} color="var(--color-primary)" />
              <span style={{ wordBreak: "break-all" }}>{filename}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Field wrapper ────────────────────────────────────────────────────────────

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <label
        style={{
          fontSize: 10,
          color: "var(--color-text-muted)",
          fontWeight: 600,
          letterSpacing: "0.04em",
        }}
      >
        {label.toUpperCase()}
      </label>
      {children}
    </div>
  );
}

const inputStyle = formInputCompact;
const selectStyle = formSelectCompact;
