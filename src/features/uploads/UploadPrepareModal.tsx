import { useState } from "react";
import { createPortal } from "react-dom";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import {
  Upload,
  FolderOpen,
  X,
  AlertTriangle,
  ChevronRight,
  ChevronLeft,
  Loader2,
} from "lucide-react";
import AnalysisRow from "./AnalysisRow";
import type {
  AnalysisResult,
  LocalMediaInfo,
  TmdbMatch,
  UploadSuggestion,
} from "./types";

/** Lowercase + strip subtitle separators before sending to TMDB. */
function cleanTmdbQuery(raw: string): string {
  return raw
    .normalize("NFC") // macOS stores filenames as NFD; normalise to NFC for TMDB
    .replace(/\s+-\s+/g, " ") // replace " - " separator with space (keep full title)
    .replace(/-/g, " ") // remove remaining hyphens
    .replace(/\s{2,}/g, " ") // collapse spaces
    .trim()
    .toLowerCase();
}

interface UploadPrepareModalProps {
  ffprobeAvailable: boolean;
  onClose: () => void;
  onQueued: () => void;
}

type Step = "select" | "analyse" | "configure";

interface FileEntry {
  path: string;
  filename: string;
  isDirectory: boolean;
  customDest: string;
  customFilename: string;
  suggestion: UploadSuggestion | null;
  tmdbMatch: TmdbMatch | null;
  episodePlan: { localPath: string; filename: string }[] | null;
}

export default function UploadPrepareModal({
  ffprobeAvailable,
  onClose,
  onQueued,
}: UploadPrepareModalProps) {
  const [step, setStep] = useState<Step>("select");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [analysisResults, setAnalysisResults] = useState<
    Map<string, AnalysisResult>
  >(new Map());
  const [analysingIdx, setAnalysingIdx] = useState(-1);
  const [analysingPhase, setAnalysingPhase] = useState<"probe" | "tmdb">(
    "probe",
  );
  const [queueing, setQueueing] = useState(false);
  const [error, setError] = useState("");
  const [installingFfprobe, setInstallingFfprobe] = useState(false);
  const [ffprobeInstalled, setFfprobeInstalled] = useState(false);
  const effectiveFfprobeAvailable = ffprobeAvailable || ffprobeInstalled;

  const installFfprobe = async () => {
    setInstallingFfprobe(true);
    try {
      await invoke("install_ffprobe");
      setFfprobeInstalled(true);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setInstallingFfprobe(false);
    }
  };

  // ── Step 1 helpers ────────────────────────────────────────────────────────

  const selectFiles = async () => {
    const selected = await open({
      multiple: true,
      filters: [
        {
          name: "Vídeo",
          extensions: ["mkv", "mp4", "avi", "mov", "ts", "m2ts", "wmv"],
        },
      ],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    const entries: FileEntry[] = paths.map((p) => ({
      path: p,
      filename: p.split(/[\\/]/).pop() ?? p,
      isDirectory: false,
      customDest: "",
      customFilename: p.split(/[\\/]/).pop() ?? p,
      suggestion: null,
      tmdbMatch: null,
      episodePlan: null,
    }));
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => f.path));
      return [...prev, ...entries.filter((e) => !existing.has(e.path))];
    });
  };

  const selectFolder = async () => {
    const folder = await open({ directory: true, multiple: false });
    if (!folder || Array.isArray(folder)) return;
    const folderPath = folder as string;
    const fakeFilename = folderPath.split(/[\\/]/).pop() ?? folderPath;
    setFiles((prev) => {
      if (prev.some((f) => f.path === folderPath)) return prev;
      return [
        ...prev,
        {
          path: folderPath,
          filename: fakeFilename,
          isDirectory: true,
          customDest: "",
          customFilename: fakeFilename,
          suggestion: null,
          tmdbMatch: null,
          episodePlan: null,
        },
      ];
    });
  };

  const removeFile = (path: string) => {
    setFiles((prev) => prev.filter((f) => f.path !== path));
  };

  // ── Step 2: analyse ───────────────────────────────────────────────────────

  const runAnalysis = async () => {
    setStep("analyse");
    const results = new Map<string, AnalysisResult>();
    for (let i = 0; i < files.length; i++) {
      setAnalysingIdx(i);
      setAnalysingPhase("probe");
      const f = files[i];
      let suggestion: UploadSuggestion | null = null;
      try {
        const [info, sug] = await Promise.all([
          effectiveFfprobeAvailable
            ? invoke<LocalMediaInfo>("analyze_local_file", { path: f.path })
            : Promise.resolve(null),
          invoke<UploadSuggestion>("suggest_upload_destination", {
            localPath: f.path,
          }),
        ]);
        suggestion = sug;
        results.set(f.path, {
          path: f.path,
          filename: f.filename,
          info,
          error: null,
        });
        setFiles((prev) =>
          prev.map((entry) =>
            entry.path === f.path
              ? {
                  ...entry,
                  suggestion: sug,
                  customDest: sug.dest,
                  customFilename: entry.filename,
                }
              : entry,
          ),
        );
      } catch (e: unknown) {
        results.set(f.path, {
          path: f.path,
          filename: f.filename,
          info: null,
          error: String(e),
        });
      }
      setAnalysisResults(new Map(results));

      // Phase 2: auto TMDB match
      setAnalysingPhase("tmdb");
      try {
        const rawTitle =
          suggestion?.detected_title ??
          f.filename.replace(/\.[^.]+$/, "").replace(/[._]/g, " ");
        const tmdbMatches = await invoke<TmdbMatch[]>("search_tmdb", {
          query: cleanTmdbQuery(rawTitle),
          mediaType: suggestion?.media_type === "tv" ? "tv" : "movie",
          year: suggestion?.detected_year ?? null,
        });
        const tmdbMatch = tmdbMatches[0] ?? null;
        setFiles((prev) =>
          prev.map((entry) =>
            entry.path === f.path ? { ...entry, tmdbMatch } : entry,
          ),
        );
      } catch {
        // silently fail — no auto-match
      }
    }
    setAnalysingIdx(-1);
    setStep("configure");
  };

  // ── Step 3: queue ─────────────────────────────────────────────────────────

  const handleDestChange = (path: string, dest: string) => {
    setFiles((prev) =>
      prev.map((f) => (f.path === path ? { ...f, customDest: dest } : f)),
    );
  };

  const handleFilenameChange = (path: string, filename: string) => {
    setFiles((prev) =>
      prev.map((f) =>
        f.path === path ? { ...f, customFilename: filename } : f,
      ),
    );
  };

  const handleTmdbChange = (path: string, match: TmdbMatch | null) => {
    setFiles((prev) =>
      prev.map((f) => (f.path === path ? { ...f, tmdbMatch: match } : f)),
    );
  };

  const handleEpisodePlanChange = (
    path: string,
    plan: { localPath: string; filename: string }[],
  ) => {
    setFiles((prev) =>
      prev.map((f) => (f.path === path ? { ...f, episodePlan: plan } : f)),
    );
  };

  const addToQueue = async () => {
    setQueueing(true);
    setError("");
    try {
      for (const f of files) {
        const info = analysisResults.get(f.path)?.info;
        const sug = f.suggestion;
        const resolution = info?.resolution ?? sug?.detected_resolution ?? null;
        const hdr = info?.hdr ?? sug?.detected_hdr ?? null;
        const languages =
          (info?.languages?.length
            ? info.languages
            : sug?.detected_languages) ?? [];
        const codec = info?.codec ?? sug?.detected_codec ?? null;
        const audioCodec =
          info?.audio_tracks?.[0]?.codec ?? sug?.detected_audio_codec ?? null;
        const audioTracks = info?.audio_tracks ?? [];
        const subtitleLangs = [
          ...new Set(
            (info?.subtitle_tracks ?? [])
              .map((t) => t.language)
              .filter((l): l is string => !!l),
          ),
        ];
        const subtitleTracks = info?.subtitle_tracks ?? [];

        // TV season directory: explode into individual episode uploads (flat into dest folder)
        if (f.isDirectory && f.episodePlan && f.episodePlan.length > 0) {
          // All episodes in this batch share the same group_id so only one Telegram
          // notification is sent when the last episode finishes.
          const groupId = crypto.randomUUID();
          for (const ep of f.episodePlan) {
            await invoke("queue_upload", {
              localPath: ep.localPath,
              ftpDestPath: f.customDest,
              filename: ep.filename,
              mediaTitle: f.tmdbMatch?.title ?? null,
              tmdbId: f.tmdbMatch?.id ?? null,
              sizeBytes: 0,
              resolution,
              hdr,
              languages,
              codec,
              audioCodec,
              subtitleLangs,
              audioTracks,
              subtitleTracks,
              groupId,
            });
          }
        } else {
          await invoke("queue_upload", {
            localPath: f.path,
            ftpDestPath: f.customDest,
            filename: f.customFilename,
            mediaTitle: f.tmdbMatch?.title ?? null,
            tmdbId: f.tmdbMatch?.id ?? null,
            sizeBytes: info?.size_bytes ?? 0,
            resolution,
            hdr,
            languages,
            codec,
            audioCodec,
            subtitleLangs,
            audioTracks,
            subtitleTracks,
            groupId: null,
          });
        }
      }
      onQueued();
      onClose();
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setQueueing(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const stepIndex = step === "select" ? 0 : step === "analyse" ? 1 : 2;

  const content = (
    <div
      className="modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 680,
          maxHeight: "calc(100dvh - 2.5rem)",
          display: "flex",
          flexDirection: "column",
          background: "var(--color-surface)",
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--color-border)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "16px 20px",
            borderBottom: "1px solid var(--color-border)",
            flexShrink: 0,
          }}
        >
          <Upload size={17} color="var(--color-primary)" />
          <span
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: "var(--color-text)",
              flex: 1,
            }}
          >
            Subir archivos al servidor FTP
          </span>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--color-text-muted)",
              display: "flex",
              padding: 4,
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Step indicator */}
        <StepIndicator current={stepIndex} />

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
          {step === "select" && (
            <SelectStep
              files={files}
              onSelectFiles={selectFiles}
              onSelectFolder={selectFolder}
              onRemove={removeFile}
            />
          )}

          {step === "analyse" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {files.map((f, i) => {
                const done = analysisResults.has(f.path);
                const hasError = analysisResults.get(f.path)?.error;
                const isActive = analysingIdx === i;
                const tmdbDone = done && !isActive;
                return (
                  <div
                    key={f.path}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      padding: "10px 14px",
                      background: "var(--color-surface-2)",
                      borderRadius: "var(--radius)",
                      border: "1px solid var(--color-border)",
                    }}
                  >
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 10 }}
                    >
                      {isActive ? (
                        <Loader2
                          size={14}
                          color="var(--color-primary)"
                          style={{
                            animation: "spin 1s linear infinite",
                            flexShrink: 0,
                          }}
                        />
                      ) : done ? (
                        hasError ? (
                          <AlertTriangle
                            size={14}
                            color="var(--color-danger)"
                            style={{ flexShrink: 0 }}
                          />
                        ) : (
                          <span
                            style={{
                              fontSize: 13,
                              flexShrink: 0,
                              color: "var(--color-success)",
                            }}
                          >
                            ✓
                          </span>
                        )
                      ) : (
                        <span
                          style={{
                            width: 14,
                            height: 14,
                            borderRadius: "50%",
                            background: "var(--color-border)",
                            flexShrink: 0,
                          }}
                        />
                      )}
                      <span
                        style={{
                          fontSize: 12,
                          color: "var(--color-text)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          flex: 1,
                        }}
                      >
                        {f.filename}
                      </span>
                      {isActive && (
                        <span
                          style={{
                            fontSize: 11,
                            color: "var(--color-text-muted)",
                            flexShrink: 0,
                          }}
                        >
                          {analysingPhase === "probe"
                            ? "Analizando archivo…"
                            : "Buscando en TMDB…"}
                        </span>
                      )}
                    </div>
                    {tmdbDone && !hasError && f.tmdbMatch && (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          paddingLeft: 24,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            color: "var(--color-success)",
                          }}
                        >
                          TMDB:
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            color: "var(--color-text-muted)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {f.tmdbMatch.title} (
                          {f.tmdbMatch.release_date?.slice(0, 4) ?? "—"})
                        </span>
                      </div>
                    )}
                    {tmdbDone && !hasError && !f.tmdbMatch && done && (
                      <div style={{ paddingLeft: 24 }}>
                        <span
                          style={{
                            fontSize: 11,
                            color: "var(--color-warning)",
                          }}
                        >
                          TMDB: sin coincidencia automática
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {step === "configure" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {!effectiveFfprobeAvailable && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    background: "rgba(200,147,42,0.1)",
                    border: "1px solid rgba(200,147,42,0.3)",
                    borderRadius: "var(--radius)",
                    padding: "10px 14px",
                  }}
                >
                  <AlertTriangle size={14} color="var(--color-warning)" />
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--color-warning)",
                      flex: 1,
                    }}
                  >
                    ffprobe no encontrado. El análisis de calidad no está
                    disponible.
                  </span>
                  <button
                    onClick={installFfprobe}
                    disabled={installingFfprobe}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      background: "var(--color-primary)",
                      border: "none",
                      borderRadius: "var(--radius)",
                      color: "#fff",
                      fontSize: 11,
                      fontWeight: 600,
                      padding: "4px 10px",
                      cursor: installingFfprobe ? "not-allowed" : "pointer",
                      opacity: installingFfprobe ? 0.6 : 1,
                      flexShrink: 0,
                      transition: "opacity 0.15s ease",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {installingFfprobe ? "Instalando…" : "Instalar ffmpeg"}
                  </button>
                </div>
              )}

              {files.map((f) => {
                const result = analysisResults.get(f.path) ?? {
                  path: f.path,
                  filename: f.filename,
                  info: null,
                  error: null,
                };
                return (
                  <AnalysisRow
                    key={f.path}
                    result={result}
                    suggestion={f.suggestion}
                    isDirectory={f.isDirectory}
                    tmdbMatch={f.tmdbMatch}
                    onDestChange={handleDestChange}
                    onFilenameChange={handleFilenameChange}
                    onTmdbChange={handleTmdbChange}
                    onEpisodePlanChange={handleEpisodePlanChange}
                  />
                );
              })}

              {error && (
                <div
                  style={{
                    background: "rgba(224,85,85,0.1)",
                    border: "1px solid rgba(224,85,85,0.3)",
                    borderRadius: "var(--radius)",
                    padding: "8px 12px",
                    fontSize: 12,
                    color: "var(--color-danger)",
                  }}
                >
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            padding: "14px 20px",
            borderTop: "1px solid var(--color-border)",
            flexShrink: 0,
          }}
        >
          {step !== "select" ? (
            <button
              disabled={step === "analyse"}
              onClick={() => setStep("select")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "var(--color-surface-2)",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius)",
                color: "var(--color-text)",
                fontSize: 13,
                padding: "8px 14px",
                cursor: step === "analyse" ? "not-allowed" : "pointer",
                opacity: step === "analyse" ? 0.5 : 1,
              }}
            >
              <ChevronLeft size={14} />
              Atrás
            </button>
          ) : (
            <div />
          )}

          {step === "select" && (
            <button
              disabled={files.length === 0}
              onClick={runAnalysis}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "var(--color-primary)",
                border: "none",
                borderRadius: "var(--radius)",
                color: "#fff",
                fontSize: 13,
                fontWeight: 600,
                padding: "8px 18px",
                cursor: files.length === 0 ? "not-allowed" : "pointer",
                opacity: files.length === 0 ? 0.5 : 1,
                transition: "opacity 0.15s ease",
              }}
            >
              Siguiente
              <ChevronRight size={14} />
            </button>
          )}

          {step === "configure" && (
            <button
              disabled={queueing || files.length === 0}
              onClick={addToQueue}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "var(--color-primary)",
                border: "none",
                borderRadius: "var(--radius)",
                color: "#fff",
                fontSize: 13,
                fontWeight: 600,
                padding: "8px 18px",
                cursor:
                  queueing || files.length === 0 ? "not-allowed" : "pointer",
                opacity: queueing || files.length === 0 ? 0.5 : 1,
                transition: "opacity 0.15s ease",
              }}
            >
              {queueing ? (
                <Loader2
                  size={14}
                  style={{ animation: "spin 1s linear infinite" }}
                />
              ) : (
                <Upload size={14} />
              )}
              Añadir a la cola
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}

// ─── Step indicator ───────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: number }) {
  const steps = ["Seleccionar", "Analizar", "Configurar"];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 0,
        padding: "10px 20px",
        borderBottom: "1px solid var(--color-border)",
        flexShrink: 0,
      }}
    >
      {steps.map((label, i) => (
        <div
          key={label}
          style={{ display: "flex", alignItems: "center", flex: 1 }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                background:
                  i < current
                    ? "var(--color-success)"
                    : i === current
                      ? "var(--color-primary)"
                      : "var(--color-border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 11,
                fontWeight: 700,
                color: i <= current ? "#fff" : "var(--color-text-muted)",
                flexShrink: 0,
              }}
            >
              {i < current ? "✓" : i + 1}
            </div>
            <span
              style={{
                fontSize: 12,
                color:
                  i === current
                    ? "var(--color-text)"
                    : "var(--color-text-muted)",
                fontWeight: i === current ? 600 : 400,
              }}
            >
              {label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div
              style={{
                flex: 1,
                height: 1,
                background:
                  i < current ? "var(--color-success)" : "var(--color-border)",
                margin: "0 8px",
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── SelectStep ───────────────────────────────────────────────────────────────

function SelectStep({
  files,
  onSelectFiles,
  onSelectFolder,
  onRemove,
}: {
  files: { path: string; filename: string }[];
  onSelectFiles: () => void;
  onSelectFolder: () => void;
  onRemove: (path: string) => void;
}) {
  const [hoveredSide, setHoveredSide] = useState<"files" | "folder" | null>(
    null,
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Unified pick zone — two halves, one visual block */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1px 1fr",
          background: "var(--color-surface-2)",
          border: "2px dashed var(--color-border)",
          borderRadius: "var(--radius)",
          overflow: "hidden",
          transition: "border-color 0.15s ease",
        }}
      >
        {/* Files side */}
        <button
          onClick={onSelectFiles}
          onMouseEnter={() => setHoveredSide("files")}
          onMouseLeave={() => setHoveredSide(null)}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: "22px 16px",
            background:
              hoveredSide === "files"
                ? "rgba(124,110,247,0.07)"
                : "transparent",
            border: "none",
            cursor: "pointer",
            transition: "background 0.15s ease",
          }}
        >
          <Upload
            size={20}
            color={
              hoveredSide === "files"
                ? "var(--color-primary)"
                : "var(--color-text-muted)"
            }
            style={{ transition: "color 0.15s ease" }}
          />
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color:
                  hoveredSide === "files"
                    ? "var(--color-text)"
                    : "var(--color-text-muted)",
                transition: "color 0.15s ease",
              }}
            >
              Archivos de vídeo
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--color-text-muted)",
                marginTop: 2,
              }}
            >
              .mkv, .mp4, .avi…
            </div>
          </div>
        </button>

        {/* Divider */}
        <div style={{ background: "var(--color-border)" }} />

        {/* Folder side */}
        <button
          onClick={onSelectFolder}
          onMouseEnter={() => setHoveredSide("folder")}
          onMouseLeave={() => setHoveredSide(null)}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: "22px 16px",
            background:
              hoveredSide === "folder"
                ? "rgba(20,184,166,0.07)"
                : "transparent",
            border: "none",
            cursor: "pointer",
            transition: "background 0.15s ease",
          }}
        >
          <FolderOpen
            size={20}
            color={
              hoveredSide === "folder"
                ? "var(--color-teal)"
                : "var(--color-text-muted)"
            }
            style={{ transition: "color 0.15s ease" }}
          />
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color:
                  hoveredSide === "folder"
                    ? "var(--color-text)"
                    : "var(--color-text-muted)",
                transition: "color 0.15s ease",
              }}
            >
              Carpeta completa
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--color-text-muted)",
                marginTop: 2,
              }}
            >
              Serie, temporada, pack…
            </div>
          </div>
        </button>
      </div>

      {files.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--color-text-muted)",
              letterSpacing: "0.04em",
            }}
          >
            ARCHIVOS SELECCIONADOS ({files.length})
          </div>
          {files.map((f) => (
            <div
              key={f.path}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: "var(--color-surface-2)",
                borderRadius: "var(--radius)",
                border: "1px solid var(--color-border)",
                padding: "8px 12px",
              }}
            >
              <FolderOpen size={12} color="var(--color-text-muted)" />
              <span
                style={{
                  flex: 1,
                  fontSize: 12,
                  color: "var(--color-text)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={f.path}
              >
                {f.filename}
              </span>
              <button
                onClick={() => onRemove(f.path)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--color-text-muted)",
                  display: "flex",
                  padding: 2,
                }}
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      {files.length === 0 && (
        <div
          style={{
            textAlign: "center",
            color: "var(--color-text-muted)",
            fontSize: 13,
            padding: "20px 0",
          }}
        >
          No hay archivos seleccionados
        </div>
      )}
    </div>
  );
}
