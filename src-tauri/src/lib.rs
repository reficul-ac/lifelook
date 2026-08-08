use rusqlite::{params, Connection};
use std::{fs, path::{Path, PathBuf}, sync::Mutex};
use tauri::Manager;
use thiserror::Error;

struct Database(Mutex<Connection>);

#[derive(Debug, Error)]
enum AppError {
    #[error("database error: {0}")] Database(#[from] rusqlite::Error),
    #[error("file error: {0}")] Io(#[from] std::io::Error),
    #[error("backup is not a valid LifeLook database")] InvalidBackup,
    #[error("database is currently busy")] Busy,
}
impl serde::Serialize for AppError { fn serialize<S>(&self, serializer: S) -> Result<S::Ok,S::Error> where S: serde::Serializer { serializer.serialize_str(&self.to_string()) } }

fn migrate(connection: &mut Connection) -> Result<(), AppError> {
    let transaction = connection.transaction()?;
    transaction.execute_batch("PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS app_state(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS transactions(id TEXT PRIMARY KEY, occurred_on TEXT NOT NULL, amount_cents INTEGER NOT NULL, account_id TEXT NOT NULL, category_id TEXT NOT NULL, transfer_account_id TEXT, note TEXT, import_batch_id TEXT);
      CREATE TABLE IF NOT EXISTS import_batches(id TEXT PRIMARY KEY, imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, profile_id TEXT, row_count INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL CHECK(status IN ('pending','complete','cancelled')));
      INSERT OR IGNORE INTO schema_migrations(version) VALUES (1);")?;
    transaction.commit()?;
    Ok(())
}

#[tauri::command]
fn load_state(database: tauri::State<Database>) -> Result<Option<String>, AppError> {
    let connection = database.0.lock().map_err(|_| AppError::Busy)?;
    let mut statement = connection.prepare("SELECT value FROM app_state WHERE key='workspace'")?;
    match statement.query_row([], |row| row.get(0)) { Ok(value) => Ok(Some(value)), Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None), Err(error) => Err(error.into()) }
}

#[tauri::command]
fn save_state(value: String, database: tauri::State<Database>) -> Result<(), AppError> {
    let connection = database.0.lock().map_err(|_| AppError::Busy)?;
    connection.execute("INSERT INTO app_state(key,value,updated_at) VALUES('workspace',?1,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP", params![value])?;
    Ok(())
}

#[tauri::command]
fn backup_database(destination: PathBuf, database_path: tauri::State<PathBuf>, database: tauri::State<Database>) -> Result<(), AppError> {
    let connection = database.0.lock().map_err(|_| AppError::Busy)?;
    connection.execute_batch("PRAGMA wal_checkpoint(FULL)")?;
    fs::copy(database_path.as_ref(), destination)?;
    Ok(())
}

#[tauri::command]
fn inspect_backup(source: PathBuf) -> Result<(), AppError> { validate_backup(&source) }

fn validate_backup(path: &Path) -> Result<(), AppError> {
    let connection = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|_| AppError::InvalidBackup)?;
    let integrity: String = connection.query_row("PRAGMA integrity_check", [], |row| row.get(0)).map_err(|_| AppError::InvalidBackup)?;
    let version: i64 = connection.query_row("SELECT MAX(version) FROM schema_migrations", [], |row| row.get(0)).map_err(|_| AppError::InvalidBackup)?;
    if integrity != "ok" || version < 1 { return Err(AppError::InvalidBackup); }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default().plugin(tauri_plugin_dialog::init()).setup(|app| {
        let data_dir = app.path().app_data_dir()?;
        fs::create_dir_all(&data_dir)?;
        let database_path = data_dir.join("lifelook.db");
        let mut connection = Connection::open(&database_path)?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        migrate(&mut connection).map_err(|error| Box::<dyn std::error::Error>::from(error))?;
        app.manage(database_path);
        app.manage(Database(Mutex::new(connection)));
        Ok(())
    }).invoke_handler(tauri::generate_handler![load_state, save_state, backup_database, inspect_backup]).run(tauri::generate_context!()).expect("failed to run LifeLook");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn migrations_are_repeatable() { let mut db=Connection::open_in_memory().unwrap(); migrate(&mut db).unwrap(); migrate(&mut db).unwrap(); let count:i64=db.query_row("SELECT COUNT(*) FROM schema_migrations",[],|r|r.get(0)).unwrap(); assert_eq!(count,1); }
}
