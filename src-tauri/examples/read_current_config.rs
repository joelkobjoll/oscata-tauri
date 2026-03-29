use rusqlite::{Connection, OptionalExtension};

fn main() {
    let data_dir = dirs_next::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("oscata-tauri");
    let db_path = data_dir.join("library.db");

    println!("db_path={}", db_path.display());

    let conn = Connection::open(&db_path).expect("failed to open app database");
    let folder_types: Option<String> = conn
        .query_row(
            "SELECT value FROM app_config WHERE key = 'folder_types'",
            [],
            |row| row.get(0),
        )
        .optional()
        .expect("failed to read folder_types");

    let ftp_root: Option<String> = conn
        .query_row(
            "SELECT value FROM app_config WHERE key = 'ftp_root'",
            [],
            |row| row.get(0),
        )
        .optional()
        .expect("failed to read ftp_root");

    println!("ftp_root={}", ftp_root.unwrap_or_default());
    println!("folder_types={}", folder_types.unwrap_or_else(|| "{}".to_string()));
}