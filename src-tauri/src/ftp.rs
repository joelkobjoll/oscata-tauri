use std::sync::Arc;
use suppaftp::AsyncFtpStream;
use futures::io::AsyncReadExt;
use tokio::io::AsyncWriteExt;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FtpFile {
    pub path: String,
    pub size: u64,
    pub filename: String,
}

const MEDIA_EXTENSIONS: &[&str] = &["mkv", "mp4", "avi", "m2ts", "mov", "ts"];

pub async fn test_connection(
    host: &str,
    port: u16,
    user: &str,
    pass: &str,
) -> Result<(), String> {
    let addr = format!("{host}:{port}");
    let mut ftp = AsyncFtpStream::connect(&addr)
        .await
        .map_err(|e| format!("Cannot connect to {addr}: {e}"))?;
    ftp.login(user, pass)
        .await
        .map_err(|e| format!("Login failed: {e}"))?;
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
    let mut ftp = AsyncFtpStream::connect(format!("{host}:{port}"))
        .await
        .map_err(|e| e.to_string())?;
    ftp.login(user, pass).await.map_err(|e| e.to_string())?;
    ftp.cwd(path).await.map_err(|e| format!("CWD {path}: {e}"))?;
    let entries = ftp.list(None).await.map_err(|e| e.to_string())?;
    ftp.quit().await.ok();
    Ok(entries)
}

pub async fn list_files(
    host: &str,
    port: u16,
    user: &str,
    pass: &str,
    root: &str,
    on_log: Arc<dyn Fn(String) + Send + Sync>,
) -> Result<Vec<FtpFile>, String> {
    let mut ftp = AsyncFtpStream::connect(format!("{host}:{port}"))
        .await
        .map_err(|e| e.to_string())?;
    ftp.login(user, pass).await.map_err(|e| e.to_string())?;
    on_log(format!("Connected — starting crawl from {root}"));

    let mut errors: Vec<String> = vec![];
    let files = crawl(&mut ftp, root, &mut errors, on_log.clone()).await?;
    ftp.quit().await.ok();

    if files.is_empty() && !errors.is_empty() {
        return Err(format!(
            "FTP crawl returned 0 media files. Errors encountered:\n{}",
            errors.join("\n")
        ));
    }

    on_log(format!("Crawl complete — {} media files found", files.len()));
    Ok(files)
}

fn crawl<'a>(
    ftp: &'a mut AsyncFtpStream,
    path: &'a str,
    errors: &'a mut Vec<String>,
    on_log: Arc<dyn Fn(String) + Send + Sync>,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Vec<FtpFile>, String>> + Send + 'a>> {
    Box::pin(async move {
        let mut results = vec![];

        on_log(format!("📂 Scanning {path}"));

        if let Err(e) = ftp.cwd(path).await {
            errors.push(format!("CWD {path}: {e}"));
            return Ok(results);
        }

        let entries = match ftp.list(None).await {
            Ok(e) => e,
            Err(e) => {
                errors.push(format!("LIST in {path}: {e}"));
                return Ok(results);
            }
        };

        for entry in entries {
            let entry = entry.trim().to_string();
            if entry.is_empty() {
                continue;
            }

            let parts: Vec<&str> = entry.split_whitespace().collect();

            let (is_dir, name_start, size) = if parts.len() >= 9
                && (parts[0].starts_with('-')
                    || parts[0].starts_with('d')
                    || parts[0].starts_with('l'))
            {
                let is_dir = parts[0].starts_with('d');
                let size: u64 = parts[4].parse().unwrap_or(0);
                (is_dir, 8usize, size)
            } else if parts.len() >= 4 && parts[0].contains('-') && parts[1].contains(':') {
                let is_dir = parts[2].eq_ignore_ascii_case("<DIR>");
                let size: u64 = if is_dir { 0 } else { parts[2].parse().unwrap_or(0) };
                (is_dir, 3usize, size)
            } else {
                continue;
            };

            if name_start >= parts.len() {
                continue;
            }
            let name = parts[name_start..].join(" ");
            let name = name.trim().to_string();
            if name == "." || name == ".." || name.is_empty() {
                continue;
            }

            let child_path = format!("{}/{}", path.trim_end_matches('/'), name);

            if is_dir {
                let mut sub = crawl(ftp, &child_path, errors, on_log.clone()).await?;
                results.append(&mut sub);
            } else {
                let ext = std::path::Path::new(&name)
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                if MEDIA_EXTENSIONS.contains(&ext.as_str()) {
                    on_log(format!("🎬 Found: {name}"));
                    results.push(FtpFile {
                        path: child_path,
                        size,
                        filename: name,
                    });
                }
            }
        }

        Ok(results)
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
        ftp.resume_transfer(existing_size as usize)
            .await
            .map_err(|e| e.to_string())?;
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
        file.write_all(&buf[..n])
            .await
            .map_err(|e| e.to_string())?;
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
    Ok(())
}
