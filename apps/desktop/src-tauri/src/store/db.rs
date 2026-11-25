//! SQLite connection wrapper and schema migrations (`PRAGMA user_version`).

use anyhow::{Context, Result};
use parking_lot::{Mutex, MutexGuard};
use rusqlite::Connection;
use std::path::Path;

/// The local store. All feature modules add `impl Db` blocks.
pub struct Db(Mutex<Connection>);

const MIGRATION_1: &str = r#"
CREATE TABLE history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at  INTEGER NOT NULL,
    app_name    TEXT NOT NULL,
    category    TEXT NOT NULL,
    mode        TEXT NOT NULL,
    raw_text    TEXT NOT NULL,
    final_text  TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    words       INTEGER NOT NULL,
    used_ai     INTEGER NOT NULL,
    audio_path  TEXT,
    error       TEXT
);
CREATE INDEX idx_history_created ON history(created_at);

CREATE TABLE dictionary (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    word     TEXT NOT NULL,
    heard_as TEXT,
    auto     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE snippets (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    trigger   TEXT NOT NULL,
    expansion TEXT NOT NULL
);

CREATE TABLE transforms (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    instruction TEXT NOT NULL,
    shortcut    TEXT,
    builtin     INTEGER NOT NULL DEFAULT 0,
    position    INTEGER NOT NULL DEFAULT 0
);
INSERT INTO transforms (id, name, instruction, shortcut, builtin, position) VALUES
 ('polish', 'Polish',
  'Polish the text: fix grammar, spelling and punctuation and tighten the wording, keeping the meaning and the author''s voice.',
  'Alt+Shift+1', 1, 0),
 ('prompt', 'Prompt engineer',
  'Rewrite the text as a clear, well-structured prompt for an AI assistant: state the goal, give the needed context, list constraints, and say what output format is wanted.',
  'Alt+Shift+2', 1, 1);

CREATE TABLE notes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL,
    body       TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE usage (
    day           TEXT NOT NULL,
    model         TEXT NOT NULL,
    input_tokens  INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    PRIMARY KEY (day, model)
);
"#;

/// Ordered migrations; index + 1 is the resulting `user_version`.
const MIGRATIONS: &[&str] = &[MIGRATION_1];

fn migrate(conn: &mut Connection) -> Result<()> {
    let current = conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))? as usize;
    if current > MIGRATIONS.len() {
        return Err(anyhow::anyhow!(
            "database schema version {current} is newer than this app supports ({}); \
             update Utter",
            MIGRATIONS.len()
        ));
    }
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(current) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)
            .with_context(|| format!("migration {} failed", i + 1))?;
        tx.pragma_update(None, "user_version", (i + 1) as i64)?;
        tx.commit()?;
    }
    Ok(())
}

impl Db {
    pub fn open(path: &Path) -> Result<Db> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let mut conn = Connection::open(path)
            .with_context(|| format!("opening database {}", path.display()))?;
        conn.pragma_update(None, "journal_mode", "WAL").ok();
        Self::init(&mut conn)?;
        Ok(Db(Mutex::new(conn)))
    }

    pub fn open_in_memory() -> Result<Db> {
        let mut conn = Connection::open_in_memory()?;
        Self::init(&mut conn)?;
        Ok(Db(Mutex::new(conn)))
    }

    fn init(conn: &mut Connection) -> Result<()> {
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        migrate(conn)
    }

    pub(crate) fn conn(&self) -> MutexGuard<'_, Connection> {
        self.0.lock()
    }

    #[cfg(test)]
    pub(crate) fn user_version(&self) -> i64 {
        self.conn()
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap()
    }
}

/// Serialize a camelCase enum to its string form for storage.
pub(crate) fn enum_to_str<T: serde::Serialize>(v: &T) -> String {
    match serde_json::to_value(v) {
        Ok(serde_json::Value::String(s)) => s,
        _ => String::new(),
    }
}

/// Parse a stored enum string, falling back to `T::default()` on unknown values.
pub(crate) fn enum_from_str<T: serde::de::DeserializeOwned + Default>(s: &str) -> T {
    serde_json::from_value(serde_json::Value::String(s.to_string())).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_database_from_newer_version() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("utter.db");
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch("CREATE TABLE marker (x); PRAGMA user_version = 99;")
                .unwrap();
        }
        let err = Db::open(&path).err().expect("must refuse").to_string();
        assert!(err.contains("newer"), "{err}");
        // Untouched: no migration was run against it.
        let conn = Connection::open(&path).unwrap();
        let tables: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name = 'history'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(tables, 0);
    }

    #[test]
    fn migrations_are_idempotent_across_opens() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("utter.db");
        let db = Db::open(&path).unwrap();
        assert_eq!(db.user_version(), MIGRATIONS.len() as i64);
        db.conn()
            .execute(
                "INSERT INTO notes (title, body, updated_at) VALUES ('a','b',1)",
                [],
            )
            .unwrap();
        drop(db);
        let db = Db::open(&path).unwrap();
        assert_eq!(db.user_version(), MIGRATIONS.len() as i64);
        let n: i64 = db
            .conn()
            .query_row("SELECT COUNT(*) FROM notes", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
        let t: i64 = db
            .conn()
            .query_row("SELECT COUNT(*) FROM transforms", [], |r| r.get(0))
            .unwrap();
        assert_eq!(t, 2, "builtins seeded exactly once");
    }
}
