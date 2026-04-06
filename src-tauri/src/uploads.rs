use std::sync::{Arc, Mutex};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum UploadStatus {
    Queued,
    Uploading,
    Done,
    Error,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadItem {
    pub id: u64,
    pub local_path: String,
    pub ftp_dest_path: String,
    pub filename: String,
    pub media_title: Option<String>,
    pub tmdb_id: Option<i64>,
    pub status: UploadStatus,
    pub bytes_total: u64,
    pub bytes_done: u64,
    pub error: Option<String>,
    pub added_at_ms: u64,
    pub started_at_ms: Option<u64>,
    pub completed_at_ms: Option<u64>,
    pub resolution: Option<String>,
    pub hdr: Option<String>,
    pub languages: Vec<String>,
    pub codec: Option<String>,
    pub audio_codec: Option<String>,
    /// Optional group id linking all episodes from the same season batch upload.
    pub group_id: Option<String>,
}

pub struct UploadQueue {
    pub items: Vec<UploadItem>,
    pub next_id: u64,
    pub max_concurrent: usize,
    pub semaphore: Arc<tokio::sync::Semaphore>,
    pub cancel_flags: std::collections::HashMap<u64, Arc<std::sync::atomic::AtomicBool>>,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

impl UploadQueue {
    pub fn new(max_concurrent: usize) -> Self {
        Self {
            items: Vec::new(),
            next_id: 1,
            max_concurrent,
            semaphore: Arc::new(tokio::sync::Semaphore::new(max_concurrent)),
            cancel_flags: std::collections::HashMap::new(),
        }
    }

    pub fn add(
        &mut self,
        local_path: String,
        ftp_dest_path: String,
        filename: String,
        media_title: Option<String>,
        tmdb_id: Option<i64>,
        size_bytes: u64,
        resolution: Option<String>,
        hdr: Option<String>,
        languages: Vec<String>,
        codec: Option<String>,
        audio_codec: Option<String>,
        group_id: Option<String>,
    ) -> (u64, Arc<tokio::sync::Semaphore>, Arc<std::sync::atomic::AtomicBool>) {
        let id = self.next_id;
        self.next_id += 1;
        let cancel_flag = Arc::new(std::sync::atomic::AtomicBool::new(false));
        self.cancel_flags.insert(id, cancel_flag.clone());
        self.items.push(UploadItem {
            id,
            local_path,
            ftp_dest_path,
            filename,
            media_title,
            tmdb_id,
            status: UploadStatus::Queued,
            bytes_total: size_bytes,
            bytes_done: 0,
            error: None,
            added_at_ms: now_ms(),
            started_at_ms: None,
            completed_at_ms: None,
            resolution,
            hdr,
            languages,
            codec,
            audio_codec,
            group_id,
        });
        (id, self.semaphore.clone(), cancel_flag)
    }

    pub fn retry(
        &mut self,
        id: u64,
    ) -> Result<(UploadItem, Arc<tokio::sync::Semaphore>, Arc<std::sync::atomic::AtomicBool>), String> {
        let item = self.items.iter_mut().find(|i| i.id == id).ok_or("Upload not found")?;
        item.status = UploadStatus::Queued;
        item.error = None;
        item.started_at_ms = None;
        item.completed_at_ms = None;
        item.bytes_done = 0;
        let cancel_flag = Arc::new(std::sync::atomic::AtomicBool::new(false));
        self.cancel_flags.insert(id, cancel_flag.clone());
        Ok((item.clone(), self.semaphore.clone(), cancel_flag))
    }

    pub fn mark_started(&mut self, id: u64) {
        if let Some(item) = self.items.iter_mut().find(|i| i.id == id) {
            item.status = UploadStatus::Uploading;
            item.started_at_ms = Some(now_ms());
        }
    }

    pub fn mark_done(&mut self, id: u64) {
        if let Some(item) = self.items.iter_mut().find(|i| i.id == id) {
            item.status = UploadStatus::Done;
            item.bytes_done = item.bytes_total;
            item.completed_at_ms = Some(now_ms());
        }
    }

    pub fn mark_error(&mut self, id: u64, error: String) {
        if let Some(item) = self.items.iter_mut().find(|i| i.id == id) {
            item.status = UploadStatus::Error;
            item.error = Some(error);
            item.completed_at_ms = Some(now_ms());
        }
    }

    pub fn mark_cancelled(&mut self, id: u64) {
        if let Some(item) = self.items.iter_mut().find(|i| i.id == id) {
            item.status = UploadStatus::Cancelled;
            item.completed_at_ms = Some(now_ms());
        }
    }

    pub fn cancel(&mut self, id: u64) {
        if let Some(flag) = self.cancel_flags.get(&id) {
            flag.store(true, std::sync::atomic::Ordering::SeqCst);
        }
        if let Some(item) = self.items.iter_mut().find(|i| i.id == id) {
            if matches!(item.status, UploadStatus::Queued | UploadStatus::Uploading) {
                item.status = UploadStatus::Cancelled;
                item.error = None;
                item.completed_at_ms = Some(now_ms());
            }
        }
    }

    pub fn clear_completed(&mut self) {
        self.items.retain(|i| {
            !matches!(i.status, UploadStatus::Done | UploadStatus::Error | UploadStatus::Cancelled)
        });
        self.cancel_flags.retain(|id, _| self.items.iter().any(|item| item.id == *id));
    }

    pub fn delete(&mut self, id: u64) {
        self.items.retain(|i| i.id != id);
        self.cancel_flags.remove(&id);
    }

    /// Restore persisted items from a previous session.
    /// Items that were mid-upload are reset to Queued so they restart.
    /// Done / Error / Cancelled items are restored as-is for history.
    pub fn restore(&mut self, mut items: Vec<UploadItem>) {
        for item in &mut items {
            if item.status == UploadStatus::Uploading {
                item.status = UploadStatus::Queued;
                item.bytes_done = 0;
                item.started_at_ms = None;
            }
            // Ensure cancel flags exist for items that may be retried
            let flag = Arc::new(std::sync::atomic::AtomicBool::new(false));
            self.cancel_flags.insert(item.id, flag);
            if item.id >= self.next_id {
                self.next_id = item.id + 1;
            }
        }
        self.items = items;
    }

    /// Sum of `bytes_total` for all items in a group.
    pub fn group_total_bytes(&self, group_id: &str) -> u64 {
        self.items.iter()
            .filter(|i| i.group_id.as_deref() == Some(group_id))
            .map(|i| i.bytes_total)
            .sum()
    }

    /// Check whether all uploads in a group are done (or errored/cancelled).
    /// Returns `(done_count, total_count, all_finished)`.
    pub fn group_status(&self, group_id: &str) -> (usize, usize, bool) {
        let group: Vec<&UploadItem> = self.items.iter()
            .filter(|i| i.group_id.as_deref() == Some(group_id))
            .collect();
        let total = group.len();
        let finished = group.iter().filter(|i| {
            matches!(i.status, UploadStatus::Done | UploadStatus::Error | UploadStatus::Cancelled)
        }).count();
        let done = group.iter().filter(|i| matches!(i.status, UploadStatus::Done)).count();
        (done, total, finished == total)
    }
}

pub type SharedUploadQueue = Arc<Mutex<UploadQueue>>;
