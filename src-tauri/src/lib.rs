use rusqlite::{backup::Backup, params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::Manager;
use thiserror::Error;

const SCHEMA_VERSION: i64 = 5;
const MAX_MONEY_CENTS: i64 = 99_999_999_999_999;

struct Database {
    path: PathBuf,
    state: Mutex<DatabaseState>,
}

enum DatabaseState {
    Ready(Connection),
    Unavailable(StartupFailure),
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StartupFailure {
    code: &'static str,
    message: String,
    profile_path: Option<String>,
    retryable: bool,
}

#[derive(Debug, Error)]
enum AppError {
    #[error("profile startup failed")]
    Startup(StartupFailure),
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("invalid JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("file error: {0}")]
    Io(#[from] std::io::Error),
    #[error("backup is not a valid or compatible LifeLook database")]
    InvalidBackup,
    #[error("this backup was created by a newer version of LifeLook")]
    IncompatibleBackup,
    #[error("restore failed; the original profile was recovered: {0}")]
    RestoreFailed(String),
    #[error("database is currently busy")]
    Busy,
    #[error("{0}")]
    Validation(String),
    #[error("this record was changed elsewhere; refresh and try again")]
    Conflict,
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
        if let Self::Startup(failure) = self {
            return failure.serialize(serializer);
        }
        let (code, field) = match self {
            Self::Startup(_) => unreachable!(),
            Self::Database(_) => ("database", None),
            Self::Json(_) => ("validation", None),
            Self::Io(_) => ("io", None),
            Self::InvalidBackup => ("invalid_backup", None),
            Self::IncompatibleBackup => ("incompatible_backup", None),
            Self::RestoreFailed(_) => ("restore_failed", None),
            Self::Busy => ("busy", None),
            Self::Validation(_) => ("validation", None),
            Self::Conflict => ("conflict", None),
        };
        ErrorBody {
            code,
            message: self.to_string(),
            field,
        }
        .serialize(serializer)
    }
}

fn with_db<T>(
    database: &Database,
    operation: impl FnOnce(&mut Connection) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let mut state = database.state.lock().map_err(|_| AppError::Busy)?;
    match &mut *state {
        DatabaseState::Ready(connection) => operation(connection),
        DatabaseState::Unavailable(failure) => Err(AppError::Startup(failure.clone())),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceSnapshot {
    onboarding_step: i64,
    onboarding_complete: bool,
    household: Option<Household>,
    people: Vec<Person>,
    tax_profile: Option<TaxProfile>,
    settings: Settings,
    accounts: Vec<Account>,
    categories: Vec<Category>,
    activity: Vec<ActivityPosting>,
    recurring: Vec<RecurringEntry>,
    assets: Vec<Asset>,
    liabilities: Vec<Liability>,
    scenarios: Vec<ScenarioRecord>,
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
struct TaxProfile {
    filing_status: String,
    state: String,
    tax_year: i64,
    threshold_inflation_bps: i64,
    revision: i64,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    theme: String,
    reduced_motion: bool,
    revision: i64,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Account {
    id: String,
    household_id: String,
    name: String,
    kind: String,
    opening_balance_cents: i64,
    balance_cents: i64,
    annual_return_bps: i64,
    liquid: bool,
    revision: i64,
}
#[derive(Debug, Serialize, Deserialize)]
struct Category {
    id: String,
    household_id: String,
    name: String,
    kind: String,
    revision: i64,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActivityPosting {
    posting_id: i64,
    entry_id: String,
    occurred_on: String,
    kind: String,
    origin: String,
    can_delete: bool,
    description: String,
    note: Option<String>,
    transfer_group_id: Option<String>,
    account_id: String,
    account_name: String,
    category_id: Option<String>,
    category_name: Option<String>,
    amount_cents: i64,
    revision: i64,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecurringEntry {
    id: String,
    household_id: String,
    category_id: String,
    account_id: Option<String>,
    name: String,
    amount_cents: i64,
    frequency: String,
    start_date: String,
    end_date: Option<String>,
    annual_growth_bps: i64,
    revision: i64,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Asset {
    id: String,
    household_id: String,
    name: String,
    value_cents: i64,
    annual_growth_bps: i64,
    revision: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MortgageTerms {
    original_principal_cents: i64,
    term_months: i64,
    start_date: String,
    payment_override_cents: Option<i64>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Liability {
    id: String,
    household_id: String,
    name: String,
    balance_cents: i64,
    annual_rate_bps: i64,
    minimum_payment_cents: i64,
    mortgage: Option<MortgageTerms>,
    revision: i64,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScenarioRecord {
    id: String,
    household_id: String,
    name: String,
    is_baseline: bool,
    assumptions: serde_json::Value,
    horizon_months: i64,
    revision: i64,
    events: Vec<serde_json::Value>,
    allocations: Vec<serde_json::Value>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecurringInput {
    id: String,
    category_id: String,
    account_id: Option<String>,
    name: String,
    amount_cents: i64,
    frequency: String,
    start_date: String,
    end_date: Option<String>,
    annual_growth_bps: i64,
    expected_revision: Option<i64>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScenarioCreateInput {
    id: String,
    name: String,
    clone_from_id: Option<String>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScenarioUpdateInput {
    id: String,
    name: String,
    assumptions: serde_json::Value,
    horizon_months: i64,
    events: Vec<serde_json::Value>,
    allocations: Vec<serde_json::Value>,
    expected_revision: i64,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OnboardingPayload {
    household: Option<Household>,
    people: Option<Vec<Person>>,
    tax_profile: Option<TaxProfile>,
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
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateTransactionInput {
    id: String,
    occurred_on: String,
    account_id: String,
    category_id: String,
    amount_cents: i64,
    description: String,
    note: Option<String>,
    expected_revision: i64,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TransferInput {
    id: String,
    occurred_on: String,
    from_account_id: String,
    to_account_id: String,
    amount_cents: i64,
    expected_revision: Option<i64>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccountInput {
    id: String,
    name: String,
    kind: String,
    opening_balance_cents: i64,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateAccountInput {
    id: String,
    name: String,
    kind: String,
    expected_revision: i64,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReconcileAccountInput {
    id: String,
    occurred_on: String,
    target_balance_cents: i64,
    expected_balance_cents: i64,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteInput {
    id: String,
    expected_revision: i64,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AssetInput {
    id: String,
    name: String,
    value_cents: i64,
    annual_growth_bps: i64,
    expected_revision: Option<i64>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LiabilityInput {
    id: String,
    name: String,
    balance_cents: i64,
    annual_rate_bps: i64,
    minimum_payment_cents: i64,
    mortgage: Option<MortgageTerms>,
    expected_revision: Option<i64>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AccountDeletionImpact {
    account_id: String,
    can_delete: bool,
    blockers: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CsvMapping {
    account_id: String,
    date_column: String,
    description_column: String,
    note_column: Option<String>,
    amount_layout: String,
    amount_column: Option<String>,
    debit_column: Option<String>,
    credit_column: Option<String>,
    inflow_positive: bool,
    date_format: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CsvInspection {
    path: String,
    file_hash: String,
    headers: Vec<String>,
    row_count: usize,
    saved_mapping: Option<CsvMapping>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CsvPreviewRow {
    row_number: usize,
    occurred_on: Option<String>,
    description: String,
    note: Option<String>,
    amount_cents: Option<i64>,
    kind: Option<String>,
    category_id: Option<String>,
    category_name: Option<String>,
    valid: bool,
    error: Option<String>,
    duplicate: String,
    include: bool,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CsvPreview {
    path: String,
    file_hash: String,
    mapping: CsvMapping,
    rows: Vec<CsvPreviewRow>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CsvCommitRow {
    row_number: usize,
    category_id: String,
    include: bool,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CsvImportResult {
    batch_id: String,
    imported_count: usize,
    skipped_count: usize,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SettingsInput {
    theme: String,
    reduced_motion: bool,
    expected_revision: i64,
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
    let has_horizon: bool = transaction
        .prepare("PRAGMA table_info(scenarios)")?
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?
        .iter()
        .any(|name| name == "horizon_months");
    if !has_horizon {
        transaction.execute("ALTER TABLE scenarios ADD COLUMN horizon_months INTEGER NOT NULL DEFAULT 120 CHECK(horizon_months BETWEEN 1 AND 480)", [])?;
    }
    transaction.execute(
        "INSERT OR IGNORE INTO schema_migrations(version) VALUES(3)",
        [],
    )?;
    let recurring_columns: Vec<String> = transaction
        .prepare("PRAGMA table_info(recurring_entries)")?
        .query_map([], |r| r.get(1))?
        .collect::<Result<_, _>>()?;
    if !recurring_columns.iter().any(|x| x == "frequency") {
        transaction.execute("ALTER TABLE recurring_entries ADD COLUMN frequency TEXT NOT NULL DEFAULT 'monthly' CHECK(frequency IN ('weekly','biweekly','monthly','quarterly','annual'))", [])?;
    }
    let allocation_columns: Vec<String> = transaction
        .prepare("PRAGMA table_info(allocations)")?
        .query_map([], |r| r.get(1))?
        .collect::<Result<_, _>>()?;
    if !allocation_columns
        .iter()
        .any(|x| x == "target_balance_cents")
    {
        transaction.execute("ALTER TABLE allocations ADD COLUMN target_balance_cents INTEGER CHECK(target_balance_cents>=0)", [])?;
    }
    transaction.execute("CREATE UNIQUE INDEX IF NOT EXISTS scenario_name_per_household ON scenarios(household_id,name COLLATE NOCASE)", [])?;
    // Versions 1–2 accepted a positive credit opening balance. Version 3 defines
    // onboarding input as a positive amount owed and stores credit as signed debt.
    transaction.execute("UPDATE accounts SET opening_balance_cents=-opening_balance_cents,revision=revision+1 WHERE kind='credit' AND opening_balance_cents>0", [])?;
    let version: i64 = transaction.query_row(
        "SELECT COALESCE(MAX(version),0) FROM schema_migrations",
        [],
        |r| r.get(0),
    )?;
    if version < 4 {
        transaction.execute_batch("DROP VIEW IF EXISTS account_balances;
          ALTER TABLE postings RENAME TO postings_v3;
          CREATE TABLE postings(id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id TEXT NOT NULL REFERENCES transaction_entries(id) ON DELETE RESTRICT, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT, category_id TEXT REFERENCES categories(id) ON DELETE RESTRICT, amount_cents INTEGER NOT NULL CHECK(amount_cents<>0), fingerprint TEXT);
          INSERT INTO postings SELECT * FROM postings_v3;
          DROP TABLE postings_v3;
          CREATE INDEX postings_duplicate_key ON postings(account_id,fingerprint);
          CREATE VIEW account_balances AS SELECT a.id, a.opening_balance_cents + COALESCE(SUM(p.amount_cents),0) AS balance_cents FROM accounts a LEFT JOIN postings p ON p.account_id=a.id GROUP BY a.id;")?;
        transaction.execute("INSERT INTO schema_migrations(version) VALUES(4)", [])?;
    }
    transaction.execute(
        "INSERT OR IGNORE INTO schema_migrations(version) VALUES(5)",
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
    let mut tax_profile = None;
    let mut settings = Settings {
        theme: "system".into(),
        reduced_motion: false,
        revision: 1,
    };
    let mut activity = Vec::new();
    let mut recurring = Vec::new();
    let mut assets = Vec::new();
    let mut liabilities = Vec::new();
    let mut scenarios = Vec::new();
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
        tax_profile = connection.query_row("SELECT filing_status,state,tax_year,250,revision FROM tax_profiles WHERE household_id=?",[&h.id],|r| Ok(TaxProfile{filing_status:r.get(0)?,state:r.get(1)?,tax_year:r.get(2)?,threshold_inflation_bps:r.get(3)?,revision:r.get(4)?})).optional()?;
        settings = connection
            .query_row(
                "SELECT theme,reduced_motion,revision FROM settings WHERE household_id=?",
                [&h.id],
                |r| {
                    Ok(Settings {
                        theme: r.get(0)?,
                        reduced_motion: r.get::<_, i64>(1)? != 0,
                        revision: r.get(2)?,
                    })
                },
            )
            .optional()?
            .unwrap_or(settings);
        let mut q=connection.prepare("SELECT a.id,a.household_id,a.name,a.kind,a.opening_balance_cents,b.balance_cents,a.annual_return_bps,a.liquid,a.revision FROM accounts a JOIN account_balances b ON b.id=a.id WHERE a.household_id=? ORDER BY a.rowid")?;
        accounts = q
            .query_map([&h.id], |r| {
                Ok(Account {
                    id: r.get(0)?,
                    household_id: r.get(1)?,
                    name: r.get(2)?,
                    kind: r.get(3)?,
                    opening_balance_cents: r.get(4)?,
                    balance_cents: r.get(5)?,
                    annual_return_bps: r.get(6)?,
                    liquid: r.get::<_, i64>(7)? != 0,
                    revision: r.get(8)?,
                })
            })?
            .collect::<Result<_, _>>()?;
        let mut q=connection.prepare("SELECT id,COALESCE(household_id,?),name,kind,revision FROM categories WHERE household_id=? OR household_id IS NULL ORDER BY name")?;
        categories = q
            .query_map([&h.id, &h.id], |r| {
                Ok(Category {
                    id: r.get(0)?,
                    household_id: r.get(1)?,
                    name: r.get(2)?,
                    kind: r.get(3)?,
                    revision: r.get(4)?,
                })
            })?
            .collect::<Result<_, _>>()?;
        let mut q=connection.prepare("SELECT p.id,e.id,e.occurred_on,e.kind,CASE WHEN e.kind='adjustment' THEN 'reconciliation' WHEN e.import_batch_id IS NOT NULL THEN 'import' ELSE 'manual' END,e.kind<>'adjustment',e.description,e.note,e.transfer_group_id,p.account_id,a.name,p.category_id,c.name,p.amount_cents,e.revision FROM transaction_entries e JOIN postings p ON p.entry_id=e.id JOIN accounts a ON a.id=p.account_id LEFT JOIN categories c ON c.id=p.category_id WHERE e.household_id=? ORDER BY e.occurred_on DESC,e.id,p.id")?;
        activity = q
            .query_map([&h.id], |r| {
                Ok(ActivityPosting {
                    posting_id: r.get(0)?,
                    entry_id: r.get(1)?,
                    occurred_on: r.get(2)?,
                    kind: r.get(3)?,
                    origin: r.get(4)?,
                    can_delete: r.get(5)?,
                    description: r.get(6)?,
                    note: r.get(7)?,
                    transfer_group_id: r.get(8)?,
                    account_id: r.get(9)?,
                    account_name: r.get(10)?,
                    category_id: r.get(11)?,
                    category_name: r.get(12)?,
                    amount_cents: r.get(13)?,
                    revision: r.get(14)?,
                })
            })?
            .collect::<Result<_, _>>()?;
        let mut q=connection.prepare("SELECT id,household_id,category_id,account_id,name,amount_cents,frequency,start_date,end_date,annual_growth_bps,revision FROM recurring_entries WHERE household_id=? ORDER BY name")?;
        recurring = q
            .query_map([&h.id], |r| {
                Ok(RecurringEntry {
                    id: r.get(0)?,
                    household_id: r.get(1)?,
                    category_id: r.get(2)?,
                    account_id: r.get(3)?,
                    name: r.get(4)?,
                    amount_cents: r.get(5)?,
                    frequency: r.get(6)?,
                    start_date: r.get(7)?,
                    end_date: r.get(8)?,
                    annual_growth_bps: r.get(9)?,
                    revision: r.get(10)?,
                })
            })?
            .collect::<Result<_, _>>()?;
        let mut q=connection.prepare("SELECT id,household_id,name,value_cents,annual_growth_bps,revision FROM assets WHERE household_id=? ORDER BY name")?;
        assets = q
            .query_map([&h.id], |r| {
                Ok(Asset {
                    id: r.get(0)?,
                    household_id: r.get(1)?,
                    name: r.get(2)?,
                    value_cents: r.get(3)?,
                    annual_growth_bps: r.get(4)?,
                    revision: r.get(5)?,
                })
            })?
            .collect::<Result<_, _>>()?;
        let mut q=connection.prepare("SELECT id,household_id,name,balance_cents,annual_rate_bps,minimum_payment_cents,mortgage_json,revision FROM liabilities WHERE household_id=? ORDER BY name")?;
        liabilities = q
            .query_map([&h.id], |r| {
                Ok(Liability {
                    id: r.get(0)?,
                    household_id: r.get(1)?,
                    name: r.get(2)?,
                    balance_cents: r.get(3)?,
                    annual_rate_bps: r.get(4)?,
                    minimum_payment_cents: r.get(5)?,
                    mortgage: r
                        .get::<_, Option<String>>(6)?
                        .and_then(|raw| serde_json::from_str(&raw).ok()),
                    revision: r.get(7)?,
                })
            })?
            .collect::<Result<_, _>>()?;
        let mut q=connection.prepare("SELECT id,household_id,name,is_baseline,assumptions_json,horizon_months,revision FROM scenarios WHERE household_id=? ORDER BY is_baseline DESC,name")?;
        scenarios = q
            .query_map([&h.id], |r| {
                let raw: String = r.get(4)?;
                let mut assumptions: serde_json::Value =
                    serde_json::from_str(&raw).unwrap_or_default();
                if assumptions
                    .get("inflationBps")
                    .and_then(|value| value.as_i64())
                    .is_none()
                {
                    assumptions["inflationBps"] = serde_json::json!(250);
                }
                if assumptions
                    .get("thresholdInflationBps")
                    .and_then(|value| value.as_i64())
                    .is_none()
                {
                    assumptions["thresholdInflationBps"] = serde_json::json!(250);
                }
                Ok(ScenarioRecord {
                    id: r.get(0)?,
                    household_id: r.get(1)?,
                    name: r.get(2)?,
                    is_baseline: r.get::<_, i64>(3)? != 0,
                    assumptions,
                    horizon_months: r.get(5)?,
                    revision: r.get(6)?,
                    events: vec![],
                    allocations: vec![],
                })
            })?
            .collect::<Result<_, _>>()?;
        drop(q);
        for scenario in &mut scenarios {
            let mut events = connection.prepare("SELECT json_set(payload_json,'$.id',id,'$.date',event_date,'$.type',kind) FROM scenario_events WHERE scenario_id=? ORDER BY event_date,id")?;
            scenario.events = events
                .query_map([&scenario.id], |r| {
                    let raw: String = r.get(0)?;
                    Ok(serde_json::from_str(&raw).unwrap_or(serde_json::Value::Null))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            let mut allocations = connection.prepare("SELECT json_object('id',id,'accountId',account_id,'priority',priority,'percentBps',percent_bps,'targetBalanceCents',target_balance_cents) FROM allocations WHERE scenario_id=? ORDER BY priority")?;
            scenario.allocations = allocations
                .query_map([&scenario.id], |r| {
                    let raw: String = r.get(0)?;
                    Ok(serde_json::from_str(&raw).unwrap_or(serde_json::Value::Null))
                })?
                .collect::<Result<Vec<_>, _>>()?;
        }
    }
    Ok(WorkspaceSnapshot {
        onboarding_step: step,
        onboarding_complete: complete,
        household,
        people,
        tax_profile,
        settings,
        accounts,
        categories,
        activity,
        recurring,
        assets,
        liabilities,
        scenarios,
    })
}

#[tauri::command]
fn get_bootstrap(database: tauri::State<Database>) -> Result<WorkspaceSnapshot, AppError> {
    with_db(&database, |db| bootstrap(db))
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
    with_db(&database, |db| {
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
            let sql =
                format!("DELETE FROM people WHERE household_id=? AND id NOT IN ({placeholders})");
            let mut values: Vec<&dyn rusqlite::ToSql> = vec![&household_id];
            values.extend(ids.iter().map(|id| id as &dyn rusqlite::ToSql));
            tx.execute(&sql, values.as_slice())?;
        }
        if let Some(profile) = payload.tax_profile {
            if !matches!(
                profile.filing_status.as_str(),
                "single" | "married-joint" | "married-separate" | "head-of-household"
            ) || !matches!(profile.tax_year, 2025 | 2026)
            {
                return Err(AppError::Validation(
                    "select a supported filing status and tax year".into(),
                ));
            }
            let hid: String =
                tx.query_row("SELECT id FROM households LIMIT 1", [], |r| r.get(0))?;
            tx.execute("INSERT INTO tax_profiles(household_id,filing_status,state,tax_year) VALUES(?1,?2,'CA',?3) ON CONFLICT(household_id) DO UPDATE SET filing_status=excluded.filing_status,tax_year=excluded.tax_year,revision=revision+1",params![hid,profile.filing_status,profile.tax_year])?;
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
                if a.opening_balance_cents.abs() > MAX_MONEY_CENTS {
                    return Err(AppError::Validation(
                        "opening balance exceeds the supported money range".into(),
                    ));
                }
                let opening = if a.kind == "credit" {
                    -a.opening_balance_cents.abs()
                } else {
                    a.opening_balance_cents
                };
                tx.execute("INSERT INTO accounts(id,household_id,name,kind,opening_balance_cents,annual_return_bps,liquid) VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,opening_balance_cents=excluded.opening_balance_cents,annual_return_bps=excluded.annual_return_bps,liquid=excluded.liquid,revision=revision+1,updated_at=CURRENT_TIMESTAMP",params![a.id,a.household_id,a.name,a.kind,a.opening_balance_cents,a.annual_return_bps,a.liquid])?;
                tx.execute(
                    "UPDATE accounts SET opening_balance_cents=? WHERE id=?",
                    params![opening, a.id],
                )?;
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
    })
}

#[tauri::command]
fn complete_onboarding(database: tauri::State<Database>) -> Result<(), AppError> {
    with_db(&database, |db| {
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
        let tp: i64 = tx.query_row(
            "SELECT count(*) FROM tax_profiles WHERE household_id=?",
            [&hid],
            |r| r.get(0),
        )?;
        if tp < 1 {
            return Err(AppError::Validation("filing status is required".into()));
        }
        tx.execute(
            "INSERT OR IGNORE INTO settings(household_id) VALUES(?)",
            [&hid],
        )?;
        for (id, name, kind) in [
            ("income-other", "Other income", "income"),
            ("expense-other", "Other expense", "expense"),
        ] {
            tx.execute(
                "INSERT OR IGNORE INTO categories(id,household_id,name,kind) VALUES(?1,?2,?3,?4)",
                params![format!("{id}-{hid}"), hid, name, kind],
            )?;
        }
        tx.execute("INSERT OR IGNORE INTO scenarios(id,household_id,name,is_baseline,assumptions_json) VALUES(?1,?2,'Baseline',1,'{\"inflationBps\":250,\"thresholdInflationBps\":250}')",params![format!("baseline-{hid}"),hid])?;
        tx.execute(
            "UPDATE households SET onboarding_complete=1,onboarding_step=8 WHERE id=?",
            [hid],
        )?;
        tx.commit()?;
        Ok(())
    })
}

fn valid_iso_date(value: &str) -> bool {
    value.len() == 10
        && value.as_bytes().get(4) == Some(&b'-')
        && value.as_bytes().get(7) == Some(&b'-')
        && chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").is_ok()
}
fn validate_recurring(input: &RecurringInput) -> Result<(), AppError> {
    if input.name.trim().is_empty()
        || input.amount_cents <= 0
        || input.amount_cents > MAX_MONEY_CENTS
    {
        return Err(AppError::Validation(
            "enter a name and a positive supported amount".into(),
        ));
    }
    if !matches!(
        input.frequency.as_str(),
        "weekly" | "biweekly" | "monthly" | "quarterly" | "annual"
    ) {
        return Err(AppError::Validation("invalid recurring frequency".into()));
    }
    if !valid_iso_date(&input.start_date)
        || input
            .end_date
            .as_deref()
            .is_some_and(|x| !valid_iso_date(x) || x < input.start_date.as_str())
    {
        return Err(AppError::Validation("invalid recurring date range".into()));
    }
    if !(-10000..=100000).contains(&input.annual_growth_bps) {
        return Err(AppError::Validation("annual growth is out of range".into()));
    }
    Ok(())
}
#[tauri::command]
fn create_recurring(
    input: RecurringInput,
    database: tauri::State<Database>,
) -> Result<(), AppError> {
    with_db(&database, |db| {
        validate_recurring(&input)?;
        let hid: String = db.query_row("SELECT id FROM households LIMIT 1", [], |r| r.get(0))?;
        db.execute("INSERT INTO recurring_entries(id,household_id,category_id,account_id,name,amount_cents,frequency,start_date,end_date,annual_growth_bps) SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10 WHERE EXISTS(SELECT 1 FROM categories WHERE id=?3 AND household_id=?2) AND (?4 IS NULL OR EXISTS(SELECT 1 FROM accounts WHERE id=?4 AND household_id=?2))",params![input.id,hid,input.category_id,input.account_id,input.name.trim(),input.amount_cents,input.frequency,input.start_date,input.end_date,input.annual_growth_bps]).and_then(|n|if n==1{Ok(n)}else{Err(rusqlite::Error::QueryReturnedNoRows)}).map_err(|_|AppError::Validation("category or account does not belong to this household".into()))?;
        Ok(())
    })
}
#[tauri::command]
fn update_recurring(
    input: RecurringInput,
    database: tauri::State<Database>,
) -> Result<(), AppError> {
    with_db(&database, |db| {
        validate_recurring(&input)?;
        let revision = input
            .expected_revision
            .ok_or_else(|| AppError::Validation("expected revision is required".into()))?;
        let n=db.execute("UPDATE recurring_entries SET category_id=?2,account_id=?3,name=?4,amount_cents=?5,frequency=?6,start_date=?7,end_date=?8,annual_growth_bps=?9,revision=revision+1 WHERE id=?1 AND revision=?10 AND EXISTS(SELECT 1 FROM categories c WHERE c.id=?2 AND c.household_id=recurring_entries.household_id) AND (?3 IS NULL OR EXISTS(SELECT 1 FROM accounts a WHERE a.id=?3 AND a.household_id=recurring_entries.household_id))",params![input.id,input.category_id,input.account_id,input.name.trim(),input.amount_cents,input.frequency,input.start_date,input.end_date,input.annual_growth_bps,revision])?;
        if n == 0 {
            return Err(AppError::Conflict);
        }
        Ok(())
    })
}
#[tauri::command]
fn delete_recurring(input: DeleteInput, database: tauri::State<Database>) -> Result<(), AppError> {
    with_db(&database, |db| {
        let n = db.execute(
            "DELETE FROM recurring_entries WHERE id=? AND revision=?",
            params![input.id, input.expected_revision],
        )?;
        if n == 0 {
            return Err(AppError::Conflict);
        }
        Ok(())
    })
}

fn scenario_name(value: &str) -> Result<&str, AppError> {
    let name = value.trim();
    if name.is_empty() || name.len() > 100 {
        Err(AppError::Validation(
            "scenario name must be between 1 and 100 characters".into(),
        ))
    } else {
        Ok(name)
    }
}
#[tauri::command]
fn create_scenario(
    input: ScenarioCreateInput,
    database: tauri::State<Database>,
) -> Result<(), AppError> {
    with_db(&database, |db| {
        let name = scenario_name(&input.name)?;
        let tx = db.transaction()?;
        let hid: String = tx.query_row("SELECT id FROM households LIMIT 1", [], |r| r.get(0))?;
        let duplicate: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM scenarios WHERE household_id=?1 AND name=?2 COLLATE NOCASE)",
            params![hid, name],
            |r| r.get(0),
        )?;
        if duplicate {
            return Err(AppError::Validation(
                "a scenario with this name already exists".into(),
            ));
        }
        if let Some(source) = input.clone_from_id {
            let (assumptions,horizon):(String,i64)=tx.query_row("SELECT assumptions_json,horizon_months FROM scenarios WHERE id=? AND household_id=?",params![source,hid],|r|Ok((r.get(0)?,r.get(1)?))).map_err(|_|AppError::Validation("clone source does not belong to this household".into()))?;
            tx.execute("INSERT INTO scenarios(id,household_id,name,is_baseline,assumptions_json,horizon_months) VALUES(?1,?2,?3,0,?4,?5)",params![input.id,hid,name,assumptions,horizon])?;
            tx.execute("INSERT INTO scenario_events(id,scenario_id,event_date,kind,payload_json) SELECT ?1||'-'||id,?1,event_date,kind,payload_json FROM scenario_events WHERE scenario_id=?2",params![input.id,source])?;
            tx.execute("INSERT INTO allocations(id,scenario_id,account_id,priority,percent_bps,target_balance_cents) SELECT ?1||'-'||id,?1,account_id,priority,percent_bps,target_balance_cents FROM allocations WHERE scenario_id=?2",params![input.id,source])?;
        } else {
            tx.execute("INSERT INTO scenarios(id,household_id,name,is_baseline,assumptions_json,horizon_months) VALUES(?1,?2,?3,0,'{\"inflationBps\":250,\"thresholdInflationBps\":250}',120)",params![input.id,hid,name])?;
        }
        tx.commit()?;
        Ok(())
    })
}

fn json_i64(v: &serde_json::Value, key: &str) -> Option<i64> {
    v.get(key)?.as_i64()
}
fn validate_scenario_update(input: &ScenarioUpdateInput) -> Result<(), AppError> {
    if !(1..=480).contains(&input.horizon_months) {
        return Err(AppError::Validation(
            "projection horizon must be between 1 and 480 months".into(),
        ));
    }
    for key in ["inflationBps", "thresholdInflationBps"] {
        let rate = json_i64(&input.assumptions, key).ok_or_else(|| {
            AppError::Validation(format!("{key} must be an integer number of basis points"))
        })?;
        if !(-10000..=100000).contains(&rate) {
            return Err(AppError::Validation(format!(
                "{key} is outside the supported rate range"
            )));
        }
    }
    let mut event_ids = HashSet::new();
    let supported = [
        "recurring-change",
        "income-change",
        "one-time-income",
        "one-time-expense",
        "account-transfer",
        "account-contribution",
        "asset-purchase",
        "asset-sale",
        "debt-origination",
        "debt-payoff",
    ];
    for event in &input.events {
        let id = event
            .get("id")
            .and_then(|x| x.as_str())
            .filter(|x| !x.trim().is_empty())
            .ok_or_else(|| AppError::Validation("event id is required".into()))?;
        if !event_ids.insert(id) {
            return Err(AppError::Validation("event ids must be unique".into()));
        }
        let kind = event
            .get("type")
            .and_then(|x| x.as_str())
            .ok_or_else(|| AppError::Validation("event type is required".into()))?;
        if !supported.contains(&kind) {
            return Err(AppError::Validation("event type is invalid".into()));
        }
        let date = event
            .get("date")
            .and_then(|x| x.as_str())
            .ok_or_else(|| AppError::Validation("event date is required".into()))?;
        if !valid_iso_date(date) {
            return Err(AppError::Validation("event date is invalid".into()));
        }
        let positive =
            |key: &str| json_i64(event, key).is_some_and(|x| (1..=MAX_MONEY_CENTS).contains(&x));
        let required_money: &[&str] = match kind {
            "recurring-change"
            | "income-change"
            | "one-time-income"
            | "one-time-expense"
            | "account-transfer"
            | "account-contribution" => &["amountCents"],
            "asset-purchase" => &["valueCents", "downPaymentCents", "costsCents"],
            "asset-sale" => &["proceedsCents", "costsCents"],
            "debt-origination" => &["principalCents", "minimumPaymentCents"],
            _ => &[],
        };
        if required_money.iter().any(|key| !positive(key)) {
            return Err(AppError::Validation(format!(
                "{kind} requires exact positive money values"
            )));
        }
        for rate_key in ["annualGrowthBps", "annualRateBps"] {
            if let Some(rate) = json_i64(event, rate_key) {
                if !(-10000..=100000).contains(&rate) {
                    return Err(AppError::Validation(format!(
                        "{rate_key} is outside the supported rate range"
                    )));
                }
            }
        }
        if kind == "account-transfer" && event.get("fromAccountId") == event.get("toAccountId") {
            return Err(AppError::Validation(
                "transfer accounts must be different".into(),
            ));
        }
        if kind == "asset-purchase" {
            if event
                .get("name")
                .and_then(|x| x.as_str())
                .is_none_or(|x| x.trim().is_empty())
            {
                return Err(AppError::Validation("asset name is required".into()));
            }
            if let Some(financing) = event.get("financing") {
                for key in ["principalCents", "minimumPaymentCents"] {
                    if !json_i64(financing, key).is_some_and(|x| (1..=MAX_MONEY_CENTS).contains(&x))
                    {
                        return Err(AppError::Validation(format!(
                            "financing {key} must be a positive exact amount"
                        )));
                    }
                }
                let rate = json_i64(financing, "annualRateBps").ok_or_else(|| {
                    AppError::Validation("financing annual rate is required".into())
                })?;
                if !(-10000..=100000).contains(&rate) {
                    return Err(AppError::Validation(
                        "financing annual rate is invalid".into(),
                    ));
                }
                if financing
                    .get("name")
                    .and_then(|x| x.as_str())
                    .is_none_or(|x| x.trim().is_empty())
                {
                    return Err(AppError::Validation("financing name is required".into()));
                }
            }
        }
        if kind == "asset-sale" {
            if let Some(payoff) = event.get("payoff") {
                let mode = payoff
                    .get("mode")
                    .and_then(|x| x.as_str())
                    .ok_or_else(|| AppError::Validation("payoff mode is required".into()))?;
                if !["none", "partial", "full"].contains(&mode) {
                    return Err(AppError::Validation("payoff mode is invalid".into()));
                }
                if mode != "none"
                    && payoff
                        .get("liabilityId")
                        .and_then(|x| x.as_str())
                        .is_none_or(str::is_empty)
                {
                    return Err(AppError::Validation("payoff liability is required".into()));
                }
                if mode == "partial"
                    && !json_i64(payoff, "amountCents")
                        .is_some_and(|x| (1..=MAX_MONEY_CENTS).contains(&x))
                {
                    return Err(AppError::Validation(
                        "partial payoff amount must be positive".into(),
                    ));
                }
            }
        }
    }
    let mut allocation_ids = HashSet::new();
    let mut allocation_accounts = HashSet::new();
    for (index, rule) in input.allocations.iter().enumerate() {
        let account = rule
            .get("accountId")
            .and_then(|x| x.as_str())
            .filter(|x| !x.is_empty())
            .ok_or_else(|| AppError::Validation("allocation account is required".into()))?;
        if !allocation_accounts.insert(account) {
            return Err(AppError::Validation(
                "allocation accounts must be unique".into(),
            ));
        }
        if let Some(id) = rule.get("id").and_then(|x| x.as_str()) {
            if !allocation_ids.insert(id) {
                return Err(AppError::Validation("allocation ids must be unique".into()));
            }
        }
        if json_i64(rule, "priority") != Some(index as i64 + 1) {
            return Err(AppError::Validation(
                "allocation priorities must be contiguous and ordered".into(),
            ));
        }
        let percent = json_i64(rule, "percentBps")
            .ok_or_else(|| AppError::Validation("allocation percentage is required".into()))?;
        if !(0..=10000).contains(&percent) {
            return Err(AppError::Validation(
                "allocation percentage is invalid".into(),
            ));
        }
        if json_i64(rule, "targetBalanceCents").is_some_and(|x| !(0..=MAX_MONEY_CENTS).contains(&x))
        {
            return Err(AppError::Validation(
                "allocation target balance is invalid".into(),
            ));
        }
    }
    if !input.allocations.is_empty()
        && input
            .allocations
            .last()
            .and_then(|v| json_i64(v, "percentBps"))
            != Some(10000)
    {
        return Err(AppError::Validation(
            "final allocation must be a 100% catch-all".into(),
        ));
    }
    Ok(())
}
#[tauri::command]
fn update_scenario(
    input: ScenarioUpdateInput,
    database: tauri::State<Database>,
) -> Result<(), AppError> {
    with_db(&database, |db| {
        let name = scenario_name(&input.name)?;
        validate_scenario_update(&input)?;
        let tx = db.transaction()?;
        let (baseline, household_id): (bool, String) = tx
            .query_row(
                "SELECT is_baseline,household_id FROM scenarios WHERE id=?",
                [&input.id],
                |r| Ok((r.get::<_, i64>(0)? != 0, r.get(1)?)),
            )
            .map_err(|_| AppError::Conflict)?;
        if baseline && name != "Baseline" {
            return Err(AppError::Validation(
                "the baseline scenario cannot be renamed".into(),
            ));
        }
        let duplicate: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM scenarios current JOIN scenarios other ON other.household_id=current.household_id WHERE current.id=?1 AND other.id<>current.id AND other.name=?2 COLLATE NOCASE)",
            params![input.id, name],
            |r| r.get(0),
        )?;
        if duplicate {
            return Err(AppError::Validation(
                "a scenario with this name already exists".into(),
            ));
        }
        let owns = |table: &str, id: &str| -> Result<bool, AppError> {
            if !["accounts", "recurring_entries", "assets", "liabilities"].contains(&table) {
                return Ok(false);
            }
            Ok(tx.query_row(
                &format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE id=?1 AND household_id=?2)"),
                params![id, household_id],
                |r| r.get(0),
            )?)
        };
        let mut ordered = input.events.iter().collect::<Vec<_>>();
        ordered.sort_by_key(|e| {
            (
                e.get("date").and_then(|x| x.as_str()).unwrap_or(""),
                e.get("id").and_then(|x| x.as_str()).unwrap_or(""),
            )
        });
        let mut created_assets: HashMap<&str, &str> = HashMap::new();
        let mut created_debts: HashMap<&str, &str> = HashMap::new();
        for event in ordered {
            let date = event["date"].as_str().unwrap();
            let in_horizon:bool=tx.query_row("SELECT date(?1)>=date('now','start of month') AND date(?1)<date('now','start of month',?2)",params![date,format!("+{} months",input.horizon_months)],|r|r.get(0))?;
            if !in_horizon {
                return Err(AppError::Validation(
                    "event date must be within the active projection horizon".into(),
                ));
            }
            let kind = event["type"].as_str().unwrap();
            let account_keys: &[&str] = match kind {
                "account-transfer" => &["fromAccountId", "toAccountId"],
                "account-contribution" => &["accountId"],
                "asset-purchase" => &["fundingAccountId"],
                "asset-sale" => &["destinationAccountId"],
                "debt-origination" | "debt-payoff" => &["accountId"],
                _ => &[],
            };
            for key in account_keys {
                let id = event.get(key).and_then(|x| x.as_str()).unwrap_or("");
                if !owns("accounts", id)? {
                    return Err(AppError::Validation(format!(
                        "{key} does not belong to this household"
                    )));
                }
            }
            if matches!(kind, "recurring-change" | "income-change") {
                let id = event.get("entryId").and_then(|x| x.as_str()).unwrap_or("");
                if !owns("recurring_entries", id)? {
                    return Err(AppError::Validation(
                        "recurring entry does not belong to this household".into(),
                    ));
                }
            }
            if kind == "asset-sale" {
                let id = event.get("assetId").and_then(|x| x.as_str()).unwrap_or("");
                if !created_assets
                    .get(id)
                    .is_some_and(|created| *created < date)
                    && !owns("assets", id)?
                {
                    return Err(AppError::Validation("asset sale must reference an existing asset or a strictly earlier purchase".into()));
                }
                if let Some(payoff) = event
                    .get("payoff")
                    .filter(|x| x.get("mode").and_then(|v| v.as_str()) != Some("none"))
                {
                    let liability_id = payoff
                        .get("liabilityId")
                        .and_then(|x| x.as_str())
                        .unwrap_or("");
                    if !created_debts
                        .get(liability_id)
                        .is_some_and(|created| *created < date)
                        && !owns("liabilities", liability_id)?
                    {
                        return Err(AppError::Validation("sale payoff must reference an existing liability or a strictly earlier origination".into()));
                    }
                }
            }
            if kind == "debt-payoff" {
                let id = event
                    .get("liabilityId")
                    .and_then(|x| x.as_str())
                    .unwrap_or("");
                if !created_debts.get(id).is_some_and(|created| *created < date)
                    && !owns("liabilities", id)?
                {
                    return Err(AppError::Validation("debt payoff must reference an existing liability or a strictly earlier origination".into()));
                }
            }
            if kind == "asset-purchase" {
                let id = event.get("assetId").and_then(|x| x.as_str()).unwrap_or("");
                if id.is_empty() || owns("assets", id)? || created_assets.insert(id, date).is_some()
                {
                    return Err(AppError::Validation("asset ids must be unique".into()));
                }
                if let Some(financing) = event.get("financing") {
                    let id = financing
                        .get("liabilityId")
                        .and_then(|x| x.as_str())
                        .unwrap_or("");
                    if id.is_empty()
                        || owns("liabilities", id)?
                        || created_debts.insert(id, date).is_some()
                    {
                        return Err(AppError::Validation("liability ids must be unique".into()));
                    }
                }
            }
            if kind == "debt-origination" {
                let id = event
                    .get("liabilityId")
                    .and_then(|x| x.as_str())
                    .unwrap_or("");
                if id.is_empty()
                    || owns("liabilities", id)?
                    || created_debts.insert(id, date).is_some()
                {
                    return Err(AppError::Validation("liability ids must be unique".into()));
                }
            }
        }
        let n=tx.execute("UPDATE scenarios SET name=?2,assumptions_json=?3,horizon_months=?4,revision=revision+1 WHERE id=?1 AND revision=?5",params![input.id,name,serde_json::to_string(&input.assumptions)?,input.horizon_months,input.expected_revision])?;
        if n == 0 {
            return Err(AppError::Conflict);
        }
        tx.execute(
            "DELETE FROM scenario_events WHERE scenario_id=?",
            [&input.id],
        )?;
        for event in input.events {
            let id = event
                .get("id")
                .and_then(|x| x.as_str())
                .ok_or_else(|| AppError::Validation("event id is required".into()))?;
            let date = event
                .get("date")
                .and_then(|x| x.as_str())
                .ok_or_else(|| AppError::Validation("event date is required".into()))?;
            let kind = event
                .get("type")
                .and_then(|x| x.as_str())
                .ok_or_else(|| AppError::Validation("event type is required".into()))?;
            if !valid_iso_date(date) {
                return Err(AppError::Validation("event date is invalid".into()));
            }
            tx.execute("INSERT INTO scenario_events(id,scenario_id,event_date,kind,payload_json) VALUES(?1,?2,?3,?4,?5)",params![id,input.id,date,kind,serde_json::to_string(&event)?])?;
        }
        tx.execute("DELETE FROM allocations WHERE scenario_id=?", [&input.id])?;
        for (index, rule) in input.allocations.iter().enumerate() {
            let account = rule
                .get("accountId")
                .and_then(|x| x.as_str())
                .ok_or_else(|| AppError::Validation("allocation account is required".into()))?;
            let priority = json_i64(rule, "priority").unwrap_or(index as i64 + 1);
            let percent = json_i64(rule, "percentBps")
                .ok_or_else(|| AppError::Validation("allocation percentage is required".into()))?;
            let target = json_i64(rule, "targetBalanceCents");
            if !(0..=10000).contains(&percent)
                || target.is_some_and(|x| !(0..=MAX_MONEY_CENTS).contains(&x))
            {
                return Err(AppError::Validation("invalid allocation".into()));
            }
            let inserted=tx.execute("INSERT INTO allocations(id,scenario_id,account_id,priority,percent_bps,target_balance_cents) SELECT ?1,?2,?3,?4,?5,?6 WHERE EXISTS(SELECT 1 FROM accounts a JOIN scenarios s ON s.household_id=a.household_id WHERE a.id=?3 AND s.id=?2)",params![rule.get("id").and_then(|x|x.as_str()).map(str::to_owned).unwrap_or_else(||format!("{}-{index}",input.id)),input.id,account,priority,percent,target])?;
            if inserted != 1 {
                return Err(AppError::Validation(
                    "allocation account does not belong to this household".into(),
                ));
            }
        }
        tx.commit()?;
        Ok(())
    })
}
#[tauri::command]
fn delete_scenario(input: DeleteInput, database: tauri::State<Database>) -> Result<(), AppError> {
    with_db(&database, |db| {
        let tx = db.transaction()?;
        let baseline: bool = tx
            .query_row(
                "SELECT is_baseline FROM scenarios WHERE id=? AND revision=?",
                params![input.id, input.expected_revision],
                |r| Ok(r.get::<_, i64>(0)? != 0),
            )
            .map_err(|_| AppError::Conflict)?;
        if baseline {
            return Err(AppError::Validation(
                "the baseline scenario cannot be deleted".into(),
            ));
        }
        tx.execute(
            "DELETE FROM scenario_events WHERE scenario_id=?",
            [&input.id],
        )?;
        tx.execute("DELETE FROM allocations WHERE scenario_id=?", [&input.id])?;
        tx.execute("DELETE FROM scenarios WHERE id=?", [&input.id])?;
        tx.commit()?;
        Ok(())
    })
}

fn insert_transaction(db: &mut Connection, input: &TransactionInput) -> Result<(), AppError> {
    validate_entry(input.amount_cents, &input.occurred_on, &input.description)?;
    let tx = db.transaction()?;
    let (hid, kind) = validate_transaction_refs(&tx, &input.account_id, &input.category_id)?;
    tx.execute("INSERT INTO transaction_entries(id,household_id,occurred_on,kind,description,note) VALUES(?1,?2,?3,?4,?5,?6)",params![input.id,hid,input.occurred_on,kind,input.description.trim(),input.note.as_ref().map(|x|x.trim()).filter(|x|!x.is_empty())])?;
    tx.execute(
        "INSERT INTO postings(entry_id,account_id,category_id,amount_cents) VALUES(?1,?2,?3,?4)",
        params![
            input.id,
            input.account_id,
            input.category_id,
            signed_amount(&kind, input.amount_cents)?
        ],
    )?;
    tx.commit()?;
    Ok(())
}

fn validate_entry(amount: i64, date: &str, description: &str) -> Result<(), AppError> {
    if amount <= 0 || amount > MAX_MONEY_CENTS {
        return Err(AppError::Validation(
            "amount must be a positive value within the supported money range".into(),
        ));
    }
    validate_date(date)?;
    if description.trim().is_empty() {
        return Err(AppError::Validation("description is required".into()));
    }
    Ok(())
}
fn validate_date(value: &str) -> Result<(), AppError> {
    let p: Vec<_> = value.split('-').collect();
    let (y, m, d) = if p.len() == 3 {
        (
            p[0].parse::<i32>(),
            p[1].parse::<u32>(),
            p[2].parse::<u32>(),
        )
    } else {
        (Err("".parse::<i32>().unwrap_err()), Ok(0), Ok(0))
    };
    let (y, m, d) = match (y, m, d) {
        (Ok(y), Ok(m), Ok(d)) => (y, m, d),
        _ => {
            return Err(AppError::Validation(
                "date must be a valid calendar date".into(),
            ))
        }
    };
    let leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    let days = [
        0,
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    if value.len() != 10 || !(1..=12).contains(&m) || d < 1 || d > days[m as usize] {
        return Err(AppError::Validation(
            "date must be a valid calendar date".into(),
        ));
    }
    Ok(())
}
fn active_household(db: &Connection) -> Result<String, AppError> {
    db.query_row("SELECT id FROM households LIMIT 1", [], |r| r.get(0))
        .map_err(|_| AppError::Validation("household is required".into()))
}
fn validate_transaction_refs(
    db: &Connection,
    account: &str,
    category: &str,
) -> Result<(String, String), AppError> {
    let active = active_household(db)?;
    let ah: String = db
        .query_row(
            "SELECT household_id FROM accounts WHERE id=?",
            [account],
            |r| r.get(0),
        )
        .map_err(|_| AppError::Validation("account does not belong to this household".into()))?;
    let (ch, kind): (Option<String>, String) = db
        .query_row(
            "SELECT household_id,kind FROM categories WHERE id=?",
            [category],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| AppError::Validation("category does not belong to this household".into()))?;
    if ah != active || ch.as_deref().is_some_and(|x| x != active) {
        return Err(AppError::Validation(
            "account and category must belong to this household".into(),
        ));
    }
    if !matches!(kind.as_str(), "income" | "expense") {
        return Err(AppError::Validation(
            "category must match income or expense".into(),
        ));
    }
    Ok((active, kind))
}
fn signed_amount(kind: &str, amount: i64) -> Result<i64, AppError> {
    match kind {
        "income" => Ok(amount),
        "expense" => Ok(-amount),
        _ => Err(AppError::Validation(
            "use the transfer command for transfers".into(),
        )),
    }
}
fn validate_transfer(db: &Connection, input: &TransferInput) -> Result<String, AppError> {
    validate_entry(input.amount_cents, &input.occurred_on, "Transfer")?;
    if input.from_account_id == input.to_account_id {
        return Err(AppError::Validation(
            "transfer must use distinct accounts".into(),
        ));
    }
    let active = active_household(db)?;
    for id in [&input.from_account_id, &input.to_account_id] {
        let h: String = db
            .query_row("SELECT household_id FROM accounts WHERE id=?", [id], |r| {
                r.get(0)
            })
            .map_err(|_| {
                AppError::Validation("transfer account does not belong to this household".into())
            })?;
        if h != active {
            return Err(AppError::Validation(
                "transfer accounts must belong to this household".into(),
            ));
        }
    }
    Ok(active)
}
#[tauri::command]
fn update_settings(
    input: SettingsInput,
    database: tauri::State<Database>,
) -> Result<Settings, AppError> {
    if !matches!(input.theme.as_str(), "system" | "light" | "dark") {
        return Err(AppError::Validation(
            "theme must be system, light, or dark".into(),
        ));
    }
    with_db(&database, |db| {
        let hid: String = db.query_row("SELECT id FROM households LIMIT 1", [], |r| r.get(0))?;
        db.execute(
            "INSERT OR IGNORE INTO settings(household_id) VALUES(?)",
            [&hid],
        )?;
        let changed=db.execute("UPDATE settings SET theme=?1,reduced_motion=?2,revision=revision+1 WHERE household_id=?3 AND revision=?4",params![input.theme,input.reduced_motion,hid,input.expected_revision])?;
        if changed == 0 {
            return Err(AppError::Conflict);
        }
        db.query_row(
            "SELECT theme,reduced_motion,revision FROM settings WHERE household_id=?",
            [hid],
            |r| {
                Ok(Settings {
                    theme: r.get(0)?,
                    reduced_motion: r.get::<_, i64>(1)? != 0,
                    revision: r.get(2)?,
                })
            },
        )
        .map_err(AppError::from)
    })
}
#[tauri::command]
fn create_transaction(
    input: TransactionInput,
    database: tauri::State<Database>,
) -> Result<(), AppError> {
    with_db(&database, |db| insert_transaction(db, &input))
}
#[tauri::command]
fn create_transfer(input: TransferInput, database: tauri::State<Database>) -> Result<(), AppError> {
    with_db(&database, |db| {
        let tx = db.transaction()?;
        let hid = validate_transfer(&tx, &input)?;
        tx.execute("INSERT INTO transaction_entries(id,household_id,occurred_on,kind,description,transfer_group_id) VALUES(?1,?2,?3,'transfer','Transfer',?1)",params![input.id,hid,input.occurred_on])?;
        tx.execute(
            "INSERT INTO postings(entry_id,account_id,amount_cents) VALUES(?1,?2,?3)",
            params![input.id, input.from_account_id, -input.amount_cents],
        )?;
        tx.execute(
            "INSERT INTO postings(entry_id,account_id,amount_cents) VALUES(?1,?2,?3)",
            params![input.id, input.to_account_id, input.amount_cents],
        )?;
        tx.commit()?;
        Ok(())
    })
}

#[tauri::command]
fn update_transaction(
    input: UpdateTransactionInput,
    database: tauri::State<Database>,
) -> Result<(), AppError> {
    with_db(&database, |db| {
        validate_entry(input.amount_cents, &input.occurred_on, &input.description)?;
        let tx = db.transaction()?;
        let (_, kind) = validate_transaction_refs(&tx, &input.account_id, &input.category_id)?;
        let existing: (String, Option<String>, i64) = tx
            .query_row(
                "SELECT kind,import_batch_id,revision FROM transaction_entries WHERE id=?",
                [&input.id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .map_err(|_| AppError::Validation("transaction was not found".into()))?;
        if existing.1.is_some() {
            return Err(AppError::Validation(
                "imported transactions cannot be edited".into(),
            ));
        }
        if existing.0 == "transfer" || existing.0 == "adjustment" {
            return Err(AppError::Validation(
                "this entry cannot be changed into an ordinary transaction".into(),
            ));
        }
        if existing.2 != input.expected_revision {
            return Err(AppError::Conflict);
        }
        tx.execute("UPDATE transaction_entries SET occurred_on=?1,kind=?2,description=?3,note=?4,revision=revision+1 WHERE id=?5 AND revision=?6",params![input.occurred_on,kind,input.description.trim(),input.note.as_ref().map(|x|x.trim()).filter(|x|!x.is_empty()),input.id,input.expected_revision])?;
        tx.execute("DELETE FROM postings WHERE entry_id=?", [&input.id])?;
        tx.execute("INSERT INTO postings(entry_id,account_id,category_id,amount_cents) VALUES(?1,?2,?3,?4)",params![input.id,input.account_id,input.category_id,signed_amount(&kind,input.amount_cents)?])?;
        tx.commit()?;
        Ok(())
    })
}

#[tauri::command]
fn update_transfer(input: TransferInput, database: tauri::State<Database>) -> Result<(), AppError> {
    with_db(&database, |db| {
        let tx = db.transaction()?;
        validate_transfer(&tx, &input)?;
        let (kind, imported, revision): (String, Option<String>, i64) = tx
            .query_row(
                "SELECT kind,import_batch_id,revision FROM transaction_entries WHERE id=?",
                [&input.id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .map_err(|_| AppError::Validation("transfer was not found".into()))?;
        if imported.is_some() {
            return Err(AppError::Validation(
                "imported transactions cannot be edited".into(),
            ));
        }
        if kind != "transfer" {
            return Err(AppError::Validation(
                "ordinary transactions cannot be changed into transfers".into(),
            ));
        }
        if Some(revision) != input.expected_revision {
            return Err(AppError::Conflict);
        }
        tx.execute("UPDATE transaction_entries SET occurred_on=?1,revision=revision+1 WHERE id=?2 AND revision=?3",params![input.occurred_on,input.id,revision])?;
        tx.execute("DELETE FROM postings WHERE entry_id=?", [&input.id])?;
        tx.execute(
            "INSERT INTO postings(entry_id,account_id,amount_cents) VALUES(?1,?2,?3)",
            params![input.id, input.from_account_id, -input.amount_cents],
        )?;
        tx.execute(
            "INSERT INTO postings(entry_id,account_id,amount_cents) VALUES(?1,?2,?3)",
            params![input.id, input.to_account_id, input.amount_cents],
        )?;
        tx.commit()?;
        Ok(())
    })
}
#[tauri::command]
fn delete_transaction(
    input: DeleteInput,
    database: tauri::State<Database>,
) -> Result<(), AppError> {
    with_db(&database, |db| delete_transaction_from(db, &input))
}
fn delete_transaction_from(db: &mut Connection, input: &DeleteInput) -> Result<(), AppError> {
    let tx = db.transaction()?;
    let hid = active_household(&tx)?;
    let (kind, revision): (String, i64) = tx
        .query_row(
            "SELECT kind,revision FROM transaction_entries WHERE id=?1 AND household_id=?2",
            params![input.id, hid],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| AppError::Validation("transaction was not found".into()))?;
    if kind == "adjustment" {
        return Err(AppError::Validation(
            "reconciliation adjustments cannot be deleted".into(),
        ));
    }
    if revision != input.expected_revision {
        return Err(AppError::Conflict);
    }
    tx.execute("DELETE FROM postings WHERE entry_id=?", [&input.id])?;
    let changed = tx.execute(
        "DELETE FROM transaction_entries WHERE id=?1 AND household_id=?2 AND revision=?3",
        params![input.id, hid, input.expected_revision],
    )?;
    if changed == 0 {
        return Err(AppError::Conflict);
    }
    tx.commit()?;
    Ok(())
}
fn account_properties(kind: &str) -> Result<bool, AppError> {
    match kind {
        "checking" | "savings" => Ok(true),
        "investment" | "retirement" | "credit" => Ok(false),
        _ => Err(AppError::Validation("choose a valid account type".into())),
    }
}
fn stored_balance(kind: &str, value: i64) -> Result<i64, AppError> {
    if value.abs() > MAX_MONEY_CENTS {
        return Err(AppError::Validation(
            "balance is outside the supported money range".into(),
        ));
    }
    Ok(if kind == "credit" {
        -value.abs()
    } else {
        value
    })
}
#[tauri::command]
fn create_account(input: AccountInput, database: tauri::State<Database>) -> Result<(), AppError> {
    with_db(&database, |db| {
        if input.name.trim().is_empty() {
            return Err(AppError::Validation("account name is required".into()));
        }
        let hid = active_household(db)?;
        let liquid = account_properties(&input.kind)?;
        let balance = stored_balance(&input.kind, input.opening_balance_cents)?;
        db.execute("INSERT INTO accounts(id,household_id,name,kind,opening_balance_cents,liquid) VALUES(?1,?2,?3,?4,?5,?6)",params![input.id,hid,input.name.trim(),input.kind,balance,liquid])?;
        Ok(())
    })
}
#[tauri::command]
fn update_account(
    input: UpdateAccountInput,
    database: tauri::State<Database>,
) -> Result<(), AppError> {
    with_db(&database, |db| {
        if input.name.trim().is_empty() {
            return Err(AppError::Validation("account name is required".into()));
        }
        let hid = active_household(db)?;
        let liquid = account_properties(&input.kind)?;
        let changed=db.execute("UPDATE accounts SET name=?1,kind=?2,liquid=?3,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=?4 AND household_id=?5 AND revision=?6",params![input.name.trim(),input.kind,liquid,input.id,hid,input.expected_revision])?;
        if changed == 0 {
            return Err(AppError::Conflict);
        }
        Ok(())
    })
}
fn account_impact(db: &Connection, account_id: &str) -> Result<AccountDeletionImpact, AppError> {
    let hid = active_household(db)?;
    let exists: i64 = db.query_row(
        "SELECT count(*) FROM accounts WHERE id=?1 AND household_id=?2",
        params![account_id, hid],
        |r| r.get(0),
    )?;
    if exists == 0 {
        return Err(AppError::Validation(
            "account does not belong to this household".into(),
        ));
    }
    let mut blockers = Vec::new();
    let accounts: i64 = db.query_row(
        "SELECT count(*) FROM accounts WHERE household_id=?",
        [&hid],
        |r| r.get(0),
    )?;
    if accounts <= 1 {
        blockers.push("This is the household's last account.".into())
    }
    let opening_balance: i64 = db.query_row(
        "SELECT opening_balance_cents FROM accounts WHERE id=?",
        [account_id],
        |r| r.get(0),
    )?;
    if opening_balance != 0 {
        blockers.push("The account has a non-zero opening balance.".into())
    }
    let postings: i64 = db.query_row(
        "SELECT count(*) FROM postings WHERE account_id=?",
        [account_id],
        |r| r.get(0),
    )?;
    if postings > 0 {
        blockers.push("The account has transactions or reconciliation history.".into())
    }
    let imports: i64 = db.query_row(
        "SELECT count(*) FROM import_batches WHERE account_id=?",
        [account_id],
        |r| r.get(0),
    )?;
    if imports > 0 {
        blockers.push("The account has import batch history.".into())
    }
    let recurring: i64 = db.query_row(
        "SELECT count(*) FROM recurring_entries WHERE account_id=?",
        [account_id],
        |r| r.get(0),
    )?;
    if recurring > 0 {
        blockers.push("The account is used by recurring entries.".into())
    }
    let allocations: i64 = db.query_row(
        "SELECT count(*) FROM allocations WHERE account_id=?",
        [account_id],
        |r| r.get(0),
    )?;
    if allocations > 0 {
        blockers.push("The account is used by scenario allocations.".into())
    }
    Ok(AccountDeletionImpact {
        account_id: account_id.into(),
        can_delete: blockers.is_empty(),
        blockers,
    })
}
#[tauri::command]
fn account_deletion_impact(
    account_id: String,
    database: tauri::State<Database>,
) -> Result<AccountDeletionImpact, AppError> {
    with_db(&database, |db| account_impact(db, &account_id))
}
#[tauri::command]
fn delete_account(input: DeleteInput, database: tauri::State<Database>) -> Result<(), AppError> {
    with_db(&database, |db| delete_account_from(db, &input))
}
fn delete_account_from(db: &mut Connection, input: &DeleteInput) -> Result<(), AppError> {
    let impact = account_impact(db, &input.id)?;
    if !impact.can_delete {
        return Err(AppError::Validation(impact.blockers.join(" ")));
    }
    let hid = active_household(db)?;
    let changed = db.execute(
        "DELETE FROM accounts WHERE id=?1 AND household_id=?2 AND revision=?3",
        params![input.id, hid, input.expected_revision],
    )?;
    if changed == 0 {
        return Err(AppError::Conflict);
    }
    Ok(())
}
fn validate_rate(value: i64, minimum: i64, label: &str) -> Result<(), AppError> {
    if !(minimum..=100_000).contains(&value) {
        return Err(AppError::Validation(format!(
            "{label} must be between {}% and 1000%",
            minimum / 100
        )));
    }
    Ok(())
}
fn validate_nonnegative_money(value: i64, label: &str) -> Result<(), AppError> {
    if !(0..=MAX_MONEY_CENTS).contains(&value) {
        return Err(AppError::Validation(format!(
            "{label} is outside the supported money range"
        )));
    }
    Ok(())
}
fn calculated_mortgage_payment(principal: i64, rate_bps: i64, months: i64) -> i64 {
    if rate_bps == 0 {
        return ((principal as f64) / (months as f64)).round() as i64;
    }
    let rate = rate_bps as f64 / 120_000.0;
    ((principal as f64 * rate) / (1.0 - (1.0 + rate).powi(-(months as i32)))).round() as i64
}
fn validate_liability(input: &LiabilityInput) -> Result<(i64, Option<String>), AppError> {
    if input.name.trim().is_empty() {
        return Err(AppError::Validation("liability name is required".into()));
    }
    validate_nonnegative_money(input.balance_cents, "balance")?;
    validate_rate(input.annual_rate_bps, 0, "annual rate")?;
    let (payment, mortgage_json) = if let Some(mortgage) = &input.mortgage {
        validate_nonnegative_money(mortgage.original_principal_cents, "original principal")?;
        if mortgage.original_principal_cents == 0 {
            return Err(AppError::Validation(
                "original principal must be positive".into(),
            ));
        }
        if input.balance_cents > mortgage.original_principal_cents {
            return Err(AppError::Validation(
                "current balance cannot exceed original principal".into(),
            ));
        }
        if !(1..=480).contains(&mortgage.term_months) {
            return Err(AppError::Validation(
                "mortgage term must be between 1 and 480 months".into(),
            ));
        }
        validate_date(&mortgage.start_date)?;
        if let Some(override_cents) = mortgage.payment_override_cents {
            validate_nonnegative_money(override_cents, "payment override")?;
            if override_cents == 0 {
                return Err(AppError::Validation(
                    "payment override must be positive".into(),
                ));
            }
        }
        let payment = mortgage.payment_override_cents.unwrap_or_else(|| {
            calculated_mortgage_payment(
                mortgage.original_principal_cents,
                input.annual_rate_bps,
                mortgage.term_months,
            )
        });
        (
            payment,
            Some(
                serde_json::to_string(mortgage)
                    .map_err(|_| AppError::Validation("could not save mortgage terms".into()))?,
            ),
        )
    } else {
        validate_nonnegative_money(input.minimum_payment_cents, "minimum payment")?;
        (input.minimum_payment_cents, None)
    };
    if input.balance_cents > 0 && payment <= 0 {
        return Err(AppError::Validation(
            "a nonzero liability requires a positive monthly payment".into(),
        ));
    }
    Ok((payment, mortgage_json))
}
fn save_asset(db: &Connection, input: &AssetInput, update: bool) -> Result<(), AppError> {
    if input.name.trim().is_empty() {
        return Err(AppError::Validation("asset name is required".into()));
    }
    validate_nonnegative_money(input.value_cents, "asset value")?;
    validate_rate(input.annual_growth_bps, -10_000, "annual growth")?;
    let hid = active_household(db)?;
    if update {
        let changed = db.execute("UPDATE assets SET name=?1,value_cents=?2,annual_growth_bps=?3,revision=revision+1 WHERE id=?4 AND household_id=?5 AND revision=?6",params![input.name.trim(),input.value_cents,input.annual_growth_bps,input.id,hid,input.expected_revision.ok_or(AppError::Conflict)?])?;
        if changed == 0 {
            return Err(AppError::Conflict);
        }
    } else {
        db.execute("INSERT INTO assets(id,household_id,name,value_cents,annual_growth_bps) VALUES(?1,?2,?3,?4,?5)",params![input.id,hid,input.name.trim(),input.value_cents,input.annual_growth_bps])?;
    }
    Ok(())
}
#[tauri::command]
fn create_asset(input: AssetInput, database: tauri::State<Database>) -> Result<(), AppError> {
    with_db(&database, |db| save_asset(db, &input, false))
}
#[tauri::command]
fn update_asset(input: AssetInput, database: tauri::State<Database>) -> Result<(), AppError> {
    with_db(&database, |db| save_asset(db, &input, true))
}
#[tauri::command]
fn delete_asset(input: DeleteInput, database: tauri::State<Database>) -> Result<(), AppError> {
    with_db(&database, |db| delete_asset_from(db, &input))
}
fn delete_asset_from(db: &Connection, input: &DeleteInput) -> Result<(), AppError> {
    let hid = active_household(db)?;
    let changed = db.execute(
        "DELETE FROM assets WHERE id=?1 AND household_id=?2 AND revision=?3",
        params![input.id, hid, input.expected_revision],
    )?;
    if changed == 0 {
        return Err(AppError::Conflict);
    }
    Ok(())
}
fn save_liability(db: &Connection, input: &LiabilityInput, update: bool) -> Result<(), AppError> {
    let (payment, mortgage_json) = validate_liability(input)?;
    let hid = active_household(db)?;
    if update {
        let changed=db.execute("UPDATE liabilities SET name=?1,balance_cents=?2,annual_rate_bps=?3,minimum_payment_cents=?4,mortgage_json=?5,revision=revision+1 WHERE id=?6 AND household_id=?7 AND revision=?8",params![input.name.trim(),input.balance_cents,input.annual_rate_bps,payment,mortgage_json,input.id,hid,input.expected_revision.ok_or(AppError::Conflict)?])?;
        if changed == 0 {
            return Err(AppError::Conflict);
        }
    } else {
        db.execute("INSERT INTO liabilities(id,household_id,name,balance_cents,annual_rate_bps,minimum_payment_cents,mortgage_json) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![input.id,hid,input.name.trim(),input.balance_cents,input.annual_rate_bps,payment,mortgage_json])?;
    }
    Ok(())
}
#[tauri::command]
fn create_liability(
    input: LiabilityInput,
    database: tauri::State<Database>,
) -> Result<(), AppError> {
    with_db(&database, |db| save_liability(db, &input, false))
}
#[tauri::command]
fn update_liability(
    input: LiabilityInput,
    database: tauri::State<Database>,
) -> Result<(), AppError> {
    with_db(&database, |db| save_liability(db, &input, true))
}
#[tauri::command]
fn delete_liability(input: DeleteInput, database: tauri::State<Database>) -> Result<(), AppError> {
    with_db(&database, |db| delete_liability_from(db, &input))
}
fn delete_liability_from(db: &Connection, input: &DeleteInput) -> Result<(), AppError> {
    let hid = active_household(db)?;
    let changed = db.execute(
        "DELETE FROM liabilities WHERE id=?1 AND household_id=?2 AND revision=?3",
        params![input.id, hid, input.expected_revision],
    )?;
    if changed == 0 {
        return Err(AppError::Conflict);
    }
    Ok(())
}
#[tauri::command]
fn reconcile_account(
    input: ReconcileAccountInput,
    database: tauri::State<Database>,
) -> Result<(), AppError> {
    with_db(&database, |db| {
        validate_date(&input.occurred_on)?;
        if input.target_balance_cents.abs() > MAX_MONEY_CENTS {
            return Err(AppError::Validation(
                "balance is outside the supported money range".into(),
            ));
        }
        let tx = db.transaction()?;
        let hid = active_household(&tx)?;
        let current:i64=tx.query_row("SELECT b.balance_cents FROM account_balances b JOIN accounts a ON a.id=b.id WHERE a.id=?1 AND a.household_id=?2",params![input.id,hid],|r|r.get(0)).map_err(|_|AppError::Validation("account does not belong to this household".into()))?;
        if current != input.expected_balance_cents {
            return Err(AppError::Conflict);
        }
        let difference = input.target_balance_cents - current;
        if difference != 0 {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            let eid = format!("adjustment-{}-{nonce}", input.id);
            tx.execute("INSERT INTO transaction_entries(id,household_id,occurred_on,kind,description) VALUES(?1,?2,?3,'adjustment','Balance reconciliation')",params![eid,hid,input.occurred_on])?;
            tx.execute(
                "INSERT INTO postings(entry_id,account_id,amount_cents) VALUES(?1,?2,?3)",
                params![eid, input.id, difference],
            )?;
        }
        tx.commit()?;
        Ok(())
    })
}

fn csv_bytes(path: &str) -> Result<(Vec<u8>, String), AppError> {
    let meta = fs::metadata(path)?;
    if meta.len() > 10 * 1024 * 1024 {
        return Err(AppError::Validation(
            "CSV files must be 10 MiB or smaller".into(),
        ));
    }
    let bytes = fs::read(path)?;
    std::str::from_utf8(&bytes)
        .map_err(|_| AppError::Validation("CSV must use UTF-8 encoding".into()))?;
    let hash = format!("{:x}", Sha256::digest(&bytes));
    Ok((bytes, hash))
}
fn csv_reader(bytes: &[u8]) -> csv::Reader<&[u8]> {
    csv::ReaderBuilder::new()
        .flexible(false)
        .trim(csv::Trim::All)
        .from_reader(bytes)
}
fn csv_headers(bytes: &[u8]) -> Result<(Vec<String>, usize), AppError> {
    let mut rdr = csv_reader(bytes);
    let headers = rdr
        .headers()
        .map_err(|e| AppError::Validation(format!("Malformed CSV header: {e}")))?
        .iter()
        .map(|x| x.trim_start_matches('\u{feff}').to_string())
        .collect::<Vec<_>>();
    if headers.is_empty() || headers.iter().all(|x| x.is_empty()) {
        return Err(AppError::Validation("CSV has no header row".into()));
    }
    let normalized = headers
        .iter()
        .map(|x| x.trim().to_lowercase())
        .collect::<Vec<_>>();
    if normalized.iter().any(|x| x.is_empty()) {
        return Err(AppError::Validation(
            "CSV headers must all have names".into(),
        ));
    }
    let unique = normalized.iter().collect::<std::collections::HashSet<_>>();
    if unique.len() != normalized.len() {
        return Err(AppError::Validation(
            "CSV headers are ambiguous after ignoring case and whitespace".into(),
        ));
    }
    let mut count = 0;
    for row in rdr.records() {
        row.map_err(|e| AppError::Validation(format!("Malformed CSV row: {e}")))?;
        count += 1;
        if count > 50_000 {
            return Err(AppError::Validation(
                "CSV may contain at most 50,000 data rows".into(),
            ));
        }
    }
    if count == 0 {
        return Err(AppError::Validation("CSV contains no data rows".into()));
    }
    Ok((headers, count))
}
fn header_signature(headers: &[String]) -> String {
    headers
        .iter()
        .map(|h| h.trim().to_lowercase())
        .collect::<Vec<_>>()
        .join("\u{1f}")
}
#[tauri::command]
fn inspect_csv(path: String, database: tauri::State<Database>) -> Result<CsvInspection, AppError> {
    let (bytes, file_hash) = csv_bytes(&path)?;
    let (headers, row_count) = csv_headers(&bytes)?;
    let sig = header_signature(&headers);
    let saved_mapping = with_db(&database, |db| {
        let hid = active_household(db)?;
        let raw:Option<String>=db.query_row("SELECT parsing_json FROM import_profiles WHERE household_id=?1 AND normalized_headers=?2",params![hid,sig],|r|r.get(0)).optional()?;
        Ok(raw.and_then(|x| serde_json::from_str(&x).ok()))
    })?;
    Ok(CsvInspection {
        path,
        file_hash,
        headers,
        row_count,
        saved_mapping,
    })
}
fn parse_csv_date(value: &str, format: &str) -> Result<String, String> {
    let iso = if format == "iso" {
        value.to_string()
    } else if format == "us" {
        let p = value.split('/').collect::<Vec<_>>();
        if p.len() != 3 {
            return Err("Invalid US date".into());
        }
        format!("{:0>4}-{:0>2}-{:0>2}", p[2], p[0], p[1])
    } else {
        return Err("Unsupported date format".into());
    };
    validate_date(&iso).map_err(|_| "Invalid calendar date".to_string())?;
    Ok(iso)
}
fn parse_csv_money(value: &str) -> Result<i64, String> {
    let mut s = value.trim().to_string();
    let parens = s.starts_with('(') && s.ends_with(')');
    if parens {
        s = s[1..s.len() - 1].to_string()
    }
    s = s.replace(['$', ','], "").trim().to_string();
    if s.is_empty() {
        return Ok(0);
    }
    let neg = s.starts_with('-') || parens;
    s = s.trim_start_matches(['+', '-']).to_string();
    let p = s.split('.').collect::<Vec<_>>();
    if p.len() > 2
        || p[0].is_empty()
        || !p.iter().all(|x| x.chars().all(|c| c.is_ascii_digit()))
        || p.get(1).is_some_and(|x| x.len() > 2)
    {
        return Err("Invalid USD amount".into());
    }
    let whole: i128 = p[0].parse().map_err(|_| "Amount is too large")?;
    let frac = if p.len() == 2 {
        p[1].parse::<i128>().unwrap_or(0) * if p[1].len() == 1 { 10 } else { 1 }
    } else {
        0
    };
    let cents = whole * 100 + frac;
    if cents > MAX_MONEY_CENTS as i128 {
        return Err("Amount is outside the supported range".into());
    }
    Ok(if neg { -(cents as i64) } else { cents as i64 })
}
fn duplicate_key(date: &str, amount: i64, description: &str) -> String {
    let normalized = description
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase();
    format!(
        "{:x}",
        Sha256::digest(format!("{date}|{amount}|{normalized}").as_bytes())
    )
}
fn make_preview(
    db: &Connection,
    path: String,
    file_hash: String,
    mapping: CsvMapping,
) -> Result<CsvPreview, AppError> {
    let (bytes, actual) = csv_bytes(&path)?;
    if actual != file_hash {
        return Err(AppError::Validation(
            "The CSV changed after selection; preview it again".into(),
        ));
    }
    let mut rdr = csv_reader(&bytes);
    let headers = rdr
        .headers()
        .map_err(|e| AppError::Validation(format!("Malformed CSV header: {e}")))?
        .iter()
        .map(|x| x.trim_start_matches('\u{feff}').to_string())
        .collect::<Vec<_>>();
    let col = |name: &str| {
        headers
            .iter()
            .position(|h| h == name)
            .ok_or_else(|| AppError::Validation(format!("CSV column '{name}' was not found")))
    };
    let di = col(&mapping.date_column)?;
    let xi = col(&mapping.description_column)?;
    let ni = mapping.note_column.as_deref().map(col).transpose()?;
    let ai = mapping.amount_column.as_deref().map(col).transpose()?;
    let debit = mapping.debit_column.as_deref().map(col).transpose()?;
    let credit = mapping.credit_column.as_deref().map(col).transpose()?;
    if mapping.amount_layout != "signed" && mapping.amount_layout != "debitCredit" {
        return Err(AppError::Validation(
            "Choose a supported amount layout".into(),
        ));
    }
    if mapping.amount_layout == "signed" && ai.is_none()
        || mapping.amount_layout == "debitCredit" && (debit.is_none() || credit.is_none())
    {
        return Err(AppError::Validation(
            "Choose the required amount columns".into(),
        ));
    }
    if mapping.amount_layout == "debitCredit" && debit == credit {
        return Err(AppError::Validation(
            "Debit and credit must use different columns".into(),
        ));
    }
    let hid = active_household(db)?;
    let ah: String = db
        .query_row(
            "SELECT household_id FROM accounts WHERE id=?",
            [&mapping.account_id],
            |r| r.get(0),
        )
        .map_err(|_| {
            AppError::Validation("destination account does not belong to this household".into())
        })?;
    if ah != hid {
        return Err(AppError::Validation(
            "destination account does not belong to this household".into(),
        ));
    }
    let mut seen = std::collections::HashSet::new();
    let mut rows = Vec::new();
    for (idx, result) in rdr.records().enumerate() {
        let rec = result.map_err(|e| AppError::Validation(format!("Malformed CSV row: {e}")))?;
        let description = rec.get(xi).unwrap_or("").trim().to_string();
        let note = ni
            .and_then(|i| rec.get(i))
            .map(str::trim)
            .filter(|x| !x.is_empty())
            .map(str::to_string);
        let parsed_date = parse_csv_date(rec.get(di).unwrap_or(""), &mapping.date_format);
        let parsed_amount: Result<i64, String> = (|| {
            if mapping.amount_layout == "signed" {
                let v = parse_csv_money(rec.get(ai.unwrap()).unwrap_or(""))?;
                Ok(if mapping.inflow_positive { v } else { -v })
            } else {
                let d = parse_csv_money(rec.get(debit.unwrap()).unwrap_or(""))?.abs();
                let c = parse_csv_money(rec.get(credit.unwrap()).unwrap_or(""))?.abs();
                if d > 0 && c > 0 {
                    return Err("Debit and credit cannot both have values".into());
                }
                if d == 0 && c == 0 {
                    return Err("An amount is required".into());
                }
                Ok(c - d)
            }
        })();
        let mut error = None;
        if description.is_empty() {
            error = Some("Description is required".into())
        }
        if let Err(message) = &parsed_date {
            error = Some(message.clone())
        }
        if parsed_amount.as_ref().is_err() {
            error = Some(parsed_amount.as_ref().unwrap_err().clone())
        }
        if parsed_amount.as_ref().is_ok_and(|x| *x == 0) {
            error = Some("Amount cannot be zero".into())
        }
        let date = parsed_date.ok();
        let amount = parsed_amount.ok();
        let kind = amount.map(|x| {
            if x > 0 {
                "income".to_string()
            } else {
                "expense".to_string()
            }
        });
        let mut category_id = None;
        let mut category_name = None;
        if let Some(k) = &kind {
            let suggested:Option<(String,String)>=db.query_row("SELECT p.category_id,c.name FROM transaction_entries e JOIN postings p ON p.entry_id=e.id JOIN categories c ON c.id=p.category_id WHERE e.household_id=?1 AND lower(trim(e.description))=lower(trim(?2)) AND c.kind=?3 ORDER BY e.created_at DESC LIMIT 1",params![hid,description,k],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
            let fallback = || {
                db.query_row("SELECT id,name FROM categories WHERE (household_id=?1 OR household_id IS NULL) AND kind=?2 ORDER BY CASE WHEN name LIKE 'Other %' THEN 0 ELSE 1 END,name LIMIT 1",params![hid,k],|r|Ok((r.get(0)?,r.get(1)?))).optional()
            };
            if let Some((id, name)) = suggested.or_else(|| fallback().ok().flatten()) {
                category_id = Some(id);
                category_name = Some(name)
            } else if error.is_none() {
                error = Some(format!("No compatible {k} category is available"));
            }
        }
        let mut duplicate = "none".to_string();
        if let (Some(d), Some(a)) = (&date, amount) {
            let fp = duplicate_key(d, a, &description);
            if !seen.insert(fp.clone()) {
                duplicate = "file".into()
            } else {
                let exists: i64 = db.query_row(
                    "SELECT count(*) FROM postings WHERE account_id=?1 AND fingerprint=?2",
                    params![mapping.account_id, fp],
                    |r| r.get(0),
                )?;
                if exists > 0 {
                    duplicate = "existing".into()
                }
            }
        }
        let valid = error.is_none() && category_id.is_some();
        let include = valid && duplicate == "none";
        rows.push(CsvPreviewRow {
            row_number: idx + 2,
            occurred_on: date,
            description,
            note,
            amount_cents: amount,
            kind,
            category_id,
            category_name,
            valid,
            error,
            duplicate,
            include,
        });
    }
    Ok(CsvPreview {
        path,
        file_hash,
        mapping,
        rows,
    })
}
#[tauri::command]
fn preview_csv(
    path: String,
    file_hash: String,
    mapping: CsvMapping,
    database: tauri::State<Database>,
) -> Result<CsvPreview, AppError> {
    with_db(&database, |db| make_preview(db, path, file_hash, mapping))
}
#[tauri::command]
fn commit_csv(
    preview: CsvPreview,
    rows: Vec<CsvCommitRow>,
    database: tauri::State<Database>,
) -> Result<CsvImportResult, AppError> {
    with_db(&database, |db| {
        let fresh = make_preview(
            db,
            preview.path.clone(),
            preview.file_hash.clone(),
            preview.mapping.clone(),
        )?;
        let selected = rows.iter().filter(|x| x.include).collect::<Vec<_>>();
        if selected.is_empty() {
            return Err(AppError::Validation(
                "Select at least one valid row to import".into(),
            ));
        }
        let selected_len = selected.len();
        let tx = db.transaction()?;
        let hid = active_household(&tx)?;
        let sig = {
            let (bytes, _) = csv_bytes(&preview.path)?;
            let (h, _) = csv_headers(&bytes)?;
            header_signature(&h)
        };
        let profile_id = format!("import-profile-{}", &preview.file_hash[..16]);
        let json = serde_json::to_string(&preview.mapping)
            .map_err(|_| AppError::Validation("Could not save CSV mapping".into()))?;
        tx.execute("INSERT INTO import_profiles(id,household_id,normalized_headers,parsing_json) VALUES(?1,?2,?3,?4) ON CONFLICT(household_id,normalized_headers) DO UPDATE SET parsing_json=excluded.parsing_json",params![profile_id,hid,sig,json])?;
        let actual_profile: String = tx.query_row(
            "SELECT id FROM import_profiles WHERE household_id=?1 AND normalized_headers=?2",
            params![hid, sig],
            |r| r.get(0),
        )?;
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let batch_id = format!("import-{nonce}");
        tx.execute("INSERT INTO import_batches(id,account_id,profile_id,row_count,status) VALUES(?1,?2,?3,?4,'complete')",params![batch_id,preview.mapping.account_id,actual_profile,selected.len()])?;
        let mut inserted_fingerprints = std::collections::HashSet::new();
        for choice in selected {
            let row = fresh
                .rows
                .iter()
                .find(|r| r.row_number == choice.row_number)
                .ok_or_else(|| AppError::Validation("An included CSV row was not found".into()))?;
            if !row.valid {
                return Err(AppError::Validation(format!(
                    "Row {} is invalid",
                    row.row_number
                )));
            }
            let kind = row.kind.as_ref().unwrap();
            let category_kind:String=tx.query_row("SELECT kind FROM categories WHERE id=?1 AND (household_id=?2 OR household_id IS NULL)",params![choice.category_id,hid],|r|r.get(0)).map_err(|_|AppError::Validation(format!("Row {} has an invalid category",row.row_number)))?;
            if &category_kind != kind {
                return Err(AppError::Validation(format!(
                    "Row {} category does not match its amount",
                    row.row_number
                )));
            }
            let eid = format!("{batch_id}-{}", row.row_number);
            tx.execute("INSERT INTO transaction_entries(id,household_id,occurred_on,kind,description,note,import_batch_id) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![eid,hid,row.occurred_on,row.kind,row.description,row.note,batch_id])?;
            let fp = duplicate_key(
                row.occurred_on.as_ref().unwrap(),
                row.amount_cents.unwrap(),
                &row.description,
            );
            let existing: i64 = tx.query_row(
                "SELECT count(*) FROM postings WHERE account_id=?1 AND fingerprint=?2",
                params![preview.mapping.account_id, fp],
                |r| r.get(0),
            )?;
            let stored_fingerprint = if existing == 0 && inserted_fingerprints.insert(fp.clone()) {
                Some(fp)
            } else {
                None
            };
            tx.execute("INSERT INTO postings(entry_id,account_id,category_id,amount_cents,fingerprint) VALUES(?1,?2,?3,?4,?5)",params![eid,preview.mapping.account_id,choice.category_id,row.amount_cents,stored_fingerprint])?;
        }
        tx.commit()?;
        Ok(CsvImportResult {
            batch_id,
            imported_count: selected_len,
            skipped_count: fresh.rows.len() - selected_len,
        })
    })
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

fn unique_sibling(path: &Path, label: &str) -> PathBuf {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("lifelook");
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    parent.join(format!(".{name}.{label}-{}-{nonce}", std::process::id()))
}

fn resolved_path(path: &Path) -> Result<PathBuf, AppError> {
    if path.exists() {
        return fs::canonicalize(path).map_err(AppError::Io);
    }
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let parent = fs::canonicalize(parent)?;
    Ok(parent.join(
        path.file_name()
            .ok_or_else(|| AppError::Validation("select a file path".into()))?,
    ))
}

fn reject_active_path(selected: &Path, active: &Path) -> Result<(), AppError> {
    if resolved_path(selected)? == resolved_path(active)? {
        return Err(AppError::Validation(
            "the active LifeLook profile cannot be used as a backup file".into(),
        ));
    }
    Ok(())
}

fn safe_backup(source: &Connection, active: &Path, destination: &Path) -> Result<(), AppError> {
    reject_active_path(destination, active)?;
    let staging = unique_sibling(destination, "staging");
    let result = (|| {
        backup_to(source, &staging)?;
        validate_backup(&staging)?;
        fs::rename(&staging, destination)?;
        Ok(())
    })();
    if staging.exists() {
        let _ = fs::remove_file(&staging);
    }
    result
}

#[tauri::command]
fn backup_database(destination: PathBuf, database: tauri::State<Database>) -> Result<(), AppError> {
    with_db(&database, |db| {
        safe_backup(db, &database.path, &destination)
    })
}

fn csv_field(value: &str) -> String {
    if value.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_owned()
    }
}

fn csv_amount(cents: i64) -> String {
    let sign = if cents < 0 { "-" } else { "" };
    let absolute = i128::from(cents).abs();
    format!("{sign}{}.{:02}", absolute / 100, absolute % 100)
}

type ActivityCsvRow = (String, String, String, String, String, String, i64, String);

fn write_activity_csv(
    db: &Connection,
    destination: &Path,
    posting_ids: &[i64],
) -> Result<(), AppError> {
    if posting_ids.is_empty() {
        return Err(AppError::Validation(
            "select at least one activity posting".into(),
        ));
    }
    let mut unique = std::collections::HashSet::new();
    if posting_ids.iter().any(|id| *id <= 0 || !unique.insert(*id)) {
        return Err(AppError::Validation(
            "activity posting IDs must be unique".into(),
        ));
    }
    let household_id: String = db
        .query_row(
            "SELECT id FROM households ORDER BY rowid LIMIT 1",
            [],
            |row| row.get(0),
        )
        .map_err(|_| {
            AppError::Validation("complete onboarding before exporting activity".into())
        })?;
    let mut statement = db.prepare("SELECT e.occurred_on,e.kind,e.description,COALESCE(e.note,''),a.name,COALESCE(c.name,''),p.amount_cents,COALESCE(e.transfer_group_id,'') FROM postings p JOIN transaction_entries e ON e.id=p.entry_id JOIN accounts a ON a.id=p.account_id LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=?1 AND e.household_id=?2")?;
    let mut output =
        String::from("date,type,description,note,account,category,amount,transfer group\r\n");
    for posting_id in posting_ids {
        let row: Option<ActivityCsvRow> = statement
            .query_row(params![posting_id, household_id], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                ))
            })
            .optional()?;
        let (date, kind, description, note, account, category, amount, transfer_group) = row
            .ok_or_else(|| {
                AppError::Validation("one or more activity postings are unavailable".into())
            })?;
        let fields = [
            date,
            kind,
            description,
            note,
            account,
            category,
            csv_amount(amount),
            transfer_group,
        ];
        output.push_str(
            &fields
                .iter()
                .map(|value| csv_field(value))
                .collect::<Vec<_>>()
                .join(","),
        );
        output.push_str("\r\n");
    }
    let parent = destination.parent().unwrap_or_else(|| Path::new("."));
    if !parent.is_dir() {
        return Err(AppError::Validation(
            "the export folder does not exist".into(),
        ));
    }
    let staging = unique_sibling(destination, "csv-staging");
    let result = (|| {
        fs::write(&staging, output.as_bytes())?;
        fs::rename(&staging, destination)?;
        Ok(())
    })();
    if staging.exists() {
        let _ = fs::remove_file(&staging);
    }
    result
}

#[tauri::command]
fn export_activity_csv(
    destination: PathBuf,
    posting_ids: Vec<i64>,
    database: tauri::State<Database>,
) -> Result<(), AppError> {
    with_db(&database, |db| {
        write_activity_csv(db, &destination, &posting_ids)
    })
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
    if version.unwrap_or(0) > SCHEMA_VERSION {
        return Err(AppError::IncompatibleBackup);
    }
    if integrity != "ok" || version.unwrap_or(0) < 1 {
        return Err(AppError::InvalidBackup);
    }
    Ok(())
}

fn prepare_restore(source: &Path, active: &Path) -> Result<PathBuf, AppError> {
    reject_active_path(source, active)?;
    validate_backup(source)?;
    let staging = unique_sibling(active, "restore-staging");
    let result = (|| {
        fs::copy(source, &staging)?;
        let mut candidate = Connection::open(&staging).map_err(|_| AppError::InvalidBackup)?;
        migrate(&mut candidate).map_err(|_| AppError::InvalidBackup)?;
        let integrity: String = candidate
            .query_row("PRAGMA integrity_check", [], |row| row.get(0))
            .map_err(|_| AppError::InvalidBackup)?;
        if integrity != "ok" {
            return Err(AppError::InvalidBackup);
        }
        bootstrap(&candidate).map_err(|_| AppError::InvalidBackup)?;
        candidate
            .pragma_update(None, "journal_mode", "DELETE")
            .map_err(|_| AppError::InvalidBackup)?;
        drop(candidate);
        Ok(staging.clone())
    })();
    if result.is_err() && staging.exists() {
        let _ = fs::remove_file(&staging);
    }
    result
}

fn restore_database_impl(
    database: &Database,
    source: &Path,
) -> Result<WorkspaceSnapshot, AppError> {
    restore_database_impl_with_failure(database, source, false)
}

fn restore_database_impl_with_failure(
    database: &Database,
    source: &Path,
    force_reopen_failure: bool,
) -> Result<WorkspaceSnapshot, AppError> {
    let staging = prepare_restore(source, &database.path)?;
    let rollback = unique_sibling(&database.path, "restore-rollback");
    let mut state = database.state.lock().map_err(|_| AppError::Busy)?;
    let prior = std::mem::replace(
        &mut *state,
        DatabaseState::Unavailable(startup_failure(
            "startup_failed",
            "Restore is in progress.",
            &database.path,
            true,
        )),
    );
    let connection = match prior {
        DatabaseState::Ready(connection) => connection,
        DatabaseState::Unavailable(failure) => {
            *state = DatabaseState::Unavailable(failure.clone());
            let _ = fs::remove_file(&staging);
            return Err(AppError::Startup(failure));
        }
    };
    let checkpoint = connection.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)");
    drop(connection);
    if let Err(error) = checkpoint {
        let reopened = open_profile(&database.path)
            .map(DatabaseState::Ready)
            .unwrap_or_else(DatabaseState::Unavailable);
        *state = reopened;
        let _ = fs::remove_file(&staging);
        return Err(AppError::RestoreFailed(error.to_string()));
    }

    let replace_result = (|| -> Result<(), std::io::Error> {
        fs::rename(&database.path, &rollback)?;
        if let Err(error) = fs::rename(&staging, &database.path) {
            let _ = fs::rename(&rollback, &database.path);
            return Err(error);
        }
        Ok(())
    })();
    if let Err(error) = replace_result {
        let reopened = open_profile(&database.path)
            .map(DatabaseState::Ready)
            .unwrap_or_else(DatabaseState::Unavailable);
        *state = reopened;
        let _ = fs::remove_file(&staging);
        return Err(AppError::RestoreFailed(error.to_string()));
    }

    let opened = if force_reopen_failure {
        Err(startup_failure(
            "startup_failed",
            "simulated restore reopen failure",
            &database.path,
            true,
        ))
    } else {
        open_profile(&database.path)
    };
    match opened {
        Ok(restored) => match bootstrap(&restored) {
            Ok(snapshot) => {
                *state = DatabaseState::Ready(restored);
                let _ = fs::remove_file(&rollback);
                Ok(snapshot)
            }
            Err(error) => {
                drop(restored);
                let _ = fs::remove_file(&database.path);
                let _ = fs::rename(&rollback, &database.path);
                *state = reopen_rollback(&database.path);
                Err(AppError::RestoreFailed(error.to_string()))
            }
        },
        Err(error) => {
            let _ = fs::remove_file(&database.path);
            let _ = fs::rename(&rollback, &database.path);
            *state = reopen_rollback(&database.path);
            Err(AppError::RestoreFailed(error.message))
        }
    }
}

fn reopen_rollback(path: &Path) -> DatabaseState {
    match Connection::open(path) {
        Ok(connection) if bootstrap(&connection).is_ok() => DatabaseState::Ready(connection),
        Ok(_) => DatabaseState::Unavailable(startup_failure(
            "startup_failed",
            "LifeLook restored the original profile but could not verify it.",
            path,
            true,
        )),
        Err(error) => DatabaseState::Unavailable(startup_failure(
            "startup_failed",
            &format!("LifeLook restored the original profile but could not reopen it: {error}"),
            path,
            true,
        )),
    }
}

#[tauri::command]
fn restore_database(
    source: PathBuf,
    database: tauri::State<Database>,
) -> Result<WorkspaceSnapshot, AppError> {
    restore_database_impl(&database, &source)
}

fn startup_failure(
    code: &'static str,
    message: &str,
    path: &Path,
    retryable: bool,
) -> StartupFailure {
    StartupFailure {
        code,
        message: message.into(),
        profile_path: Some(path.display().to_string()),
        retryable,
    }
}

fn is_writable(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::metadata(path)
            .map(|metadata| metadata.permissions().mode() & 0o222 != 0)
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        fs::metadata(path)
            .map(|metadata| !metadata.permissions().readonly())
            .unwrap_or(false)
    }
}

fn open_profile(path: &Path) -> Result<Connection, StartupFailure> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    if let Err(error) = fs::create_dir_all(parent) {
        return Err(startup_failure(
            "unwritable",
            &format!("LifeLook cannot write to the profile folder: {error}"),
            path,
            true,
        ));
    }
    if !is_writable(parent) || (path.exists() && !is_writable(path)) {
        return Err(startup_failure(
            "unwritable",
            "LifeLook does not have permission to write to this profile.",
            path,
            true,
        ));
    }

    if path.exists() {
        let readonly =
            Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(
                |_| {
                    startup_failure(
                        "corrupt",
                        "The local profile could not be read as a database.",
                        path,
                        true,
                    )
                },
            )?;
        let integrity: String = readonly
            .query_row("PRAGMA integrity_check", [], |row| row.get(0))
            .map_err(|_| {
                startup_failure(
                    "corrupt",
                    "The local profile failed its integrity check.",
                    path,
                    true,
                )
            })?;
        if integrity != "ok" {
            return Err(startup_failure(
                "corrupt",
                "The local profile failed its integrity check.",
                path,
                true,
            ));
        }
        let version = readonly
            .query_row(
                "SELECT COALESCE(MAX(version),0) FROM schema_migrations",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(0);
        if version > SCHEMA_VERSION {
            return Err(startup_failure(
                "incompatible",
                "This profile was created by a newer version of LifeLook.",
                path,
                false,
            ));
        }
    }

    let mut connection = Connection::open(path).map_err(|error| {
        startup_failure(
            "unwritable",
            &format!("LifeLook could not open the profile for writing: {error}"),
            path,
            true,
        )
    })?;
    connection
        .pragma_update(None, "journal_mode", "WAL")
        .map_err(|error| {
            startup_failure(
                "unwritable",
                &format!("LifeLook could not prepare the profile for writing: {error}"),
                path,
                true,
            )
        })?;
    let version: i64 = connection
        .query_row(
            "SELECT COALESCE(MAX(version),0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);
    if version > 0 && version < SCHEMA_VERSION {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        backup_to(
            &connection,
            &parent.join(format!("lifelook.pre-migration-{stamp}.lifelook")),
        )
        .map_err(|error| startup_failure("startup_failed", &error.to_string(), path, true))?;
    }
    migrate(&mut connection).map_err(|error| {
        startup_failure(
            "startup_failed",
            &format!("LifeLook could not initialize the profile: {error}"),
            path,
            true,
        )
    })?;
    Ok(connection)
}

#[tauri::command]
fn retry_startup(database: tauri::State<Database>) -> Result<WorkspaceSnapshot, AppError> {
    retry_database(&database)
}

fn retry_database(database: &Database) -> Result<WorkspaceSnapshot, AppError> {
    let mut state = database.state.lock().map_err(|_| AppError::Busy)?;
    if let DatabaseState::Ready(connection) = &*state {
        return bootstrap(connection);
    }
    match open_profile(&database.path) {
        Ok(connection) => {
            let snapshot = bootstrap(&connection)?;
            *state = DatabaseState::Ready(connection);
            Ok(snapshot)
        }
        Err(failure) => {
            *state = DatabaseState::Unavailable(failure.clone());
            Err(AppError::Startup(failure))
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("."));
            let path = dir.join("lifelook.db");
            let state = match open_profile(&path) {
                Ok(connection) => DatabaseState::Ready(connection),
                Err(failure) => DatabaseState::Unavailable(failure),
            };
            app.manage(Database {
                path,
                state: Mutex::new(state),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_bootstrap,
            save_onboarding_step,
            complete_onboarding,
            create_transaction,
            create_transfer,
            update_transaction,
            update_transfer,
            delete_transaction,
            create_account,
            update_account,
            reconcile_account,
            account_deletion_impact,
            delete_account,
            create_asset,
            update_asset,
            delete_asset,
            create_liability,
            update_liability,
            delete_liability,
            create_recurring,
            update_recurring,
            delete_recurring,
            create_scenario,
            update_scenario,
            delete_scenario,
            inspect_csv,
            preview_csv,
            commit_csv,
            export_activity_csv,
            update_settings,
            backup_database,
            inspect_backup,
            restore_database,
            retry_startup
        ])
        .run(tauri::generate_context!())
        .expect("failed to run LifeLook")
}

#[cfg(test)]
mod tests {
    use super::*;
    fn test_dir(name: &str) -> PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir =
            std::env::temp_dir().join(format!("lifelook-{name}-{}-{nonce}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }
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
    fn seeded_at(path: &Path, household_name: &str) -> Connection {
        let mut c = Connection::open(path).unwrap();
        migrate(&mut c).unwrap();
        c.execute(
            "INSERT INTO households(id,name,state,onboarding_step,onboarding_complete) VALUES('h',?1,'CA',8,1)",
            [household_name],
        )
        .unwrap();
        c.execute(
            "INSERT INTO people(id,household_id,name) VALUES('p','h','Person')",
            [],
        )
        .unwrap();
        c.execute("INSERT INTO accounts(id,household_id,name,kind,opening_balance_cents,liquid) VALUES('a','h','A','checking',10000,1)", []).unwrap();
        c.execute("INSERT INTO settings(household_id) VALUES('h')", [])
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
        assert_eq!(n, SCHEMA_VERSION)
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
    #[test]
    fn safe_backup_rejects_active_profile_and_preserves_existing_destination_on_failure() {
        let dir = test_dir("safe-backup");
        let active = dir.join("active.db");
        let c = seeded_at(&active, "Current");
        assert!(matches!(
            safe_backup(&c, &active, &active),
            Err(AppError::Validation(_))
        ));

        let destination = dir.join("existing.lifelook");
        fs::create_dir(&destination).unwrap();
        fs::write(destination.join("marker"), b"keep me").unwrap();
        assert!(safe_backup(&c, &active, &destination).is_err());
        assert_eq!(fs::read(destination.join("marker")).unwrap(), b"keep me");
        drop(c);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn restore_is_staged_migrated_and_does_not_modify_source() {
        let dir = test_dir("restore-success");
        let active = dir.join("lifelook.db");
        let source = dir.join("backup.lifelook");
        let current = seeded_at(&active, "Current");
        let backup = seeded_at(&source, "Backup");
        backup
            .execute("DELETE FROM schema_migrations WHERE version>1", [])
            .unwrap();
        drop(backup);
        let source_before = fs::read(&source).unwrap();
        let database = Database {
            path: active.clone(),
            state: Mutex::new(DatabaseState::Ready(current)),
        };

        let snapshot = restore_database_impl(&database, &source).unwrap();
        assert_eq!(snapshot.household.unwrap().name, "Backup");
        assert_eq!(fs::read(&source).unwrap(), source_before);
        let version = with_db(&database, |connection| {
            Ok(
                connection.query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                    row.get::<_, i64>(0)
                })?,
            )
        })
        .unwrap();
        assert_eq!(version, SCHEMA_VERSION);
        drop(database);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn restore_rejects_invalid_future_and_active_sources() {
        let dir = test_dir("restore-invalid");
        let active = dir.join("lifelook.db");
        let current = seeded_at(&active, "Current");
        let database = Database {
            path: active.clone(),
            state: Mutex::new(DatabaseState::Ready(current)),
        };
        assert!(matches!(
            prepare_restore(&active, &active),
            Err(AppError::Validation(_))
        ));

        let corrupt = dir.join("corrupt.lifelook");
        fs::write(&corrupt, b"not sqlite").unwrap();
        assert!(matches!(
            prepare_restore(&corrupt, &active),
            Err(AppError::InvalidBackup)
        ));
        let unrelated = dir.join("unrelated.lifelook");
        Connection::open(&unrelated)
            .unwrap()
            .execute("CREATE TABLE other(value)", [])
            .unwrap();
        assert!(matches!(
            prepare_restore(&unrelated, &active),
            Err(AppError::InvalidBackup)
        ));
        let future = dir.join("future.lifelook");
        let future_db = seeded_at(&future, "Future");
        future_db
            .execute(
                "INSERT INTO schema_migrations(version) VALUES(?1)",
                [SCHEMA_VERSION + 1],
            )
            .unwrap();
        drop(future_db);
        assert!(matches!(
            prepare_restore(&future, &active),
            Err(AppError::IncompatibleBackup)
        ));
        drop(database);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn failed_restore_reopens_byte_identical_original_profile() {
        let dir = test_dir("restore-rollback");
        let active = dir.join("lifelook.db");
        let source = dir.join("backup.lifelook");
        let current = seeded_at(&active, "Current");
        current
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
            .unwrap();
        let backup = seeded_at(&source, "Backup");
        drop(backup);
        let original = fs::read(&active).unwrap();
        let database = Database {
            path: active.clone(),
            state: Mutex::new(DatabaseState::Ready(current)),
        };
        assert!(matches!(
            restore_database_impl_with_failure(&database, &source, true),
            Err(AppError::RestoreFailed(_))
        ));
        assert_eq!(
            with_db(&database, |connection| Ok(bootstrap(connection)?
                .household
                .unwrap()
                .name))
            .unwrap(),
            "Current"
        );
        with_db(&database, |connection| {
            connection.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;
            Ok(())
        })
        .unwrap();
        assert_eq!(fs::read(&active).unwrap(), original);
        drop(database);
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn transaction_sign_comes_from_category() {
        let mut c = seeded();
        let input = TransactionInput {
            id: "x".into(),
            occurred_on: "2026-08-09".into(),
            account_id: "a".into(),
            category_id: "c".into(),
            amount_cents: 1250,
            description: "Food".into(),
            note: None,
        };
        insert_transaction(&mut c, &input).unwrap();
        let amount: i64 = c
            .query_row(
                "SELECT amount_cents FROM postings WHERE entry_id='x'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(amount, -1250);
    }
    #[test]
    fn money_limit_is_enforced() {
        let mut c = seeded();
        let input = TransactionInput {
            id: "x".into(),
            occurred_on: "2026-08-09".into(),
            account_id: "a".into(),
            category_id: "c".into(),
            amount_cents: MAX_MONEY_CENTS + 1,
            description: "Too much".into(),
            note: None,
        };
        assert!(matches!(
            insert_transaction(&mut c, &input),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn transaction_references_must_share_the_active_household() {
        let mut c = seeded();
        c.execute(
            "INSERT INTO households(id,name,state) VALUES('other','Other','CA')",
            [],
        )
        .unwrap();
        c.execute("INSERT INTO accounts(id,household_id,name,kind,opening_balance_cents,liquid) VALUES('foreign','other','Foreign','checking',0,1)", []).unwrap();
        let input = TransactionInput {
            id: "foreign-entry".into(),
            occurred_on: "2026-08-09".into(),
            account_id: "foreign".into(),
            category_id: "c".into(),
            amount_cents: 100,
            description: "No".into(),
            note: None,
        };
        assert!(matches!(
            insert_transaction(&mut c, &input),
            Err(AppError::Validation(_))
        ));
        assert_eq!(
            c.query_row(
                "SELECT count(*) FROM transaction_entries WHERE id='foreign-entry'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
    }

    #[test]
    fn calendar_dates_and_category_kinds_are_validated() {
        let mut c = seeded();
        for (id, date, category) in [
            ("bad-date", "2026-02-30", "c"),
            ("bad-kind", "2026-02-28", "transfer-category"),
        ] {
            if category == "transfer-category" {
                c.execute("INSERT INTO categories(id,household_id,name,kind) VALUES(?1,'h','Transfer','transfer')",[category]).unwrap();
            }
            let input = TransactionInput {
                id: id.into(),
                occurred_on: date.into(),
                account_id: "a".into(),
                category_id: category.into(),
                amount_cents: 100,
                description: "Test".into(),
                note: None,
            };
            assert!(matches!(
                insert_transaction(&mut c, &input),
                Err(AppError::Validation(_))
            ));
        }
        assert_eq!(
            c.query_row(
                "SELECT count(*) FROM transaction_entries WHERE id IN ('bad-date','bad-kind')",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
    }

    #[test]
    fn csv_money_and_dates_are_exact() {
        assert_eq!(parse_csv_money("$1,234.50").unwrap(), 123450);
        assert_eq!(parse_csv_money("(12.3)").unwrap(), -1230);
        assert!(parse_csv_money("1.001").is_err());
        assert_eq!(parse_csv_date("2/29/2024", "us").unwrap(), "2024-02-29");
        assert!(parse_csv_date("2/29/2025", "us").is_err());
    }

    #[test]
    fn account_deletion_reports_history_and_last_account() {
        let mut c = seeded();
        c.execute("DELETE FROM accounts WHERE id='b'", []).unwrap();
        let impact = account_impact(&c, "a").unwrap();
        assert!(!impact.can_delete);
        assert!(impact.blockers.iter().any(|x| x.contains("last account")));
        let input = TransactionInput {
            id: "history".into(),
            occurred_on: "2026-01-01".into(),
            account_id: "a".into(),
            category_id: "c".into(),
            amount_cents: 100,
            description: "History".into(),
            note: None,
        };
        insert_transaction(&mut c, &input).unwrap();
        let impact = account_impact(&c, "a").unwrap();
        assert!(impact.blockers.iter().any(|x| x.contains("transactions")));
    }

    #[test]
    fn transaction_deletion_is_atomic_and_preserves_import_audit_history() {
        let mut c = seeded();
        c.execute("INSERT INTO import_profiles(id,household_id,normalized_headers,parsing_json) VALUES('profile','h','date','{}')",[]).unwrap();
        c.execute("INSERT INTO import_batches(id,account_id,profile_id,row_count,status) VALUES('batch','a','profile',1,'complete')",[]).unwrap();
        for (id, kind, batch) in [
            ("manual", "expense", None),
            ("transfer", "transfer", None),
            ("imported", "expense", Some("batch")),
        ] {
            c.execute("INSERT INTO transaction_entries(id,household_id,occurred_on,kind,description,import_batch_id,revision) VALUES(?1,'h','2026-01-01',?2,'Entry',?3,2)",params![id,kind,batch]).unwrap();
        }
        c.execute("INSERT INTO postings(entry_id,account_id,category_id,amount_cents) VALUES('manual','a','c',-100),('transfer','a',NULL,-200),('transfer','b',NULL,200),('imported','a','c',-300)",[]).unwrap();
        for id in ["manual", "transfer", "imported"] {
            delete_transaction_from(
                &mut c,
                &DeleteInput {
                    id: id.into(),
                    expected_revision: 2,
                },
            )
            .unwrap();
            assert_eq!(
                c.query_row(
                    "SELECT count(*) FROM postings WHERE entry_id=?",
                    [id],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
                0
            );
        }
        assert_eq!(
            c.query_row(
                "SELECT count(*) FROM import_batches WHERE id='batch'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            1
        );
    }

    #[test]
    fn transaction_deletion_rejects_adjustments_and_stale_revisions() {
        let mut c = seeded();
        c.execute("INSERT INTO transaction_entries(id,household_id,occurred_on,kind,description,revision) VALUES('adjust','h','2026-01-01','adjustment','Reconcile',1),('stale','h','2026-01-01','expense','Old',2)",[]).unwrap();
        c.execute("INSERT INTO postings(entry_id,account_id,category_id,amount_cents) VALUES('adjust','a','c',100),('stale','a','c',-100)",[]).unwrap();
        assert!(matches!(
            delete_transaction_from(
                &mut c,
                &DeleteInput {
                    id: "adjust".into(),
                    expected_revision: 1
                }
            ),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            delete_transaction_from(
                &mut c,
                &DeleteInput {
                    id: "stale".into(),
                    expected_revision: 1
                }
            ),
            Err(AppError::Conflict)
        ));
        assert_eq!(
            c.query_row(
                "SELECT count(*) FROM postings WHERE entry_id IN ('adjust','stale')",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            2
        );
    }

    #[test]
    fn account_deletion_checks_each_reference_and_revision() {
        let mut c = seeded();
        delete_account_from(
            &mut c,
            &DeleteInput {
                id: "b".into(),
                expected_revision: 1,
            },
        )
        .unwrap();
        assert_eq!(
            c.query_row("SELECT count(*) FROM accounts WHERE id='b'", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );

        let mut stale = seeded();
        assert!(matches!(
            delete_account_from(
                &mut stale,
                &DeleteInput {
                    id: "b".into(),
                    expected_revision: 9
                }
            ),
            Err(AppError::Conflict)
        ));

        let recurring = seeded();
        recurring.execute("INSERT INTO recurring_entries(id,household_id,category_id,account_id,name,amount_cents,start_date) VALUES('r','h','c','b','Rent',1,'2026-01-01')",[]).unwrap();
        assert!(account_impact(&recurring, "b")
            .unwrap()
            .blockers
            .iter()
            .any(|x| x.contains("recurring")));

        let allocated = seeded();
        allocated.execute("INSERT INTO scenarios(id,household_id,name,is_baseline,assumptions_json) VALUES('s','h','Base',1,'{}')",[]).unwrap();
        allocated.execute("INSERT INTO allocations(id,scenario_id,account_id,priority,percent_bps) VALUES('al','s','b',1,10000)",[]).unwrap();
        assert!(account_impact(&allocated, "b")
            .unwrap()
            .blockers
            .iter()
            .any(|x| x.contains("allocations")));

        let imported = seeded();
        imported.execute("INSERT INTO import_batches(id,account_id,row_count,status) VALUES('batch','b',0,'complete')",[]).unwrap();
        assert!(account_impact(&imported, "b")
            .unwrap()
            .blockers
            .iter()
            .any(|x| x.contains("import batch")));
    }

    #[test]
    fn assets_and_mortgages_round_trip_update_and_delete() {
        let c = seeded();
        let asset = AssetInput {
            id: "home".into(),
            name: " Home ".into(),
            value_cents: 50_000_000,
            annual_growth_bps: 350,
            expected_revision: None,
        };
        save_asset(&c, &asset, false).unwrap();
        let mortgage = MortgageTerms {
            original_principal_cents: 40_000_000,
            term_months: 360,
            start_date: "2020-01-15".into(),
            payment_override_cents: None,
        };
        let liability = LiabilityInput {
            id: "mortgage".into(),
            name: "Mortgage".into(),
            balance_cents: 35_000_000,
            annual_rate_bps: 650,
            minimum_payment_cents: 1,
            mortgage: Some(mortgage.clone()),
            expected_revision: None,
        };
        save_liability(&c, &liability, false).unwrap();
        let expected_payment = calculated_mortgage_payment(40_000_000, 650, 360);
        assert_eq!(
            c.query_row(
                "SELECT minimum_payment_cents FROM liabilities WHERE id='mortgage'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            expected_payment
        );
        let json: String = c
            .query_row(
                "SELECT mortgage_json FROM liabilities WHERE id='mortgage'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            serde_json::from_str::<MortgageTerms>(&json)
                .unwrap()
                .term_months,
            360
        );

        save_asset(
            &c,
            &AssetInput {
                expected_revision: Some(1),
                value_cents: 51_000_000,
                ..asset
            },
            true,
        )
        .unwrap();
        delete_asset_from(
            &c,
            &DeleteInput {
                id: "home".into(),
                expected_revision: 2,
            },
        )
        .unwrap();
        delete_liability_from(
            &c,
            &DeleteInput {
                id: "mortgage".into(),
                expected_revision: 1,
            },
        )
        .unwrap();
        assert_eq!(
            c.query_row("SELECT count(*) FROM assets", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            c.query_row("SELECT count(*) FROM liabilities", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn financial_records_validate_rates_terms_and_revisions() {
        let c = seeded();
        let bad_asset = AssetInput {
            id: "bad".into(),
            name: "Asset".into(),
            value_cents: 1,
            annual_growth_bps: -10_001,
            expected_revision: None,
        };
        assert!(matches!(
            save_asset(&c, &bad_asset, false),
            Err(AppError::Validation(_))
        ));
        let valid_asset = AssetInput {
            id: "valid".into(),
            name: "Asset".into(),
            value_cents: 100,
            annual_growth_bps: 0,
            expected_revision: None,
        };
        save_asset(&c, &valid_asset, false).unwrap();
        assert!(matches!(
            save_asset(
                &c,
                &AssetInput {
                    expected_revision: Some(9),
                    ..valid_asset
                },
                true
            ),
            Err(AppError::Conflict)
        ));
        let bad_debt = LiabilityInput {
            id: "bad".into(),
            name: "Debt".into(),
            balance_cents: 100,
            annual_rate_bps: 100,
            minimum_payment_cents: 0,
            mortgage: None,
            expected_revision: None,
        };
        assert!(matches!(
            save_liability(&c, &bad_debt, false),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn csv_rejects_ambiguous_headers_and_unsupported_formats() {
        assert!(matches!(
            csv_headers(b"Date, date ,Amount\n2026-01-01,x,1\n"),
            Err(AppError::Validation(_))
        ));
        assert_eq!(
            parse_csv_date("2026-01-01", "unknown").unwrap_err(),
            "Unsupported date format"
        );
    }

    #[test]
    fn corrupt_profile_is_reported_and_unchanged() {
        let dir = test_dir("corrupt");
        let path = dir.join("lifelook.db");
        let original = b"not a sqlite database";
        fs::write(&path, original).unwrap();
        let error = open_profile(&path).unwrap_err();
        assert_eq!(error.code, "corrupt");
        assert_eq!(fs::read(&path).unwrap(), original);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    #[cfg(unix)]
    fn unwritable_profile_can_be_retried_after_permissions_are_repaired() {
        use std::os::unix::fs::PermissionsExt;
        let dir = test_dir("unwritable");
        let path = dir.join("lifelook.db");
        drop(open_profile(&path).unwrap());
        let original = fs::read(&path).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o444)).unwrap();
        let error = open_profile(&path).unwrap_err();
        assert_eq!(error.code, "unwritable");
        assert_eq!(fs::read(&path).unwrap(), original);
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        drop(open_profile(&path).unwrap());
        drop(open_profile(&path).unwrap());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn future_schema_is_incompatible_and_unchanged() {
        let dir = test_dir("future");
        let path = dir.join("lifelook.db");
        let connection = open_profile(&path).unwrap();
        connection
            .execute("INSERT INTO schema_migrations(version) VALUES(99)", [])
            .unwrap();
        connection
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
            .unwrap();
        drop(connection);
        let original = fs::read(&path).unwrap();
        let error = open_profile(&path).unwrap_err();
        assert_eq!(error.code, "incompatible");
        assert!(!error.retryable);
        assert_eq!(fs::read(&path).unwrap(), original);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    #[cfg(unix)]
    fn managed_retry_stays_unavailable_then_becomes_idempotently_ready() {
        use std::os::unix::fs::PermissionsExt;
        let dir = test_dir("managed-retry");
        let path = dir.join("lifelook.db");
        drop(open_profile(&path).unwrap());
        fs::set_permissions(&path, fs::Permissions::from_mode(0o444)).unwrap();
        let failure = open_profile(&path).unwrap_err();
        let database = Database {
            path: path.clone(),
            state: Mutex::new(DatabaseState::Unavailable(failure)),
        };
        assert!(matches!(
            retry_database(&database),
            Err(AppError::Startup(_))
        ));
        assert!(matches!(
            &*database.state.lock().unwrap(),
            DatabaseState::Unavailable(_)
        ));
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        retry_database(&database).unwrap();
        retry_database(&database).unwrap();
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn scenario_settings_accept_empty_allocations_and_validate_rates_and_catch_all() {
        let mut input = ScenarioUpdateInput {
            id: "scenario".into(),
            name: "Plan".into(),
            assumptions: serde_json::json!({"inflationBps": 250, "thresholdInflationBps": 300}),
            horizon_months: 480,
            events: vec![],
            allocations: vec![],
            expected_revision: 1,
        };
        assert!(validate_scenario_update(&input).is_ok());
        input.allocations =
            vec![serde_json::json!({"id":"rule","accountId":"a","priority":1,"percentBps":5000})];
        assert!(matches!(
            validate_scenario_update(&input),
            Err(AppError::Validation(_))
        ));
        input.allocations[0]["percentBps"] = serde_json::json!(10000);
        assert!(validate_scenario_update(&input).is_ok());
        input.assumptions["inflationBps"] = serde_json::json!(2.5);
        assert!(matches!(
            validate_scenario_update(&input),
            Err(AppError::Validation(_))
        ));
        input.horizon_months = 481;
        assert!(matches!(
            validate_scenario_update(&input),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn scenario_aggregate_rejects_duplicate_and_malformed_events_and_allocations() {
        let base = serde_json::json!({"id":"event","date":"2026-09-01","type":"one-time-income","amountCents":100});
        let mut input = ScenarioUpdateInput {
            id: "s".into(),
            name: "Plan".into(),
            assumptions: serde_json::json!({"inflationBps":250,"thresholdInflationBps":250}),
            horizon_months: 12,
            events: vec![base.clone(), base],
            allocations: vec![],
            expected_revision: 1,
        };
        assert!(matches!(
            validate_scenario_update(&input),
            Err(AppError::Validation(_))
        ));
        input.events = vec![
            serde_json::json!({"id":"bad","date":"2026-09-01","type":"account-transfer","fromAccountId":"a","toAccountId":"a","amountCents":100}),
        ];
        assert!(matches!(
            validate_scenario_update(&input),
            Err(AppError::Validation(_))
        ));
        input.events.clear();
        input.allocations =
            vec![serde_json::json!({"id":"one","accountId":"a","priority":2,"percentBps":10000})];
        assert!(matches!(
            validate_scenario_update(&input),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn activity_csv_is_rfc4180_utf8_signed_and_atomic() {
        let c = seeded();
        c.execute("INSERT INTO transaction_entries(id,household_id,occurred_on,kind,description,note,transfer_group_id) VALUES('x','h','2026-08-09','expense','Café, \"lunch\"','line 1\nline 2',NULL),('t','h','2026-08-08','transfer','Transfer',NULL,'group-1')",[]).unwrap();
        c.execute("INSERT INTO postings(entry_id,account_id,category_id,amount_cents) VALUES('x','a','c',-1250),('t','a',NULL,-5000),('t','b',NULL,5000)",[]).unwrap();
        let ids: Vec<i64> = c
            .prepare("SELECT id FROM postings ORDER BY id")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        let dir = test_dir("activity-export");
        let destination = dir.join("activity.csv");
        write_activity_csv(&c, &destination, &ids).unwrap();
        let csv = fs::read_to_string(&destination).unwrap();
        assert!(csv
            .starts_with("date,type,description,note,account,category,amount,transfer group\r\n"));
        assert!(csv.contains("\"Café, \"\"lunch\"\"\""));
        assert!(csv.contains("\"line 1\nline 2\""));
        assert!(csv.contains(",-12.50,"));
        assert!(csv.contains(",-50.00,group-1\r\n"));
        assert!(csv.contains(",50.00,group-1\r\n"));
        fs::write(&destination, "keep me").unwrap();
        assert!(write_activity_csv(&c, &destination, &[ids[0], ids[0]]).is_err());
        assert_eq!(fs::read_to_string(&destination).unwrap(), "keep me");
        assert!(write_activity_csv(&c, &destination, &[999_999]).is_err());
        assert_eq!(fs::read_to_string(&destination).unwrap(), "keep me");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn activity_csv_rejects_empty_selection_and_foreign_household_posting() {
        let c = seeded();
        assert!(write_activity_csv(&c, Path::new("ignored.csv"), &[]).is_err());
        c.execute(
            "INSERT INTO households(id,name,state) VALUES('foreign','Other','CA')",
            [],
        )
        .unwrap();
        c.execute("INSERT INTO accounts(id,household_id,name,kind,opening_balance_cents,liquid) VALUES('foreign-a','foreign','Other','checking',0,1)",[]).unwrap();
        c.execute("INSERT INTO transaction_entries(id,household_id,occurred_on,kind,description) VALUES('foreign-x','foreign','2026-01-01','income','Other')",[]).unwrap();
        c.execute("INSERT INTO postings(entry_id,account_id,amount_cents) VALUES('foreign-x','foreign-a',100)",[]).unwrap();
        let id = c.last_insert_rowid();
        let dir = test_dir("activity-foreign");
        assert!(write_activity_csv(&c, &dir.join("out.csv"), &[id]).is_err());
        assert!(!dir.join("out.csv").exists());
        fs::remove_dir_all(dir).unwrap();
    }
}
