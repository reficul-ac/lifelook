use rusqlite::{backup::Backup, params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::Manager;
use thiserror::Error;

const SCHEMA_VERSION: i64 = 2;

struct Database(Mutex<Connection>);

#[derive(Debug, Error)]
enum AppError {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("file error: {0}")]
    Io(#[from] std::io::Error),
    #[error("backup is not a valid or compatible LifeLook database")]
    InvalidBackup,
    #[error("database is currently busy")]
    Busy,
    #[error("{0}")]
    Validation(String),
}

#[derive(Serialize)]
struct ErrorBody {
    code: &'static str,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    field: Option<&'static str>,
}
impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let (code, field) = match self {
            Self::Database(_) => ("database", None),
            Self::Io(_) => ("io", None),
            Self::InvalidBackup => ("invalid_backup", None),
            Self::Busy => ("busy", None),
            Self::Validation(_) => ("validation", None),
        };
        ErrorBody {
            code,
            message: self.to_string(),
            field,
        }
        .serialize(serializer)
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceSnapshot {
    onboarding_step: i64,
    onboarding_complete: bool,
    household: Option<Household>,
    people: Vec<Person>,
    accounts: Vec<Account>,
    categories: Vec<Category>,
}
#[derive(Debug, Serialize, Deserialize)]
struct Household {
    id: String,
    name: String,
    state: String,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Person {
    id: String,
    household_id: String,
    name: String,
    birth_date: Option<String>,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Account {
    id: String,
    household_id: String,
    name: String,
    kind: String,
    opening_balance_cents: i64,
    annual_return_bps: i64,
    liquid: bool,
    revision: i64,
}
#[derive(Debug, Serialize, Deserialize)]
struct Category {
    id: String,
    name: String,
    kind: String,
    revision: i64,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OnboardingPayload {
    household: Option<Household>,
    people: Option<Vec<Person>>,
    accounts: Option<Vec<Account>>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TransactionInput {
    id: String,
    occurred_on: String,
    account_id: String,
    category_id: String,
    amount_cents: i64,
    description: String,
    note: Option<String>,
}

fn migrate(connection: &mut Connection) -> Result<(), AppError> {
    connection.pragma_update(None, "foreign_keys", "ON")?;
    let transaction = connection.transaction()?;
    transaction.execute_batch("CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS app_state(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS households(id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(trim(name))>0), state TEXT NOT NULL CHECK(state='CA'), onboarding_step INTEGER NOT NULL DEFAULT 0 CHECK(onboarding_step BETWEEN 0 AND 8), onboarding_complete INTEGER NOT NULL DEFAULT 0 CHECK(onboarding_complete IN (0,1)), revision INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS people(id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT, name TEXT NOT NULL CHECK(length(trim(name))>0), birth_date TEXT, revision INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS tax_profiles(household_id TEXT PRIMARY KEY REFERENCES households(id) ON DELETE RESTRICT, filing_status TEXT NOT NULL CHECK(filing_status IN ('single','married-joint','married-separate','head-of-household')), state TEXT NOT NULL CHECK(state='CA'), tax_year INTEGER NOT NULL CHECK(tax_year IN (2025,2026)), revision INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS settings(household_id TEXT PRIMARY KEY REFERENCES households(id) ON DELETE RESTRICT, theme TEXT NOT NULL DEFAULT 'system' CHECK(theme IN ('system','light','dark')), reduced_motion INTEGER NOT NULL DEFAULT 0 CHECK(reduced_motion IN (0,1)), revision INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS categories(id TEXT PRIMARY KEY, household_id TEXT REFERENCES households(id) ON DELETE RESTRICT, name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('income','expense','transfer')), revision INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(household_id,name,kind));
      CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT, name TEXT NOT NULL CHECK(length(trim(name))>0), kind TEXT NOT NULL CHECK(kind IN ('checking','savings','investment','retirement','credit')), opening_balance_cents INTEGER NOT NULL, annual_return_bps INTEGER NOT NULL DEFAULT 0 CHECK(annual_return_bps BETWEEN -10000 AND 100000), liquid INTEGER NOT NULL CHECK(liquid IN (0,1)), revision INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS import_profiles(id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT, normalized_headers TEXT NOT NULL, parsing_json TEXT NOT NULL, UNIQUE(household_id,normalized_headers));
      CREATE TABLE IF NOT EXISTS import_batches(id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT, imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, profile_id TEXT REFERENCES import_profiles(id) ON DELETE SET NULL, row_count INTEGER NOT NULL CHECK(row_count>=0), status TEXT NOT NULL CHECK(status IN ('complete','cancelled')));
      CREATE TABLE IF NOT EXISTS transaction_entries(id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT, occurred_on TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('income','expense','transfer','adjustment')), description TEXT NOT NULL DEFAULT '', note TEXT, import_batch_id TEXT REFERENCES import_batches(id) ON DELETE RESTRICT, transfer_group_id TEXT, revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS postings(id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id TEXT NOT NULL REFERENCES transaction_entries(id) ON DELETE RESTRICT, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT, category_id TEXT REFERENCES categories(id) ON DELETE RESTRICT, amount_cents INTEGER NOT NULL CHECK(amount_cents<>0), fingerprint TEXT, UNIQUE(account_id,fingerprint));
      CREATE TABLE IF NOT EXISTS recurring_entries(id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT, category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT, account_id TEXT REFERENCES accounts(id) ON DELETE RESTRICT, name TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents>0), start_date TEXT NOT NULL, end_date TEXT, annual_growth_bps INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT, name TEXT NOT NULL, value_cents INTEGER NOT NULL CHECK(value_cents>=0), annual_growth_bps INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS liabilities(id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT, name TEXT NOT NULL, balance_cents INTEGER NOT NULL CHECK(balance_cents>=0), annual_rate_bps INTEGER NOT NULL DEFAULT 0, minimum_payment_cents INTEGER NOT NULL DEFAULT 0 CHECK(minimum_payment_cents>=0), mortgage_json TEXT, revision INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS scenarios(id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id) ON DELETE RESTRICT, name TEXT NOT NULL, is_baseline INTEGER NOT NULL DEFAULT 0 CHECK(is_baseline IN (0,1)), assumptions_json TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1);
      CREATE UNIQUE INDEX IF NOT EXISTS one_baseline ON scenarios(household_id) WHERE is_baseline=1;
      CREATE TABLE IF NOT EXISTS scenario_events(id TEXT PRIMARY KEY, scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE RESTRICT, event_date TEXT NOT NULL, kind TEXT NOT NULL, payload_json TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS allocations(id TEXT PRIMARY KEY, scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE RESTRICT, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT, priority INTEGER NOT NULL CHECK(priority>0), percent_bps INTEGER NOT NULL CHECK(percent_bps BETWEEN 0 AND 10000), UNIQUE(scenario_id,priority,account_id));
      CREATE VIEW IF NOT EXISTS account_balances AS SELECT a.id, a.opening_balance_cents + COALESCE(SUM(p.amount_cents),0) AS balance_cents FROM accounts a LEFT JOIN postings p ON p.account_id=a.id GROUP BY a.id;")?;
    transaction.execute(
        "INSERT OR IGNORE INTO schema_migrations(version) VALUES(1)",
        [],
    )?;
    transaction.execute(
        "INSERT OR IGNORE INTO schema_migrations(version) VALUES(2)",
        [],
    )?;
    transaction.commit()?;
    Ok(())
}

fn bootstrap(connection: &Connection) -> Result<WorkspaceSnapshot, AppError> {
    let household = connection
        .query_row("SELECT id,name,state FROM households LIMIT 1", [], |r| {
            Ok(Household {
                id: r.get(0)?,
                name: r.get(1)?,
                state: r.get(2)?,
            })
        })
        .optional()?;
    let (step, complete) = if let Some(h) = &household {
        connection.query_row(
            "SELECT onboarding_step,onboarding_complete FROM households WHERE id=?",
            [&h.id],
            |r| Ok((r.get(0)?, r.get::<_, i64>(1)? != 0)),
        )?
    } else {
        (0, false)
    };
    let mut people = Vec::new();
    let mut accounts = Vec::new();
    let mut categories = Vec::new();
    if let Some(h) = &household {
        let mut q=connection.prepare("SELECT id,household_id,name,birth_date FROM people WHERE household_id=? ORDER BY rowid")?;
        people = q
            .query_map([&h.id], |r| {
                Ok(Person {
                    id: r.get(0)?,
                    household_id: r.get(1)?,
                    name: r.get(2)?,
                    birth_date: r.get(3)?,
                })
            })?
            .collect::<Result<_, _>>()?;
        let mut q=connection.prepare("SELECT id,household_id,name,kind,opening_balance_cents,annual_return_bps,liquid,revision FROM accounts WHERE household_id=? ORDER BY rowid")?;
        accounts = q
            .query_map([&h.id], |r| {
                Ok(Account {
                    id: r.get(0)?,
                    household_id: r.get(1)?,
                    name: r.get(2)?,
                    kind: r.get(3)?,
                    opening_balance_cents: r.get(4)?,
                    annual_return_bps: r.get(5)?,
                    liquid: r.get::<_, i64>(6)? != 0,
                    revision: r.get(7)?,
                })
            })?
            .collect::<Result<_, _>>()?;
        let mut q=connection.prepare("SELECT id,name,kind,revision FROM categories WHERE household_id=? OR household_id IS NULL ORDER BY name")?;
        categories = q
            .query_map([&h.id], |r| {
                Ok(Category {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    kind: r.get(2)?,
                    revision: r.get(3)?,
                })
            })?
            .collect::<Result<_, _>>()?;
    }
    Ok(WorkspaceSnapshot {
        onboarding_step: step,
        onboarding_complete: complete,
        household,
        people,
        accounts,
        categories,
    })
}

#[tauri::command]
fn get_bootstrap(database: tauri::State<Database>) -> Result<WorkspaceSnapshot, AppError> {
    let db = database.0.lock().map_err(|_| AppError::Busy)?;
    bootstrap(&db)
}

#[tauri::command]
fn save_onboarding_step(
    step: i64,
    payload: OnboardingPayload,
    database: tauri::State<Database>,
) -> Result<(), AppError> {
    if !(1..=8).contains(&step) {
        return Err(AppError::Validation("invalid onboarding step".into()));
    }
    let mut db = database.0.lock().map_err(|_| AppError::Busy)?;
    let tx = db.transaction()?;
    if let Some(h) = payload.household {
        tx.execute("INSERT INTO households(id,name,state,onboarding_step) VALUES(?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET name=excluded.name,state=excluded.state,onboarding_step=MAX(onboarding_step,excluded.onboarding_step),revision=revision+1,updated_at=CURRENT_TIMESTAMP",params![h.id,h.name,h.state,step])?;
    }
    if let Some(items) = payload.people {
        if items.is_empty() {
            return Err(AppError::Validation(
                "at least one household member is required".into(),
            ));
        }
        let household_id = items[0].household_id.clone();
        if items.iter().any(|p| p.household_id != household_id) {
            return Err(AppError::Validation(
                "household members must belong to one household".into(),
            ));
        }
        let ids: Vec<String> = items.iter().map(|p| p.id.clone()).collect();
        for p in items {
            tx.execute("INSERT INTO people(id,household_id,name,birth_date) VALUES(?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET name=excluded.name,birth_date=excluded.birth_date,revision=revision+1,updated_at=CURRENT_TIMESTAMP",params![p.id,p.household_id,p.name,p.birth_date])?;
        }
        let placeholders = std::iter::repeat_n("?", ids.len())
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!("DELETE FROM people WHERE household_id=? AND id NOT IN ({placeholders})");
        let mut values: Vec<&dyn rusqlite::ToSql> = vec![&household_id];
        values.extend(ids.iter().map(|id| id as &dyn rusqlite::ToSql));
        tx.execute(&sql, values.as_slice())?;
    }
    if let Some(items) = payload.accounts {
        if items.is_empty() {
            return Err(AppError::Validation(
                "at least one account is required".into(),
            ));
        }
        let household_id = items[0].household_id.clone();
        if items.iter().any(|a| a.household_id != household_id) {
            return Err(AppError::Validation(
                "accounts must belong to one household".into(),
            ));
        }
        let ids: Vec<String> = items.iter().map(|a| a.id.clone()).collect();
        for a in items {
            tx.execute("INSERT INTO accounts(id,household_id,name,kind,opening_balance_cents,annual_return_bps,liquid) VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,opening_balance_cents=excluded.opening_balance_cents,annual_return_bps=excluded.annual_return_bps,liquid=excluded.liquid,revision=revision+1,updated_at=CURRENT_TIMESTAMP",params![a.id,a.household_id,a.name,a.kind,a.opening_balance_cents,a.annual_return_bps,a.liquid])?;
        }
        let placeholders = std::iter::repeat_n("?", ids.len())
            .collect::<Vec<_>>()
            .join(",");
        let sql =
            format!("DELETE FROM accounts WHERE household_id=? AND id NOT IN ({placeholders})");
        let mut values: Vec<&dyn rusqlite::ToSql> = vec![&household_id];
        values.extend(ids.iter().map(|id| id as &dyn rusqlite::ToSql));
        tx.execute(&sql, values.as_slice())?;
    }
    tx.execute("UPDATE households SET onboarding_step=MAX(onboarding_step,?1) WHERE id=(SELECT id FROM households LIMIT 1)",[step])?;
    tx.commit()?;
    Ok(())
}

#[tauri::command]
fn complete_onboarding(database: tauri::State<Database>) -> Result<(), AppError> {
    let mut db = database.0.lock().map_err(|_| AppError::Busy)?;
    let tx = db.transaction()?;
    let hid: String = tx
        .query_row("SELECT id FROM households LIMIT 1", [], |r| r.get(0))
        .map_err(|_| AppError::Validation("household is required".into()))?;
    let pc: i64 = tx.query_row(
        "SELECT count(*) FROM people WHERE household_id=?",
        [&hid],
        |r| r.get(0),
    )?;
    let ac: i64 = tx.query_row(
        "SELECT count(*) FROM accounts WHERE household_id=?",
        [&hid],
        |r| r.get(0),
    )?;
    if pc < 1 {
        return Err(AppError::Validation(
            "at least one household member is required".into(),
        ));
    }
    if ac < 1 {
        return Err(AppError::Validation(
            "at least one account is required".into(),
        ));
    }
    tx.execute("INSERT OR IGNORE INTO scenarios(id,household_id,name,is_baseline,assumptions_json) VALUES(?1,?2,'Baseline',1,'{\"inflationBps\":250}')",params![format!("baseline-{hid}"),hid])?;
    tx.execute(
        "UPDATE households SET onboarding_complete=1,onboarding_step=8 WHERE id=?",
        [hid],
    )?;
    tx.commit()?;
    Ok(())
}

fn insert_transaction(db: &mut Connection, input: &TransactionInput) -> Result<(), AppError> {
    let tx = db.transaction()?;
    let hid: String = tx.query_row(
        "SELECT household_id FROM accounts WHERE id=?",
        [&input.account_id],
        |r| r.get(0),
    )?;
    let kind: String = tx.query_row(
        "SELECT kind FROM categories WHERE id=?",
        [&input.category_id],
        |r| r.get(0),
    )?;
    tx.execute("INSERT INTO transaction_entries(id,household_id,occurred_on,kind,description,note) VALUES(?1,?2,?3,?4,?5,?6)",params![input.id,hid,input.occurred_on,kind,input.description,input.note])?;
    tx.execute(
        "INSERT INTO postings(entry_id,account_id,category_id,amount_cents) VALUES(?1,?2,?3,?4)",
        params![
            input.id,
            input.account_id,
            input.category_id,
            input.amount_cents
        ],
    )?;
    tx.commit()?;
    Ok(())
}
#[tauri::command]
fn create_transaction(
    input: TransactionInput,
    database: tauri::State<Database>,
) -> Result<(), AppError> {
    let mut db = database.0.lock().map_err(|_| AppError::Busy)?;
    insert_transaction(&mut db, &input)
}
#[tauri::command]
fn create_transfer(
    id: String,
    occurred_on: String,
    from_account_id: String,
    to_account_id: String,
    amount_cents: i64,
    database: tauri::State<Database>,
) -> Result<(), AppError> {
    if amount_cents <= 0 || from_account_id == to_account_id {
        return Err(AppError::Validation(
            "transfer must use distinct accounts and a positive amount".into(),
        ));
    }
    let mut db = database.0.lock().map_err(|_| AppError::Busy)?;
    let tx = db.transaction()?;
    let h1: String = tx.query_row(
        "SELECT household_id FROM accounts WHERE id=?",
        [&from_account_id],
        |r| r.get(0),
    )?;
    let h2: String = tx.query_row(
        "SELECT household_id FROM accounts WHERE id=?",
        [&to_account_id],
        |r| r.get(0),
    )?;
    if h1 != h2 {
        return Err(AppError::Validation(
            "accounts must belong to the same household".into(),
        ));
    }
    tx.execute("INSERT INTO transaction_entries(id,household_id,occurred_on,kind,description,transfer_group_id) VALUES(?1,?2,?3,'transfer','Transfer',?1)",params![id,h1,occurred_on])?;
    tx.execute(
        "INSERT INTO postings(entry_id,account_id,amount_cents) VALUES(?1,?2,?3)",
        params![id, from_account_id, -amount_cents],
    )?;
    tx.execute(
        "INSERT INTO postings(entry_id,account_id,amount_cents) VALUES(?1,?2,?3)",
        params![id, to_account_id, amount_cents],
    )?;
    tx.commit()?;
    Ok(())
}

fn backup_to(source: &Connection, destination: &Path) -> Result<(), AppError> {
    let mut target = Connection::open(destination)?;
    Backup::new(source, &mut target)?.run_to_completion(
        64,
        std::time::Duration::from_millis(10),
        None,
    )?;
    Ok(())
}
#[tauri::command]
fn backup_database(destination: PathBuf, database: tauri::State<Database>) -> Result<(), AppError> {
    let db = database.0.lock().map_err(|_| AppError::Busy)?;
    backup_to(&db, &destination)
}
#[tauri::command]
fn inspect_backup(source: PathBuf) -> Result<(), AppError> {
    validate_backup(&source)
}
fn validate_backup(path: &Path) -> Result<(), AppError> {
    let c = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|_| AppError::InvalidBackup)?;
    let integrity: String = c
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(|_| AppError::InvalidBackup)?;
    let version: Option<i64> = c
        .query_row("SELECT MAX(version) FROM schema_migrations", [], |r| {
            r.get(0)
        })
        .map_err(|_| AppError::InvalidBackup)?;
    if integrity != "ok" || version.unwrap_or(0) > SCHEMA_VERSION || version.unwrap_or(0) < 1 {
        return Err(AppError::InvalidBackup);
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            fs::create_dir_all(&dir)?;
            let path = dir.join("lifelook.db");
            let mut c = Connection::open(&path)?;
            c.pragma_update(None, "journal_mode", "WAL")?;
            migrate(&mut c).map_err(Box::<dyn std::error::Error>::from)?;
            app.manage(path);
            app.manage(Database(Mutex::new(c)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_bootstrap,
            save_onboarding_step,
            complete_onboarding,
            create_transaction,
            create_transfer,
            backup_database,
            inspect_backup
        ])
        .run(tauri::generate_context!())
        .expect("failed to run LifeLook")
}

#[cfg(test)]
mod tests {
    use super::*;
    fn seeded() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        migrate(&mut c).unwrap();
        c.execute(
            "INSERT INTO households(id,name,state) VALUES('h','Home','CA')",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO people(id,household_id,name) VALUES('p','h','Person')",
            [],
        )
        .unwrap();
        c.execute("INSERT INTO accounts(id,household_id,name,kind,opening_balance_cents,liquid) VALUES('a','h','A','checking',10000,1),('b','h','B','savings',0,1)",[]).unwrap();
        c.execute(
            "INSERT INTO categories(id,household_id,name,kind) VALUES('c','h','Food','expense')",
            [],
        )
        .unwrap();
        c
    }
    #[test]
    fn migrations_are_repeatable() {
        let mut c = Connection::open_in_memory().unwrap();
        migrate(&mut c).unwrap();
        migrate(&mut c).unwrap();
        let n: i64 = c
            .query_row("SELECT count(*) FROM schema_migrations", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 2)
    }
    #[test]
    fn transfers_are_balanced() {
        let mut c = seeded();
        let tx = c.transaction().unwrap();
        tx.execute("INSERT INTO transaction_entries(id,household_id,occurred_on,kind,description) VALUES('t','h','2026-01-01','transfer','Transfer')",[]).unwrap();
        tx.execute("INSERT INTO postings(entry_id,account_id,amount_cents) VALUES('t','a',-2500),('t','b',2500)",[]).unwrap();
        tx.commit().unwrap();
        let sum: i64 = c
            .query_row(
                "SELECT sum(amount_cents) FROM postings WHERE entry_id='t'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(sum, 0)
    }
    #[test]
    fn backup_round_trip() {
        let c = seeded();
        let path = std::env::temp_dir().join(format!("lifelook-test-{}.db", std::process::id()));
        backup_to(&c, &path).unwrap();
        validate_backup(&path).unwrap();
        let restored = Connection::open(&path).unwrap();
        let name: String = restored
            .query_row("SELECT name FROM households", [], |r| r.get(0))
            .unwrap();
        assert_eq!(name, "Home");
        drop(restored);
        fs::remove_file(path).unwrap()
    }
}
