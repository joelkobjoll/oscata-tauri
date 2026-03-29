use std::sync::Arc;
use suppaftp::AsyncFtpStream;
use suppaftp::types::FileType;
use futures::io::AsyncReadExt;
use tokio::io::AsyncWriteExt;
use chrono::{DateTime, Datelike, NaiveDate, NaiveDateTime, Utc};

/// suppaftp formats addresses with backtick+quote: `"host:port"` — strip that.
fn clean_ftp_error(e: impl std::fmt::Display) -> String {
    e.to_string().replace("`\"", "").replace("\"`", "")
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FtpFile {
    pub path: String,
    pub size: u64,
    pub filename: String,
    pub modified_at: Option<String>,
}

const MEDIA_EXTENSIONS: &[&str] = &["mkv", "mp4", "avi", "m2ts", "mov", "ts"];

/// Open a fresh authenticated FTP connection.
async fn connect(host: &str, port: u16, user: &str, pass: &str) -> Result<AsyncFtpStream, String> {
    let mut ftp = AsyncFtpStream::connect(format!("{host}:{port}"))
        .await
        .map_err(|e| clean_ftp_error(e))?;
    ftp.login(user, pass).await.map_err(|e| clean_ftp_error(e))?;
    Ok(ftp)
}

/// Parse raw FTP LIST lines into (is_dir, name, size) tuples.
fn parse_entries(raw: &[String], parent_path: &str) -> (Vec<String>, Vec<FtpFile>) {
    let mut dirs = vec![];
    let mut files = vec![];
    for entry in raw {
        let entry = entry.trim().to_string();
        if entry.is_empty() { continue; }
        let parts: Vec<&str> = entry.split_whitespace().collect();
        let (is_dir, name_start, size, modified_at) = if parts.len() >= 9
            && (parts[0].starts_with('-') || parts[0].starts_with('d') || parts[0].starts_with('l'))
        {
            let is_dir = parts[0].starts_with('d');
            let size: u64 = parts[4].parse().unwrap_or(0);
            (
                is_dir,
                8usize,
                size,
                parse_unix_list_modified(&parts),
            )
        } else if parts.len() >= 4 && parts[0].contains('-') && parts[1].contains(':') {
            let is_dir = parts[2].eq_ignore_ascii_case("<DIR>");
            let size: u64 = if is_dir { 0 } else { parts[2].parse().unwrap_or(0) };
            (
                is_dir,
                3usize,
                size,
                parse_windows_list_modified(&parts),
            )
        } else {
            continue;
        };
        if name_start >= parts.len() { continue; }
        let name = parts[name_start..].join(" ");
        let name = name.trim().to_string();
        if name == "." || name == ".." || name.is_empty() { continue; }
        let child_path = format!("{}/{}", parent_path.trim_end_matches('/'), name);
        if is_dir {
            dirs.push(child_path);
        } else {
            let ext = std::path::Path::new(&name)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();
            if MEDIA_EXTENSIONS.contains(&ext.as_str()) {
                files.push(FtpFile {
                    path: child_path,
                    size,
                    filename: name,
                    modified_at: modified_at.map(|value| value.to_rfc3339()),
                });
            }
        }
    }
    (dirs, files)
}

fn normalize_ftp_modified(dt: DateTime<Utc>) -> DateTime<Utc> {
    let now = Utc::now();
    if dt > now + chrono::Duration::days(1) {
        if let Some(one_year_back) = dt.with_year(dt.year() - 1) {
            return one_year_back;
        }
        return dt - chrono::Duration::days(365);
    }
    dt
}

fn parse_unix_list_modified(parts: &[&str]) -> Option<DateTime<Utc>> {
    if parts.len() < 8 {
        return None;
    }

    let month = parts[5];
    let day = parts[6];
    let year_or_time = parts[7];
    let now = Utc::now();

    let naive = if year_or_time.contains(':') {
        NaiveDateTime::parse_from_str(
            &format!("{month} {day} {} {year_or_time}", now.year()),
            "%b %e %Y %H:%M",
        )
        .ok()
    } else {
        NaiveDate::parse_from_str(
            &format!("{month} {day} {year_or_time}"),
            "%b %e %Y",
        )
        .ok()
        .and_then(|date| date.and_hms_opt(0, 0, 0))
    }?;

    Some(normalize_ftp_modified(DateTime::<Utc>::from_naive_utc_and_offset(
        naive,
        Utc,
    )))
}

fn parse_windows_list_modified(parts: &[&str]) -> Option<DateTime<Utc>> {
    if parts.len() < 2 {
        return None;
    }

    let raw = format!("{} {}", parts[0], parts[1]);
    let naive = NaiveDateTime::parse_from_str(&raw, "%m-%d-%y %I:%M%p")
        .or_else(|_| NaiveDateTime::parse_from_str(&raw, "%m-%d-%Y %I:%M%p"))
        .or_else(|_| NaiveDateTime::parse_from_str(&raw, "%m-%d-%y %H:%M"))
        .or_else(|_| NaiveDateTime::parse_from_str(&raw, "%m-%d-%Y %H:%M"))
        .ok()?;

    Some(normalize_ftp_modified(DateTime::<Utc>::from_naive_utc_and_offset(
        naive,
        Utc,
    )))
}

pub async fn test_connection(
    host: &str,
    port: u16,
    user: &str,
    pass: &str,
) -> Result<(), String> {
    let addr = format!("{host}:{port}");
    let mut ftp = AsyncFtpStream::connect(&addr)
        .await
        .map_err(|e| format!("Cannot connect to {addr}: {}", clean_ftp_error(e)))?;
    ftp.login(user, pass)
        .await
        .map_err(|e| format!("Login failed: {}", clean_ftp_error(e)))?;
    ftp.quit().await.ok();
    Ok(())
}

pub async fn list_raw(
    host: &str,
    port: u16,
    user: &str,
    pass: &str,
    path: &str,
) -> Result<Vec<String>, String> {
    let mut ftp = connect(host, port, user, pass).await?;
    ftp.cwd(path).await.map_err(|e| format!("CWD {path}: {e}"))?;
    let entries = ftp.list(None).await.map_err(|e| e.to_string())?;
    ftp.quit().await.ok();
    Ok(entries)
}

/// Crawl `root` using up to `parallelism` concurrent FTP connections.
///
/// Strategy:
///   1. One connection does a shallow LIST of `root` to discover top-level branches.
///   2. Each branch gets its own dedicated FTP connection that recursively crawls
///      just that subtree — in parallel.
///   3. Files found directly in `root` (rare) are collected on the initial connection.
///
/// This mirrors rclone's approach and gives a ~N× speedup where N = branch count,
/// capped at `parallelism`.
pub async fn list_files(
    host: &str,
    port: u16,
    user: &str,
    pass: &str,
    root: &str,
    on_log: Arc<dyn Fn(String) + Send + Sync>,
) -> Result<Vec<FtpFile>, String> {
    // Step 1: shallow scan of root to discover top-level branches.
    on_log(format!("Connected — discovering branches in {root}"));
    let mut root_ftp = connect(host, port, user, pass).await?;
    root_ftp.cwd(root).await.map_err(|e| format!("CWD {root}: {e}"))?;
    let root_entries = root_ftp.list(None).await.map_err(|e| e.to_string())?;
    root_ftp.quit().await.ok();

    let (top_dirs, mut root_files) = parse_entries(&root_entries, root);
    on_log(format!("Found {} top-level branches — crawling in parallel", top_dirs.len()));

    // Step 2: crawl each branch in its own connection, bounded by a semaphore.
    const MAX_PARALLEL: usize = 6;
    let sem = Arc::new(tokio::sync::Semaphore::new(MAX_PARALLEL));
    let mut handles = vec![];

    for branch in top_dirs {
        let sem = sem.clone();
        let log = on_log.clone();
        let host = host.to_string();
        let user = user.to_string();
        let pass = pass.to_string();

        let handle = tokio::spawn(async move {
            let _permit = sem.acquire().await.ok();
            log(format!("📂 Crawling branch: {branch}"));
            let mut ftp = match connect(&host, port, &user, &pass).await {
                Ok(f) => f,
                Err(e) => {
                    log(format!("⚠ Could not open connection for {branch}: {e}"));
                    return vec![];
                }
            };
            let mut errors = vec![];
            let files = crawl_sequential(&mut ftp, &branch, &mut errors, log.clone()).await;
            ftp.quit().await.ok();
            for e in errors {
                log(format!("⚠ {e}"));
            }
            files
        });
        handles.push(handle);
    }

    for handle in handles {
        if let Ok(branch_files) = handle.await {
            root_files.extend(branch_files);
        }
    }

    if root_files.is_empty() {
        return Err("FTP crawl returned 0 media files. Check your Root Path setting.".into());
    }

    on_log(format!("Crawl complete — {} media files found", root_files.len()));
    Ok(root_files)
}

/// Single-connection recursive crawl used per-branch by `list_files`.
fn crawl_sequential<'a>(
    ftp: &'a mut AsyncFtpStream,
    path: &'a str,
    errors: &'a mut Vec<String>,
    on_log: Arc<dyn Fn(String) + Send + Sync>,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Vec<FtpFile>> + Send + 'a>> {
    Box::pin(async move {
        if let Err(e) = ftp.cwd(path).await {
            errors.push(format!("CWD {path}: {e}"));
            return vec![];
        }
        let raw = match ftp.list(None).await {
            Ok(e) => e,
            Err(e) => {
                errors.push(format!("LIST in {path}: {e}"));
                return vec![];
            }
        };
        let (sub_dirs, mut files) = parse_entries(&raw, path);
        for f in &files {
            on_log(format!("🎬 Found: {}", f.filename));
        }
        for sub in sub_dirs {
            let mut sub_files = crawl_sequential(ftp, &sub, errors, on_log.clone()).await;
            files.append(&mut sub_files);
        }
        files
    })
}

pub async fn download_file(
    host: &str,
    port: u16,
    user: &str,
    pass: &str,
    remote_path: &str,
    local_path: &str,
    on_progress: impl Fn(u64, u64) -> bool,
) -> Result<(), String> {
    let mut ftp = AsyncFtpStream::connect(format!("{host}:{port}"))
        .await
        .map_err(|e| e.to_string())?;
    ftp.login(user, pass).await.map_err(|e| e.to_string())?;
    ftp.transfer_type(FileType::Binary)
        .await
        .map_err(|e| e.to_string())?;

    let size = ftp.size(remote_path).await.unwrap_or(0) as u64;
    let existing_size = tokio::fs::metadata(local_path)
        .await
        .map(|meta| meta.len())
        .unwrap_or(0);

    if size > 0 && existing_size >= size {
        ftp.quit().await.ok();
        return Ok(());
    }

    if existing_size > 0 {
        if let Err(_) = ftp.resume_transfer(existing_size as usize).await {
            tokio::fs::remove_file(local_path).await.ok();
            ftp.transfer_type(FileType::Binary)
                .await
                .map_err(|e| e.to_string())?;
            return Err("Resume failed and partial file was removed. Download will restart on retry.".to_string());
        }
    }

    let mut reader = Box::pin(
        ftp.retr_as_stream(remote_path)
            .await
            .map_err(|e| e.to_string())?,
    );
    let mut file = if existing_size > 0 {
        tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(local_path)
            .await
            .map_err(|e| e.to_string())?
    } else {
        tokio::fs::File::create(local_path)
            .await
            .map_err(|e| e.to_string())?
    };
    let mut downloaded = existing_size;
    let mut buf = vec![0u8; 65536];
    let mut cancelled = false;

    if downloaded > 0 && !on_progress(downloaded, size) {
        cancelled = true;
    }

    while !cancelled {
        let n = reader.read(&mut buf).await.map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        if let Err(e) = file.write_all(&buf[..n]).await {
            drop(file);
            tokio::fs::remove_file(local_path).await.ok();
            return Err(format!("Write error: {e}"));
        }
        downloaded += n as u64;
        if !on_progress(downloaded, size) {
            cancelled = true;
            break;
        }
    }

    drop(reader);
    ftp.quit().await.ok();

    if cancelled {
        tokio::fs::remove_file(local_path).await.ok();
        return Err("Cancelled".to_string());
    }

    // If the server reported a size and we didn't receive all of it, the stream
    // ended prematurely (connection drop, timeout, etc.). Remove the incomplete
    // file so the next retry starts fresh rather than showing it as Done.
    if size > 0 && downloaded < size {
        tokio::fs::remove_file(local_path).await.ok();
        return Err(format!(
            "Download incomplete: received {} of {} bytes. Will retry automatically.",
            downloaded, size
        ));
    }

    Ok(())
}
