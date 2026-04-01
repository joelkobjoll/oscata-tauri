use std::sync::LazyLock;
use regex::Regex;

// ── Static regexes (compiled once at startup) ──────────────────────────────
// Compiling regexes is expensive. All patterns are hoisted to `LazyLock<Regex>`
// statics so they are built exactly once on first use instead of on every call
// to `parse_media_path`.

static WHITESPACE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\s+").expect("valid whitespace regex")
});

static YEAR_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\b(19|20)\d{2}\b").expect("valid year regex")
});

/// Tags that mark the end of the human-readable title portion of a filename.
static TAG_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?ix)\b(2160p|4K|UHD|1080p|1080i|720p|720i|480p|576p|x265|x264|HEVC|AVC|AV1|VP9|
          DTS[-.]?HD|TrueHD|Atmos|DTS|AC3|EAC3|DD\+?|AAC|FLAC|MP3|Opus|
          HDR10\+?|HDR|DV|Dolby\.?Vision|SDR|
          BluRay|BDRip|BRRip|BDMV|REMUX|BDREMUX|
          WEB-DL|WEBRip|WEBDL|WEB|
          HDTV|PDTV|DSR|DVDRip|DVDScr|DVD|CAM|SCREENER|SCR|
          AMZN|NF|DSNP|ATVP|HMAX|PCOK|STAN|HBO|SHO|PMTP|
          PROPER|REPACK|REAL|EXTENDED|THEATRICAL|DC|DIRECTORS\.?CUT|
          DUAL|DUBBED|SUBBED|MULTI|
          ENG|SPA|FRE|GER|ITA|POR|JPN|CHI|KOR|RUS|ARA|LAT|CAT|
          [\[(])\b",
    )
    .expect("valid tag regex")
});

/// Supports S01E01, S01 E01, S01-E01, S01E01-E03, S01E01E02.
/// Also handles S100E01 convention (S[season*100]E[ep]) used by some release groups.
static SE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)\bS(\d{1,3})[\s._-]*E(\d{1,3})(?:\s*[-~]\s*E?(\d{1,3})|[\s._-]*E(\d{1,3}))?\b",
    )
    .expect("valid SE regex")
});

/// Supports 1x01 and 1x01-03 forms.
static X_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(\d{1,2})x(\d{1,3})(?:\s*[-~]\s*(\d{1,3}))?\b").expect("valid Xx regex")
});

/// Season-only: S01 / Season 01 / Temporada 01 (no episode).
static S_ONLY_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(?:S|SEASON[\s._-]*|TEMPORADA[\s._-]*)(\d{1,3})\b")
        .expect("valid season-only regex")
});

/// Episode-only: E01 / EP01 / Episode 01 / Capitulo 01 without season prefix.
static E_ONLY_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)(?:^|\s)(?:E|EP|EPISODE|CAP(?:ITULO)?)[\s._-]?(\d{1,3})(?:\s*[-~]\s*(?:E|EP|EPISODE|CAP(?:ITULO)?)?[\s._-]?(\d{1,3}))?\b",
    )
    .expect("valid episode-only regex")
});

/// Files named as "01 - Title" (used when season is in parent folder).
static LEADING_EP_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^\s*0*(\d{1,3})\b(?:\s*[-._]\s*|\s+)").expect("valid leading episode regex")
});

static RESOLUTION_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(2160p|4K|UHD|1080p|1080i|720p|480p)\b").expect("valid resolution regex")
});

static CODEC_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(x265|h\.?265|x264|h\.?264|HEVC|AVC|AV1|VP9)\b")
        .expect("valid codec regex")
});

static AUDIO_CODEC_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(DTS[-.]?HD|TrueHD|Atmos|DTS|EAC3|AC3|DD\+?|AAC|FLAC)\b")
        .expect("valid audio codec regex")
});

static HDR_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(DV|Dolby\.?Vision|HDR10\+?|HDR)\b").expect("valid HDR regex")
});

/// Season inference patterns for path-based season detection (checked in order).
static SEASON_PATH_RES: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    [
        r"(?i)(?:^|[/\s-])season[\s._-]*(\d{1,2})(?:[/\s-]|$)",
        r"(?i)(?:^|[/\s-])temporada[\s._-]*(\d{1,2})(?:[/\s-]|$)",
        r"(?i)(?:^|[/\s-])s(\d{1,2})(?:[/\s-]|$)",
        r"(?i)\bS(\d{1,3})[\s._-]*E\d{1,3}\b",
        r"(?i)\b(\d{1,2})x\d{1,3}\b",
    ]
    .iter()
    .map(|pat| Regex::new(pat).expect("valid season path regex"))
    .collect()
});

/// Episode inference patterns for path-based episode detection (checked in order).
static EPISODE_PATH_RES: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    [
        r"(?i)\bS\d{1,3}[\s._-]*E(\d{1,3})(?:\s*[-~]\s*E?(\d{1,3})|[\s._-]*E(\d{1,3}))?\b",
        r"(?i)\b\d{1,2}x(\d{1,3})(?:\s*[-~]\s*(\d{1,3}))?\b",
        r"(?i)(?:^|[/\s-])(?:E|EP|EPISODE|CAP(?:ITULO)?)[\s._-]?(\d{1,3})(?:\s*[-~]\s*(?:E|EP|EPISODE|CAP(?:ITULO)?)?[\s._-]?(\d{1,3}))?(?:[/\s-]|$)",
    ]
    .iter()
    .map(|pat| Regex::new(pat).expect("valid episode path regex"))
    .collect()
});

/// Release-type patterns paired with their canonical label (checked in order;
/// more specific patterns come first).
static RELEASE_TYPE_PATTERNS: LazyLock<Vec<(Regex, &'static str)>> = LazyLock::new(|| {
    let specs: &[(&str, &str)] = &[
        (r"(?i)\bBD[-. ]?REMUX\b", "BDREMUX"),
        (r"(?i)\bBDMV\b", "BDMV"),
        (r"(?i)\bBDRip\b", "BDRip"),
        (r"(?i)\bBRRip\b", "BRRip"),
        (r"(?i)\bBluRay\b", "BluRay"),
        (r"(?i)\bREMUX\b", "BDREMUX"),
        (r"(?i)\bWEB[-. ]?DL\b", "WEB-DL"),
        (r"(?i)\bWEBDL\b", "WEB-DL"),
        (r"(?i)\bWEBRip\b", "WEBRip"),
        (r"(?i)\bHDTV\b", "HDTV"),
        (r"(?i)\bPDTV\b", "PDTV"),
        (r"(?i)\bDSR\b", "DSR"),
        (r"(?i)\bDVDRip\b", "DVDRip"),
        (r"(?i)\bDVDScr\b", "DVDScr"),
        (r"(?i)\bDVD\b", "DVD"),
        (r"(?i)\bSCREENER\b", "SCREENER"),
        (r"(?i)\bCAM\b", "CAM"),
    ];
    specs
        .iter()
        .map(|(pat, label)| {
            (
                Regex::new(pat).expect("valid release type regex"),
                *label,
            )
        })
        .collect()
});

// Language-detection statics
static DUAL_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\bDUAL\b").expect("valid DUAL regex"));
static MULTI_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\bMULTI\b").expect("valid MULTI regex"));
static DUBBED_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\bDUBBED\b").expect("valid DUBBED regex"));
static SUBBED_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\bSUBBED\b").expect("valid SUBBED regex"));

/// ISO 639-2 language code patterns paired with their canonical tag.
static ISO_LANG_RES: LazyLock<Vec<(Regex, &'static str)>> = LazyLock::new(|| {
    let specs: &[(&str, &str)] = &[
        (r"(?i)\bENG\b", "ENG"),
        (r"(?i)\bSPA\b", "SPA"),
        (r"(?i)\bLAT\b", "LAT"),
        (r"(?i)\bFRE\b", "FRE"),
        (r"(?i)\bGER\b", "GER"),
        (r"(?i)\bITA\b", "ITA"),
        (r"(?i)\bPOR\b", "POR"),
        (r"(?i)\bJPN\b", "JPN"),
        (r"(?i)\bCHI\b", "CHI"),
        (r"(?i)\bKOR\b", "KOR"),
        (r"(?i)\bRUS\b", "RUS"),
        (r"(?i)\bARA\b", "ARA"),
        (r"(?i)\bCAT\b", "CAT"),
    ];
    specs
        .iter()
        .map(|(pat, code)| (Regex::new(pat).expect("valid ISO lang regex"), *code))
        .collect()
});

// ── Public types ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize)]
pub struct ParsedMedia {
    pub title: String,
    pub year: Option<u16>,
    pub season: Option<u8>,
    pub episode: Option<u8>,
    pub episode_end: Option<u8>, // for multi-episode files like S01E01-E03
    pub resolution: Option<String>,
    pub codec: Option<String>,
    pub audio_codec: Option<String>,
    pub hdr: Option<String>,
    pub languages: Vec<String>,
    pub release_type: Option<String>,  // WEB-DL, BluRay, BDREMUX, etc.
    pub release_group: Option<String>, // scene group name
}

// ── Public API ──────────────────────────────────────────────────────────────

pub fn parse_media_path(ftp_path: &str, filename: &str) -> ParsedMedia {
    parse_with_context((!ftp_path.is_empty()).then_some(ftp_path), filename)
}

// ── Core parsing ────────────────────────────────────────────────────────────

fn parse_with_context(ftp_path: Option<&str>, filename: &str) -> ParsedMedia {
    let without_ext = std::path::Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(filename);

    // Replace dots, underscores and multiple spaces with single space
    let clean = without_ext.replace(['.', '_'], " ");
    let clean = WHITESPACE_RE.replace_all(&clean, " ").to_string();

    let year: Option<u16> = YEAR_RE.find(&clean).and_then(|m| m.as_str().parse().ok());

    let (filename_season, mut episode, mut episode_end, se_start) =
        if let Some(caps) = SE_RE.captures(&clean) {
            let raw_s: u16 = caps[1].parse().unwrap_or(0);
            // Normalize S100→1, S200→2 convention used by some release groups
            let s = if raw_s > 0 && raw_s % 100 == 0 {
                (raw_s / 100) as u8
            } else {
                raw_s as u8
            };
            let e: u8 = caps[2].parse().unwrap_or(0);
            let e_end: Option<u8> = caps
                .get(3)
                .or_else(|| caps.get(4))
                .and_then(|m| m.as_str().parse().ok());
            let start = SE_RE.find(&clean).map(|m| m.start()).unwrap_or(clean.len());
            (Some(s), Some(e), e_end, start)
        } else if let Some(caps) = X_RE.captures(&clean) {
            let s: u8 = caps[1].parse().unwrap_or(0);
            let e: u8 = caps[2].parse().unwrap_or(0);
            let e_end: Option<u8> = caps.get(3).and_then(|m| m.as_str().parse().ok());
            let start = X_RE.find(&clean).map(|m| m.start()).unwrap_or(clean.len());
            (Some(s), Some(e), e_end, start)
        } else if let Some(caps) = S_ONLY_RE.captures(&clean) {
            let raw_s: u16 = caps[1].parse().unwrap_or(0);
            let s = if raw_s > 0 && raw_s % 100 == 0 {
                (raw_s / 100) as u8
            } else {
                raw_s as u8
            };
            let start = S_ONLY_RE.find(&clean).map(|m| m.start()).unwrap_or(clean.len());
            (Some(s), None, None, start)
        } else if let Some(caps) = E_ONLY_RE.captures(&clean) {
            let e: u8 = caps[1].parse().unwrap_or(0);
            let e_end: Option<u8> = caps.get(2).and_then(|m| m.as_str().parse().ok());
            let start = E_ONLY_RE.find(&clean).map(|m| m.start()).unwrap_or(clean.len());
            (None, Some(e), e_end, start)
        } else {
            (None, None, None, clean.len())
        };

    let season = filename_season.or_else(|| ftp_path.and_then(infer_season_from_path));

    if episode.is_none() {
        if let Some(path) = ftp_path {
            if let Some((ep, ep_end)) = infer_episode_from_path(path) {
                episode = Some(ep);
                episode_end = ep_end;
            }
        }

        if episode.is_none() && season.is_some() {
            if let Some(caps) = LEADING_EP_RE.captures(&clean) {
                episode = caps.get(1).and_then(|m| m.as_str().parse::<u8>().ok());
            }
        }
    }

    // Title ends at: year, S##E## marker, or first tech tag — whichever comes first
    let title_end = {
        let year_pos = YEAR_RE.find(&clean).map(|m| m.start()).unwrap_or(clean.len());
        let tag_pos = TAG_RE.find(&clean).map(|m| m.start()).unwrap_or(clean.len());
        year_pos.min(se_start).min(tag_pos)
    };

    let title = clean[..title_end]
        .trim()
        .trim_end_matches(|c: char| !c.is_alphanumeric())
        .trim()
        .to_string();

    let release_type = parse_release_type(&clean);
    let release_group = parse_release_group(without_ext);
    let languages = parse_languages(&clean);

    ParsedMedia {
        title,
        year,
        season,
        episode,
        episode_end,
        resolution: RESOLUTION_RE
            .find(&clean)
            .map(|m| m.as_str().to_uppercase()),
        codec: CODEC_RE.find(&clean).map(|m| m.as_str().to_uppercase()),
        audio_codec: AUDIO_CODEC_RE
            .find(&clean)
            .map(|m| m.as_str().to_uppercase()),
        hdr: HDR_RE.find(&clean).map(|m| m.as_str().to_uppercase()),
        languages,
        release_type,
        release_group,
    }
}

fn infer_season_from_path(ftp_path: &str) -> Option<u8> {
    let path = ftp_path.replace(['.', '_'], " ");
    for re in SEASON_PATH_RES.iter() {
        if let Some(caps) = re.captures(&path) {
            if let Some(raw) = caps.get(1).and_then(|m| m.as_str().parse::<u16>().ok()) {
                let season = if raw > 0 && raw % 100 == 0 {
                    (raw / 100) as u8
                } else {
                    raw as u8
                };
                return Some(season);
            }
        }
    }
    None
}

fn infer_episode_from_path(ftp_path: &str) -> Option<(u8, Option<u8>)> {
    let path = ftp_path.replace(['.', '_'], " ");
    for re in EPISODE_PATH_RES.iter() {
        if let Some(caps) = re.captures(&path) {
            if let Some(ep) = caps.get(1).and_then(|m| m.as_str().parse::<u8>().ok()) {
                let ep_end = caps
                    .get(2)
                    .or_else(|| caps.get(3))
                    .and_then(|m| m.as_str().parse::<u8>().ok());
                return Some((ep, ep_end));
            }
        }
    }
    None
}

fn parse_release_type(clean: &str) -> Option<String> {
    for (re, label) in RELEASE_TYPE_PATTERNS.iter() {
        if re.is_match(clean) {
            return Some(label.to_string());
        }
    }
    None
}

fn parse_release_group(without_ext: &str) -> Option<String> {
    // Scene releases end with -GROUPNAME. Extract the last hyphen-delimited token.
    // Filter out known non-group tokens.
    let non_group: &[&str] = &[
        "mkv", "mp4", "avi", "mov", "DL", "DTS", "AAC", "MA", "HD", "H264", "H265", "x264",
        "x265", "HEVC", "AVC", "WEB", "DL",
    ];
    let last = without_ext.split('-').last()?;
    // Must be 1–12 chars, alphanumeric only
    if last.len() >= 2 && last.len() <= 12 && last.chars().all(|c| c.is_alphanumeric()) {
        if !non_group.iter().any(|&n| n.eq_ignore_ascii_case(last)) {
            return Some(last.to_uppercase());
        }
    }
    None
}

fn parse_languages(clean: &str) -> Vec<String> {
    let mut langs: Vec<String> = Vec::new();

    if DUAL_RE.is_match(clean) {
        langs.push("DUAL".into());
    }
    if MULTI_RE.is_match(clean) {
        langs.push("MULTI".into());
    }
    if DUBBED_RE.is_match(clean) {
        langs.push("DUBBED".into());
    }
    if SUBBED_RE.is_match(clean) {
        langs.push("SUBBED".into());
    }

    for (re, code) in ISO_LANG_RES.iter() {
        if re.is_match(clean) {
            langs.push(code.to_string());
        }
    }

    langs
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Original tests (preserved) ─────────────────────────────────────────

    #[test]
    fn parses_standard_release() {
        let p = parse_media_path("", "The.Batman.2022.2160p.UHD.BluRay.x265.DTS-HD.MA-GROUP.mkv");
        assert_eq!(p.title, "The Batman");
        assert_eq!(p.year, Some(2022));
        assert_eq!(p.resolution.as_deref(), Some("2160P"));
        assert_eq!(p.codec.as_deref(), Some("X265"));
    }

    #[test]
    fn parses_no_year() {
        let p = parse_media_path("", "Interstellar.1080p.x264.mkv");
        assert_eq!(p.title, "Interstellar");
        assert_eq!(p.year, None);
        assert_eq!(p.resolution.as_deref(), Some("1080P"));
        assert_eq!(p.codec.as_deref(), Some("X264"));
    }

    #[test]
    fn parses_h264_codec() {
        let p = parse_media_path("", "Sinners.2025.1080p.H264.mkv");
        assert_eq!(p.codec.as_deref(), Some("H264"));
    }

    #[test]
    fn parses_audio_codec() {
        let p = parse_media_path("", "Dune.2021.2160p.x265.DTS-HD.mkv");
        assert_eq!(p.audio_codec.as_deref(), Some("DTS-HD"));
    }

    #[test]
    fn parses_hdr() {
        let p = parse_media_path("", "Avatar.2009.2160p.HDR10.x265.mkv");
        assert_eq!(p.hdr.as_deref(), Some("HDR10"));
    }

    #[test]
    fn parses_hdtv_no_year() {
        let p = parse_media_path("", "Watson.HDTV.mkv");
        assert_eq!(p.title, "Watson");
        assert_eq!(p.year, None);
    }

    #[test]
    fn parses_tv_show_with_episode() {
        let p = parse_media_path("", "Watson.S01E01.2160p.WEB.DL.mkv");
        assert_eq!(p.title, "Watson");
        assert_eq!(p.season, Some(1));
        assert_eq!(p.episode, Some(1));
    }

    #[test]
    fn parses_tv_show_with_spaced_season_episode_tokens() {
        let p = parse_media_path(
            "",
            "Daredevil Born Again (2025) S02 E01 WEB DL 2160p HDR10 DV.mkv",
        );
        assert_eq!(p.season, Some(2));
        assert_eq!(p.episode, Some(1));
    }

    #[test]
    fn parses_episode_keyword_without_season_in_filename() {
        let p = parse_media_path(
            "/TV/Daredevil Born Again/Season 02/Daredevil Born Again Episode 01 WEB DL 2160p.mkv",
            "Daredevil Born Again Episode 01 WEB DL 2160p.mkv",
        );
        assert_eq!(p.season, Some(2));
        assert_eq!(p.episode, Some(1));
    }

    #[test]
    fn parses_leading_episode_when_season_is_in_folder() {
        let p = parse_media_path(
            "/TV/Daredevil Born Again/Season 02/01 - Heaven's Half Hour.mkv",
            "01 - Heaven's Half Hour.mkv",
        );
        assert_eq!(p.season, Some(2));
        assert_eq!(p.episode, Some(1));
    }

    #[test]
    fn infers_season_from_folder_when_filename_lacks_it() {
        let p = parse_media_path(
            "/TV/Watson/Season 02/Watson.2160p.WEB-DL.x265-GROUP.mkv",
            "Watson.2160p.WEB-DL.x265-GROUP.mkv",
        );
        assert_eq!(p.season, Some(2));
    }

    #[test]
    fn infers_season_from_s_folder_name() {
        let p = parse_media_path(
            "/TV/Daredevil Born Again (2025) S02 WEB DL 2160p HDR DV/Daredevil Born Again (2025) WEB DL 2160p HDR DV.mkv",
            "Daredevil Born Again (2025) WEB DL 2160p HDR DV.mkv",
        );
        assert_eq!(p.season, Some(2));
        assert_eq!(p.episode, None);
    }

    #[test]
    fn parses_streaming_source() {
        let p = parse_media_path("", "Como.cabras.2026.WEB.DL.2160p.HDR10.DV.mkv");
        assert_eq!(p.title, "Como cabras");
        assert_eq!(p.year, Some(2026));
    }

    #[test]
    fn parses_s100_convention_as_season_1_episode_1() {
        // Some release groups use S[season*100]E[ep]: S100E01 = Season 1, Episode 1
        let p = parse_media_path("", "Helluva Boss_S100E01_La familia asesina.mkv");
        assert_eq!(p.season, Some(1));
        assert_eq!(p.episode, Some(1));
    }

    #[test]
    fn parses_s200_convention_as_season_2_episode_8() {
        let p = parse_media_path("", "ShowName_S200E08_Title.mkv");
        assert_eq!(p.season, Some(2));
        assert_eq!(p.episode, Some(8));
    }

    #[test]
    fn does_not_normalize_normal_two_digit_season() {
        // S10E05 must NOT be treated as season 0 (10 % 100 != 0)
        let p = parse_media_path("", "Doctor.Who.S10E05.1080p.mkv");
        assert_eq!(p.season, Some(10));
        assert_eq!(p.episode, Some(5));
    }

    // ── Fix 1: LazyLock regex static tests ────────────────────────────────
    // These confirm that hoisting regex compilation to statics does not change
    // parse results for key patterns.

    #[test]
    fn static_regex_movie_with_year_and_1080p() {
        // Verifies YEAR_RE, TAG_RE, RESOLUTION_RE statics all fire correctly.
        let p = parse_media_path(
            "",
            "The.Dark.Knight.2008.1080p.BluRay.x264-GROUP.mkv",
        );
        assert_eq!(p.title, "The Dark Knight");
        assert_eq!(p.year, Some(2008));
        assert_eq!(p.resolution.as_deref(), Some("1080P"));
        assert_eq!(p.codec.as_deref(), Some("X264"));
        assert_eq!(p.release_type.as_deref(), Some("BluRay"));
        assert_eq!(p.release_group.as_deref(), Some("GROUP"));
    }

    #[test]
    fn static_regex_tv_s03e07_720p() {
        // Verifies SE_RE and RESOLUTION_RE statics.
        let p = parse_media_path("", "Breaking.Bad.S03E07.720p.WEB-DL.mkv");
        assert_eq!(p.title, "Breaking Bad");
        assert_eq!(p.season, Some(3));
        assert_eq!(p.episode, Some(7));
        assert_eq!(p.resolution.as_deref(), Some("720P"));
        assert_eq!(p.release_type.as_deref(), Some("WEB-DL"));
    }

    #[test]
    fn static_regex_4k_uhd_hdr_dolby_vision() {
        // Verifies TAG_RE, RESOLUTION_RE, HDR_RE statics with UHD/DV content.
        let p = parse_media_path(
            "",
            "Inception.2010.2160p.UHD.BluRay.DV.HDR10.DTS-HD.MA-REMUX.mkv",
        );
        assert_eq!(p.title, "Inception");
        assert_eq!(p.year, Some(2010));
        assert_eq!(p.resolution.as_deref(), Some("2160P"));
        // DV comes before HDR10 in this filename; HDR_RE should match DV
        assert_eq!(p.hdr.as_deref(), Some("DV"));
        assert_eq!(p.audio_codec.as_deref(), Some("DTS-HD"));
    }

    #[test]
    fn static_regex_dual_language_and_iso_codes() {
        // Verifies DUAL_RE and ISO_LANG_RES statics.
        let p = parse_media_path(
            "",
            "Spider-Man.2002.1080p.BluRay.DUAL.ENG.SPA.x264.mkv",
        );
        assert!(p.languages.contains(&"DUAL".to_string()));
        assert!(p.languages.contains(&"ENG".to_string()));
        assert!(p.languages.contains(&"SPA".to_string()));
    }

    #[test]
    fn static_regex_multi_episode_range() {
        // Verifies SE_RE episode_end capture group.
        let p = parse_media_path("", "Show.S02E01-E03.1080p.mkv");
        assert_eq!(p.season, Some(2));
        assert_eq!(p.episode, Some(1));
        assert_eq!(p.episode_end, Some(3));
    }

    #[test]
    fn static_regex_release_type_webdl_vs_webrip() {
        let webdl = parse_media_path("", "Movie.2023.1080p.WEB-DL.x265.mkv");
        assert_eq!(webdl.release_type.as_deref(), Some("WEB-DL"));

        let webrip = parse_media_path("", "Movie.2023.1080p.WEBRip.x265.mkv");
        assert_eq!(webrip.release_type.as_deref(), Some("WEBRip"));
    }

    #[test]
    fn static_regex_bdremux_takes_priority_over_remux() {
        // "BD REMUX" must be classified as BDREMUX, not the generic REMUX→BDREMUX fallback.
        let p = parse_media_path("", "Film.2020.2160p.BD.REMUX.x265.mkv");
        assert_eq!(p.release_type.as_deref(), Some("BDREMUX"));
    }

    #[test]
    fn static_regex_atmos_audio_codec() {
        // Verifies AUDIO_CODEC_RE picks up TrueHD Atmos (first match wins).
        let p = parse_media_path("", "Movie.2022.2160p.TrueHD.Atmos.x265.mkv");
        assert_eq!(p.audio_codec.as_deref(), Some("TRUEHD"));
    }
}
