use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioTrack {
    pub codec: String,
    pub language: Option<String>,
    pub channels: Option<u32>,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalMediaInfo {
    pub resolution: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub codec: Option<String>,
    pub audio_tracks: Vec<AudioTrack>,
    pub languages: Vec<String>,
    pub hdr: Option<String>,
    pub duration_secs: Option<f64>,
    pub size_bytes: u64,
    pub format: Option<String>,
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
    width: Option<u32>,
    height: Option<u32>,
    color_transfer: Option<String>,
    color_primaries: Option<String>,
    #[serde(default)]
    disposition: FfprobeDisposition,
    tags: Option<FfprobeTags>,
    channels: Option<u32>,
}

#[derive(Debug, Deserialize, Default)]
struct FfprobeDisposition {
    #[serde(default)]
    default: u8,
    #[serde(default)]
    attached_pic: u8,
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

/// Returns the ffprobe binary path if found in PATH, or None.
pub fn check_ffprobe() -> Option<String> {
    let candidates = if cfg!(target_os = "windows") {
        vec!["ffprobe.exe", "ffprobe"]
    } else {
        vec!["ffprobe"]
    };

    for candidate in candidates {
        if let Ok(output) = std::process::Command::new(candidate)
            .args(["-version"])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output()
        {
            if output.status.success() {
                // Return first line (version string)
                let version = String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .next()
                    .unwrap_or(candidate)
                    .to_string();
                return Some(version);
            }
        }
    }
    None
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
            hdr: None,
            audio_tracks: vec![],
            languages: vec![],
            format: None,
        });
    }

    let file_size = meta.len();

    let output = std::process::Command::new("ffprobe")
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
            AudioTrack {
                codec: s.codec_name.clone().map(|c| normalize_audio_codec(&c)).unwrap_or_default(),
                language: lang,
                channels: s.channels,
                is_default: s.disposition.default == 1,
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
        audio_tracks,
        languages,
        hdr,
        duration_secs,
        size_bytes,
        format,
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
        "hevc" | "h265" | "h.265"          => "HEVC".to_string(),
        "h264" | "avc" | "h.264"           => "AVC".to_string(),
        "av1"                               => "AV1".to_string(),
        "vp9"                               => "VP9".to_string(),
        "mpeg2video" | "mpeg2"              => "MPEG2".to_string(),
        other                               => other.to_uppercase(),
    }
}

fn normalize_audio_codec(codec: &str) -> String {
    match codec.to_lowercase().as_str() {
        "aac"                               => "AAC".to_string(),
        "mp3"                               => "MP3".to_string(),
        "ac3" | "eac3"                      => "AC3".to_string(),
        "dts" | "dts-hd" | "dts_hd"        => "DTS".to_string(),
        "truehd" | "mlp"                    => "TrueHD".to_string(),
        "flac"                              => "FLAC".to_string(),
        "opus"                              => "Opus".to_string(),
        "vorbis"                            => "Vorbis".to_string(),
        other                               => other.to_uppercase(),
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
