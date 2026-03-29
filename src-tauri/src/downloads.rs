use std::sync::{Arc, Mutex};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum DownloadStatus {
    Queued,
    Downloading,
    Done,
    Error,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadItem {
    pub id: u64,
    pub ftp_path: String,
    pub filename: String,
    pub local_path: String,
    pub media_title: Option<String>,
    pub status: DownloadStatus,
    pub bytes_total: u64,
    pub bytes_done: u64,
    pub error: Option<String>,
    pub added_at_ms: u64,
    pub started_at_ms: Option<u64>,
    pub completed_at_ms: Option<u64>,
}

pub struct DownloadQueue {
    pub items: Vec<DownloadItem>,
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

impl DownloadQueue {
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
        ftp_path: String,
        filename: String,
        local_path: String,
        media_title: Option<String>,
    ) -> (u64, Arc<tokio::sync::Semaphore>, Arc<std::sync::atomic::AtomicBool>) {
        let id = self.next_id;
        self.next_id += 1;
        let cancel_flag = Arc::new(std::sync::atomic::AtomicBool::new(false));
        self.cancel_flags.insert(id, cancel_flag.clone());
        self.items.push(DownloadItem {
            id,
            ftp_path,
            filename,
            local_path,
            media_title,
            status: DownloadStatus::Queued,
            bytes_total: 0,
            bytes_done: 0,
            error: None,
            added_at_ms: now_ms(),
            started_at_ms: None,
            completed_at_ms: None,
        });
        (id, self.semaphore.clone(), cancel_flag)
    }

    pub fn restore(&mut self, mut items: Vec<DownloadItem>) {
        self.cancel_flags.clear();
        let mut next_id = 1;

        for item in &mut items {
            if matches!(item.status, DownloadStatus::Queued | DownloadStatus::Downloading) {
                item.status = DownloadStatus::Queued;
                item.error = None;
                item.started_at_ms = None;
                item.completed_at_ms = None;
                item.bytes_done = std::fs::metadata(&item.local_path).map(|meta| meta.len()).unwrap_or(0);
            }
            next_id = next_id.max(item.id + 1);
            if matches!(item.status, DownloadStatus::Queued | DownloadStatus::Downloading) {
                self.cancel_flags.insert(item.id, Arc::new(std::sync::atomic::AtomicBool::new(false)));
            }
        }

        self.items = items;
        self.next_id = next_id;
    }

    pub fn retry(&mut self, id: u64) -> Result<(DownloadItem, Arc<tokio::sync::Semaphore>, Arc<std::sync::atomic::AtomicBool>), String> {
        let item = self.items.iter_mut().find(|item| item.id == id).ok_or("Download not found")?;
        item.status = DownloadStatus::Queued;
        item.error = None;
        item.started_at_ms = None;
        item.completed_at_ms = None;
        item.bytes_done = std::fs::metadata(&item.local_path).map(|meta| meta.len()).unwrap_or(0);
        let cancel_flag = Arc::new(std::sync::atomic::AtomicBool::new(false));
        self.cancel_flags.insert(id, cancel_flag.clone());
        Ok((item.clone(), self.semaphore.clone(), cancel_flag))
    }

    pub fn mark_started(&mut self, id: u64) {
        if let Some(item) = self.items.iter_mut().find(|i| i.id == id) {
            item.status = DownloadStatus::Downloading;
            item.started_at_ms = Some(now_ms());
        }
    }

    pub fn mark_done(&mut self, id: u64) {
        if let Some(item) = self.items.iter_mut().find(|i| i.id == id) {
            item.status = DownloadStatus::Done;
            item.completed_at_ms = Some(now_ms());
        }
    }

    pub fn mark_error(&mut self, id: u64, error: String) {
        if let Some(item) = self.items.iter_mut().find(|i| i.id == id) {
            item.status = DownloadStatus::Error;
            item.error = Some(error);
            item.completed_at_ms = Some(now_ms());
        }
    }

    pub fn mark_cancelled(&mut self, id: u64) {
        if let Some(item) = self.items.iter_mut().find(|i| i.id == id) {
            item.status = DownloadStatus::Cancelled;
            item.completed_at_ms = Some(now_ms());
        }
    }

    pub fn cancel(&mut self, id: u64) {
        if let Some(flag) = self.cancel_flags.get(&id) {
            flag.store(true, std::sync::atomic::Ordering::SeqCst);
        }
        if let Some(item) = self.items.iter_mut().find(|i| i.id == id) {
            if matches!(item.status, DownloadStatus::Queued | DownloadStatus::Downloading) {
                item.status = DownloadStatus::Cancelled;
                item.error = None;
                item.completed_at_ms = Some(now_ms());
            }
        }
    }

    pub fn clear_completed(&mut self) {
        self.items.retain(|i| {
            !matches!(i.status, DownloadStatus::Done | DownloadStatus::Error | DownloadStatus::Cancelled)
        });
        self.cancel_flags.retain(|id, _| self.items.iter().any(|item| item.id == *id));
    }

    pub fn delete(&mut self, id: u64) {
        self.items.retain(|i| i.id != id);
        self.cancel_flags.remove(&id);
    }

    pub fn update_concurrent(&mut self, max: usize) {
        self.max_concurrent = max;
        self.semaphore = Arc::new(tokio::sync::Semaphore::new(max));
    }
}

pub type SharedQueue = Arc<Mutex<DownloadQueue>>;
