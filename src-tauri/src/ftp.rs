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

/// Delete a single file on the FTP server at `remote_dir/filename`.
pub async fn delete_file(
    host: &str,
    port: u16,
    user: &str,
    pass: &str,
    remote_dir: &str,
    filename: &str,
) -> Result<(), String> {
    let mut ftp = connect(host, port, user, pass).await?;
    let full_path = format!("{}/{}", remote_dir.trim_end_matches('/'), filename);
    ftp.rm(&full_path)
        .await
        .map_err(|e| format!("DELE {full_path}: {}", clean_ftp_error(e)))?;
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

/// List a subdirectory relative to a parent path without CWD-ing into the
/// subdirectory. This avoids FTP CWD failures when the subdir name contains
/// non-ASCII characters that may be mangled by the UTF-8 conversion of the
/// LIST response (e.g. Latin-1 "Temporadas en emisión" ó → replacement char).
///
/// Strategy: CWD to `parent_path` (parent is usually ASCII-safe), then send
/// `LIST subdir` as a relative path argument so the server uses its native
/// path without us re-encoding the accented characters.
pub async fn list_raw_sub(
    host: &str,
    port: u16,
    user: &str,
    pass: &str,
    parent_path: &str,
    subdir: &str,
) -> Result<Vec<String>, String> {
    let mut ftp = connect(host, port, user, pass).await?;
    ftp.cwd(parent_path).await.map_err(|e| format!("CWD {parent_path}: {e}"))?;
    // Pass subdir as the LIST argument — avoids a second CWD with a potentially
    // broken UTF-8 string derived from a Latin-1 FTP response.
    let entries = ftp.list(Some(subdir)).await.map_err(|e| e.to_string())?;
    ftp.quit().await.ok();
    Ok(entries)
}

/// Crawl `root` using a pool of N concurrent FTP connections draining a shared
/// work queue (breadth-first parallel scan).
///
/// Unlike the old approach (one connection per top-level branch, sequential
/// within), every discovered sub-directory is pushed back to the shared queue,
/// so all N workers stay busy at every depth level.  This gives an O(N× depth)
/// speed-up on wide server libraries.
pub async fn list_files(
    host: &str,
    port: u16,
    user: &str,
    pass: &str,
    root: &str,
    on_log: Arc<dyn Fn(String) + Send + Sync>,
) -> Result<Vec<FtpFile>, String> {
    const MAX_WORKERS: usize = 8;

    // Seed: one shallow scan of root to populate the initial queue.
    on_log(format!("Connected — discovering root entries in {root}"));
    let mut root_ftp = connect(host, port, user, pass).await?;
    root_ftp.cwd(root).await.map_err(|e| format!("CWD {root}: {e}"))?;
    let root_entries = root_ftp.list(None).await.map_err(|e| e.to_string())?;
    root_ftp.quit().await.ok();

    let (top_dirs, root_files) = parse_entries(&root_entries, root);
    on_log(format!(
        "Found {} top-level entries — launching {} workers",
        top_dirs.len(),
        MAX_WORKERS,
    ));

    // Shared state across workers.
    let queue: Arc<tokio::sync::Mutex<std::collections::VecDeque<String>>> =
        Arc::new(tokio::sync::Mutex::new(top_dirs.into()));
    let all_files: Arc<tokio::sync::Mutex<Vec<FtpFile>>> =
        Arc::new(tokio::sync::Mutex::new(root_files));
    // Number of workers currently holding an item from the queue.
    // When queue is empty AND busy == 0, the crawl is complete.
    let busy = Arc::new(std::sync::atomic::AtomicUsize::new(0));

    let mut handles = vec![];

    for _ in 0..MAX_WORKERS {
        let queue = queue.clone();
        let all_files = all_files.clone();
        let busy = busy.clone();
        let log = on_log.clone();
        let host = host.to_string();
        let user = user.to_string();
        let pass = pass.to_string();

        handles.push(tokio::spawn(async move {
            // Each worker opens and reuses its own FTP connection.
            let mut ftp = match connect(&host, port, &user, &pass).await {
                Ok(f) => f,
                Err(e) => {
                    log(format!("⚠ Worker failed to connect: {e}"));
                    return;
                }
            };

            loop {
                // Pop a directory from the queue, incrementing busy *before*
                // releasing the lock so the "done" check is race-free.
                let dir = {
                    let mut q = queue.lock().await;
                    let item = q.pop_front();
                    if item.is_some() {
                        busy.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    }
                    item
                };

                let dir = match dir {
                    Some(d) => d,
                    None => {
                        // Queue is empty. If no other worker is busy, all
                        // directories have been processed — we're done.
                        if busy.load(std::sync::atomic::Ordering::SeqCst) == 0 {
                            break;
                        }
                        // Another worker is still active and may push more dirs.
                        tokio::time::sleep(tokio::time::Duration::from_millis(5)).await;
                        continue;
                    }
                };

                // CWD + LIST this directory.
                match list_one_dir(&mut ftp, &dir).await {
                    Ok((sub_dirs, mut files)) => {
                        // MDTM fallback for files whose date LIST couldn't parse.
                        // We're still CWD'd in `dir` so filename-only MDTM works.
                        for file in &mut files {
                            if file.modified_at.is_none() {
                                if let Ok(naive) = ftp.mdtm(&file.filename).await {
                                    let dt = DateTime::<Utc>::from_naive_utc_and_offset(naive, Utc);
                                    file.modified_at = Some(normalize_ftp_modified(dt).to_rfc3339());
                                }
                            }
                        }

                        if !files.is_empty() {
                            log(format!("🎬 {} file(s) in {}", files.len(), dir));
                        }

                        // Push subdirectories back to the shared queue.
                        if !sub_dirs.is_empty() {
                            let mut q = queue.lock().await;
                            for d in sub_dirs {
                                q.push_back(d);
                            }
                        }

                        all_files.lock().await.extend(files);
                    }
                    Err(e) => log(format!("⚠ {e}")),
                }

                busy.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
            }

            ftp.quit().await.ok();
        }));
    }

    for handle in handles {
        handle.await.ok();
    }

    let result = Arc::try_unwrap(all_files)
        .map_err(|_| "Internal error: Arc still shared after crawl".to_string())?
        .into_inner();

    if result.is_empty() {
        return Err("FTP crawl returned 0 media files. Check your Root Path setting.".into());
    }

    on_log(format!("Crawl complete — {} media files found", result.len()));
    Ok(result)
}

/// CWD into `path` then LIST it, returning (subdirectories, media files).
async fn list_one_dir(
    ftp: &mut AsyncFtpStream,
    path: &str,
) -> Result<(Vec<String>, Vec<FtpFile>), String> {
    ftp.cwd(path).await.map_err(|e| format!("CWD {path}: {e}"))?;
    let raw = ftp.list(None).await.map_err(|e| format!("LIST in {path}: {e}"))?;
    Ok(parse_entries(&raw, path))
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

/// Upload a local file to the FTP server at `remote_dir/filename`.
///
/// `remote_dir` is created recursively if it does not exist.
/// `on_progress(bytes_done, bytes_total)` is called periodically; returning
/// `false` cancels the transfer.
pub async fn upload_file(
    host: &str,
    port: u16,
    user: &str,
    pass: &str,
    remote_dir: &str,
    filename: &str,
    local_path: &str,
    on_progress: impl Fn(u64, u64) -> bool,
) -> Result<(), String> {
    let file_size = tokio::fs::metadata(local_path)
        .await
        .map(|m| m.len())
        .unwrap_or(0);

    let mut ftp = connect(host, port, user, pass).await?;
    ftp.transfer_type(FileType::Binary).await.map_err(|e| clean_ftp_error(e))?;

    // Ensure remote directory exists (create each segment, ignore "already exists").
    ensure_remote_dir(&mut ftp, remote_dir).await?;

    // CWD into the target dir.
    ftp.cwd(remote_dir).await.map_err(|e| format!("CWD {remote_dir}: {}", clean_ftp_error(e)))?;

    // Open local file.
    let local_file = tokio::fs::File::open(local_path)
        .await
        .map_err(|e| format!("Cannot open local file: {e}"))?;

    let remote_full = format!("{}/{}", remote_dir.trim_end_matches('/'), filename);

    // Open FTP data stream for writing — progress is reported as bytes are
    // actually written to the socket, so 100% only fires when the transfer is done.
    let mut data_stream = ftp
        .put_with_stream(filename)
        .await
        .map_err(|e| format!("Cannot start upload for {remote_full}: {}", clean_ftp_error(e)))?;

    use futures::io::AsyncWriteExt;
    use tokio::io::AsyncReadExt;
    let mut reader = local_file;
    let mut buf = vec![0u8; 256 * 1024]; // 256 KB chunks
    let mut uploaded: u64 = 0;
    let mut cancelled = false;

    loop {
        let n = reader.read(&mut buf).await.map_err(|e| format!("Read error: {e}"))?;
        if n == 0 {
            break;
        }
        data_stream
            .write_all(&buf[..n])
            .await
            .map_err(|e| format!("Write error for {remote_full}: {e}"))?;
        uploaded += n as u64;
        if !on_progress(uploaded, file_size) {
            cancelled = true;
            break;
        }
    }

    if cancelled {
        drop(data_stream);
        ftp.quit().await.ok();
        return Err("Cancelled".to_string());
    }

    // Flush the data stream and wait for the server's 226 Transfer complete.
    ftp.finalize_put_stream(data_stream)
        .await
        .map_err(|e| format!("Upload failed for {remote_full}: {}", clean_ftp_error(e)))?;

    ftp.quit().await.ok();
    Ok(())
}

/// Recursively ensure that all segments of `path` exist on the FTP server.
/// Ignores "550 directory already exists" type errors (FTP 550 is also returned
/// for other errors, so we attempt MKD and continue regardless).
async fn ensure_remote_dir(ftp: &mut AsyncFtpStream, path: &str) -> Result<(), String> {
    let mut current = String::new();
    for segment in path.split('/') {
        if segment.is_empty() {
            current.push('/');
            continue;
        }
        if current.is_empty() || current == "/" {
            current = format!("/{segment}");
        } else {
            current = format!("{current}/{segment}");
        }
        // Try MKD; ignore error (directory may already exist).
        ftp.mkdir(&current).await.ok();
    }
    Ok(())
}

/// Test whether the FTP user has write permission by attempting to create
/// and immediately remove a temporary directory.
pub async fn check_write_permission(
    host: &str,
    port: u16,
    user: &str,
    pass: &str,
    root: &str,
) -> Result<bool, String> {
    let mut ftp = connect(host, port, user, pass).await?;
    let test_dir = format!("{root}/.oscata-write-test");
    let writable = ftp.mkdir(&test_dir).await.is_ok();
    if writable {
        ftp.rmdir(&test_dir).await.ok();
    }
    ftp.quit().await.ok();
    Ok(writable)
}
