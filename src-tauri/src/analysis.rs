use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioTrack {
    pub codec: String,
    pub language: Option<String>,
    pub channels: Option<u32>,
    pub is_default: bool,
    pub bitrate_kbps: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubtitleTrack {
    pub codec: String,
    pub language: Option<String>,
    pub is_default: bool,
    pub is_forced: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalMediaInfo {
    pub resolution: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub codec: Option<String>,
    pub video_bitrate_kbps: Option<u32>,
    pub audio_tracks: Vec<AudioTrack>,
    pub languages: Vec<String>,
    pub hdr: Option<String>,
    pub duration_secs: Option<f64>,
    pub size_bytes: u64,
    pub format: Option<String>,
    pub subtitle_tracks: Vec<SubtitleTrack>,
}

// ─── ffprobe JSON types ───────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct FfprobeOutput {
    streams: Vec<FfprobeStream>,
    format: Option<FfprobeFormat>,
}

#[derive(Debug, Deserialize)]
struct FfprobeStream {
    codec_type: Option<String>,
    codec_name: Option<String>,
    profile: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    color_transfer: Option<String>,
    color_primaries: Option<String>,
    #[serde(default)]
    disposition: FfprobeDisposition,
    tags: Option<FfprobeTags>,
    channels: Option<u32>,
    bit_rate: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct FfprobeDisposition {
    #[serde(default)]
    default: u8,
    #[serde(default)]
    attached_pic: u8,
    #[serde(default)]
    forced: u8,
}

#[derive(Debug, Deserialize)]
struct FfprobeTags {
    language: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FfprobeFormat {
    duration: Option<String>,
    format_name: Option<String>,
    size: Option<String>,
}

// ─── Public API ───────────────────────────────────────────────────────────────

/// Returns the absolute path to the ffprobe binary, checking common install
/// locations first so Tauri apps on macOS work even without Homebrew in PATH.
pub fn resolve_ffprobe_binary() -> Option<String> {
    let mut candidates: Vec<&str> = Vec::new();

    // Absolute paths first — Tauri apps on macOS launch with a minimal PATH
    // that typically excludes /opt/homebrew/bin and /usr/local/bin.
    #[cfg(not(target_os = "windows"))]
    {
        candidates.extend_from_slice(&[
            "/opt/homebrew/bin/ffprobe",    // Homebrew Apple Silicon
            "/usr/local/bin/ffprobe",        // Homebrew Intel / manual install
            "/usr/bin/ffprobe",              // system package (Linux)
            "/usr/local/ffmpeg/bin/ffprobe", // manual FFmpeg bundle
        ]);
    }
    #[cfg(target_os = "windows")]
    candidates.extend_from_slice(&["ffprobe.exe"]);

    // Bare name last (relies on PATH — works in a terminal but not always in apps).
    candidates.push("ffprobe");

    for candidate in candidates {
        if std::process::Command::new(candidate)
            .args(["-version"])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
        {
            return Some(candidate.to_string());
        }
    }
    None
}

/// Returns the ffprobe version string if found, or None.
pub fn check_ffprobe() -> Option<String> {
    let binary = resolve_ffprobe_binary()?;
    let output = std::process::Command::new(&binary)
        .args(["-version"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;
    if output.status.success() {
        Some(
            String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()
                .unwrap_or(&binary)
                .to_string(),
        )
    } else {
        None
    }
}

/// Try to install ffmpeg via the system package manager.
/// macOS: Homebrew (`brew install ffmpeg`)
/// Linux: apt-get (`apt-get install -y ffmpeg`)
/// Windows: returns an informative error (must be installed manually).
pub async fn install_ffmpeg() -> Result<String, String> {
    if cfg!(target_os = "macos") {
        // Locate Homebrew
        let brew = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew", "brew"]
            .into_iter()
            .find(|b| {
                std::process::Command::new(b)
                    .args(["--version"])
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .status()
                    .map(|s| s.success())
                    .unwrap_or(false)
            })
            .ok_or_else(|| {
                "Homebrew no encontrado. Instala Homebrew desde brew.sh y vuelve a intentarlo."
                    .to_string()
            })?;

        let output = tokio::process::Command::new(brew)
            .args(["install", "ffmpeg"])
            .output()
            .await
            .map_err(|e| format!("No se pudo ejecutar brew: {e}"))?;

        if output.status.success() {
            Ok("ffmpeg instalado correctamente vía Homebrew.".to_string())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(format!(
                "Error al instalar: {}",
                stderr.lines().next().unwrap_or("error desconocido")
            ))
        }
    } else if cfg!(target_os = "linux") {
        let output = tokio::process::Command::new("apt-get")
            .args(["install", "-y", "ffmpeg"])
            .output()
            .await
            .map_err(|e| format!("No se pudo ejecutar apt-get: {e}"))?;

        if output.status.success() {
            Ok("ffmpeg instalado correctamente vía apt.".to_string())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(format!(
                "Error al instalar: {}",
                stderr.lines().next().unwrap_or("error desconocido")
            ))
        }
    } else {
        Err("Instalación automática no disponible en Windows. Descarga ffmpeg desde https://ffmpeg.org/download.html e instálalo manualmente.".to_string())
    }
}

/// Run ffprobe on the local file at `path` and return parsed media info.
/// For directories, probes the first video file found (sorted by name) so that
/// a TV season folder inherits resolution/codec/audio from its first episode.
pub fn ffprobe_analyze(path: &str) -> Result<LocalMediaInfo, String> {
    let meta = std::fs::metadata(path).map_err(|e| format!("Cannot read path: {e}"))?;

    if meta.is_dir() {
        // Find the first video file inside the folder (sorted for determinism).
        let video_exts = ["mkv", "mp4", "avi", "m2ts", "mov", "ts"];
        let mut entries: Vec<std::path::PathBuf> = std::fs::read_dir(path)
            .map_err(|e| e.to_string())?
            .flatten()
            .filter_map(|e| {
                let p = e.path();
                let ext = p.extension()?.to_str()?.to_lowercase();
                if video_exts.contains(&ext.as_str()) { Some(p) } else { None }
            })
            .collect();
        entries.sort();

        if let Some(first) = entries.into_iter().next() {
            return ffprobe_analyze(first.to_str().unwrap_or(path));
        }

        // No video file found — return empty stub.
        return Ok(LocalMediaInfo {
            size_bytes: 0,
            duration_secs: None,
            width: None,
            height: None,
            resolution: None,
            codec: None,
            video_bitrate_kbps: None,
            hdr: None,
            audio_tracks: vec![],
            languages: vec![],
            format: None,
            subtitle_tracks: vec![],
        });
    }

    let file_size = meta.len();

    let binary = resolve_ffprobe_binary()
        .ok_or_else(|| "ffprobe no encontrado. Instala ffmpeg para activar el análisis de calidad.".to_string())?;

    let output = std::process::Command::new(&binary)
        .args([
            "-v", "quiet",
            "-print_format", "json",
            "-show_streams",
            "-show_format",
            path,
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to run ffprobe: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "ffprobe exited with non-zero status: {}",
            stderr.lines().next().unwrap_or("(sin detalles)")
        ));
    }

    let json = String::from_utf8_lossy(&output.stdout);
    let probe: FfprobeOutput = serde_json::from_str(&json)
        .map_err(|e| format!("Failed to parse ffprobe output: {e}"))?;

    // ── Video stream ──────────────────────────────────────────────────────────
    // Skip cover-art / attached picture streams — they are often 1920×1080 JPEGs
    // embedded in 4K MKVs and would be mistakenly identified as the video resolution.
    let video = probe.streams.iter().find(|s| {
        s.codec_type.as_deref() == Some("video") && s.disposition.attached_pic == 0
    });

    let width = video.and_then(|v| v.width);
    let height = video.and_then(|v| v.height);
    let codec = video.and_then(|v| v.codec_name.clone()).map(|c| normalize_codec(&c));
    let video_bitrate_kbps = video.and_then(|v| v.bit_rate.as_deref())
        .and_then(|b| b.parse::<u64>().ok())
        .map(|bps| (bps / 1000) as u32)
        .filter(|&k| k > 0);

    // Prefer actual dimensions from ffprobe (ground truth), fall back to
    // resolution keyword in the filename/path if dims are unavailable.
    let resolution = dims_to_resolution(width, height)
        .or_else(|| resolution_from_path(path));

    let hdr = video.and_then(|v| detect_hdr(v));

    // ── Audio streams ─────────────────────────────────────────────────────────
    let audio_tracks: Vec<AudioTrack> = probe.streams.iter()
        .filter(|s| s.codec_type.as_deref() == Some("audio"))
        .map(|s| {
            let lang = s.tags.as_ref().and_then(|t| t.language.clone())
                .map(|l| l.to_lowercase())
                .filter(|l| l != "und" && !l.is_empty());
            // Distinguish DTS variants and TrueHD+Atmos using the profile field
            // (ffprobe always reports codec_name="dts" for all DTS variants, and
            //  codec_name="truehd" for both TrueHD and TrueHD+Atmos).
            let codec = match s.codec_name.as_deref() {
                Some(cn) => {
                    let base = normalize_audio_codec(cn);
                    let profile_up = s.profile.as_deref()
                        .map(|p| p.to_uppercase())
                        .unwrap_or_default();
                    if base == "DTS" {
                        if profile_up.contains("DTS-HD MA") || profile_up.contains("DTS HD MA") {
                            "DTS-HD MA".to_string()
                        } else if profile_up.contains("DTS:X") || profile_up.contains("DTS-X") {
                            "DTS:X".to_string()
                        } else if profile_up.contains("DTS-HD HRA") {
                            "DTS-HD HRA".to_string()
                        } else {
                            base
                        }
                    } else if base == "TrueHD" && profile_up.contains("ATMOS") {
                        "TrueHD Atmos".to_string()
                    } else if base == "EAC3" && (profile_up.contains("ATMOS") || profile_up.contains("JOC")) {
                        "EAC3 Atmos".to_string()
                    } else {
                        base
                    }
                }
                None => String::new(),
            };
            let bitrate_kbps = s.bit_rate.as_deref()
                .and_then(|b| b.parse::<u64>().ok())
                .map(|bps| (bps / 1000) as u32)
                .filter(|&k| k > 0);
            AudioTrack {
                codec,
                language: lang,
                channels: s.channels,
                is_default: s.disposition.default == 1,
                bitrate_kbps,
            }
        })
        .collect();

    let mut languages: Vec<String> = audio_tracks.iter()
        .filter_map(|t| t.language.clone())
        .collect();
    // Deduplicate languages preserving order
    {
        let mut seen = std::collections::HashSet::new();
        languages.retain(|l| seen.insert(l.clone()));
    }

    // ── Subtitle streams ──────────────────────────────────────────────────────
    let subtitle_tracks: Vec<SubtitleTrack> = probe.streams.iter()
        .filter(|s| s.codec_type.as_deref() == Some("subtitle"))
        .map(|s| {
            let lang = s.tags.as_ref().and_then(|t| t.language.clone())
                .map(|l| l.to_lowercase())
                .filter(|l| l != "und" && !l.is_empty());
            SubtitleTrack {
                codec: s.codec_name.clone().unwrap_or_default(),
                language: lang,
                is_default: s.disposition.default == 1,
                is_forced: s.disposition.forced == 1,
            }
        })
        .collect();

    // ── Format / duration ─────────────────────────────────────────────────────
    let duration_secs = probe.format.as_ref()
        .and_then(|f| f.duration.as_ref())
        .and_then(|d| d.parse::<f64>().ok());

    let format = probe.format.as_ref()
        .and_then(|f| f.format_name.clone())
        .map(|f| f.split(',').next().unwrap_or(&f).to_string());

    let size_from_probe = probe.format.as_ref()
        .and_then(|f| f.size.as_ref())
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0);

    let size_bytes = if size_from_probe > 0 { size_from_probe } else { file_size };

    Ok(LocalMediaInfo {
        resolution,
        width,
        height,
        codec,
        video_bitrate_kbps,
        audio_tracks,
        languages,
        hdr,
        duration_secs,
        size_bytes,
        format,
        subtitle_tracks,
    })
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/// Classify resolution from ffprobe width/height.
///
/// Width is the primary signal because it is stable across:
/// - Dolby Vision profile 8 (height can be 2076 instead of 2160)
/// - Scope/anamorphic crops (height is cropped but width stays at 3840/1920/1280)
///
/// Thresholds (width-first):
///   >=3200  → 4K   (covers 3840, 4096 and any DV variant)
///   >=1800  → 1080p (covers 1920)
///   >=1100  → 720p  (covers 1280)
///   >=600   → 480p  (covers 720/854)
///
/// Height-only fallback (width unavailable):
///   >=2000  → 4K   (safely above 1080p territory)
///   >=1000  → 1080p
///   >=650   → 720p
///   >=430   → 480p
fn dims_to_resolution(width: Option<u32>, height: Option<u32>) -> Option<String> {
    match (width, height) {
        (Some(w), _) if w >= 3200 => Some("2160p".to_string()),
        (Some(w), _) if w >= 1800 => Some("1080p".to_string()),
        (Some(w), _) if w >= 1100 => Some("720p".to_string()),
        (Some(w), _) if w >= 600  => Some("480p".to_string()),
        (Some(_), _)              => None,
        // Width unavailable — use height with conservative thresholds
        (None, Some(h)) if h >= 2000 => Some("2160p".to_string()),
        (None, Some(h)) if h >= 1000 => Some("1080p".to_string()),
        (None, Some(h)) if h >= 650  => Some("720p".to_string()),
        (None, Some(h)) if h >= 430  => Some("480p".to_string()),
        (None, Some(h))              => Some(format!("{}p", h)),
        (None, None)                 => None,
    }
}

/// Extract a resolution label from keywords in the file path / filename.
/// Used as a fallback when ffprobe cannot determine actual dimensions.
fn resolution_from_path(path: &str) -> Option<String> {
    let name = std::path::Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(path)
        .to_uppercase();
    if name.contains("2160P") || name.contains("4K") || name.contains("UHD") {
        Some("2160p".to_string())
    } else if name.contains("1080P") || name.contains("1080I") {
        Some("1080p".to_string())
    } else if name.contains("720P") {
        Some("720p".to_string())
    } else if name.contains("480P") {
        Some("480p".to_string())
    } else {
        None
    }
}

fn normalize_codec(codec: &str) -> String {
    match codec.to_lowercase().as_str() {
        "hevc"                    => "HEVC".to_string(),
        "h264"                    => "AVC".to_string(),
        "av1"                     => "AV1".to_string(),
        "vp9"                     => "VP9".to_string(),
        "mpeg2video" | "mpeg2"    => "MPEG2".to_string(),
        "mpeg4"                   => "MPEG4".to_string(),
        other                     => other.to_uppercase(),
    }
}

fn normalize_audio_codec(codec: &str) -> String {
    match codec.to_lowercase().as_str() {
        "aac"            => "AAC".to_string(),
        "mp3"            => "MP3".to_string(),
        "ac3"            => "AC3".to_string(),
        "eac3"           => "EAC3".to_string(),
        "dts"            => "DTS".to_string(),  // profile check done at call site
        "truehd" | "mlp" => "TrueHD".to_string(), // Atmos check done at call site
        "flac"           => "FLAC".to_string(),
        "opus"           => "Opus".to_string(),
        "vorbis"         => "Vorbis".to_string(),
        "wmav2" | "wmapro" | "wmalossless" => "WMA".to_string(),
        other            => other.to_uppercase(),
    }
}

fn detect_hdr(stream: &FfprobeStream) -> Option<String> {
    let transfer = stream.color_transfer.as_deref().unwrap_or("");
    let primaries = stream.color_primaries.as_deref().unwrap_or("");

    if transfer == "smpte2084" {
        return Some("HDR10".to_string());
    }
    if transfer == "arib-std-b67" {
        return Some("HLG".to_string());
    }
    if primaries == "bt2020" {
        return Some("HDR".to_string());
    }
    None
}
