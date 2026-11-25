//! Quick notes.

use super::db::Db;
use anyhow::{anyhow, Result};
use rusqlite::{params, Row};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: i64,
    pub title: String,
    pub body: String,
    /// Unix ms.
    pub updated_at: i64,
}

fn row_to_note(r: &Row<'_>) -> rusqlite::Result<Note> {
    Ok(Note {
        id: r.get(0)?,
        title: r.get(1)?,
        body: r.get(2)?,
        updated_at: r.get(3)?,
    })
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

impl Db {
    /// Most recently updated first.
    pub fn notes_list(&self) -> Vec<Note> {
        let conn = self.conn();
        let result = (|| -> rusqlite::Result<Vec<Note>> {
            let mut st = conn.prepare(
                "SELECT id, title, body, updated_at FROM notes ORDER BY updated_at DESC, id DESC",
            )?;
            let rows = st.query_map([], row_to_note)?;
            rows.collect()
        })();
        result.unwrap_or_default()
    }

    /// Create a note with the given content (empty for a blank note) stamped at `now_ms`.
    pub fn notes_create_at(&self, title: &str, body: &str, now_ms: i64) -> Result<Note> {
        let conn = self.conn();
        conn.execute(
            "INSERT INTO notes (title, body, updated_at) VALUES (?1, ?2, ?3)",
            params![title, body, now_ms],
        )?;
        Ok(Note {
            id: conn.last_insert_rowid(),
            title: title.to_string(),
            body: body.to_string(),
            updated_at: now_ms,
        })
    }

    /// Create an empty note stamped now.
    pub fn notes_create(&self) -> Result<Note> {
        self.notes_create_at("", "", now_ms())
    }

    /// Save title/body and bump `updated_at`; returns the stored note.
    pub fn notes_update(&self, n: &Note) -> Result<Note> {
        self.notes_update_at(n, now_ms())
    }

    pub fn notes_update_at(&self, n: &Note, now_ms: i64) -> Result<Note> {
        let changed = self.conn().execute(
            "UPDATE notes SET title = ?1, body = ?2, updated_at = ?3 WHERE id = ?4",
            params![n.title, n.body, now_ms, n.id],
        )?;
        if changed == 0 {
            return Err(anyhow!("note {} not found", n.id));
        }
        Ok(Note {
            updated_at: now_ms,
            ..n.clone()
        })
    }

    pub fn notes_delete(&self, id: i64) -> Result<()> {
        self.conn()
            .execute("DELETE FROM notes WHERE id = ?1", [id])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_update_delete_ordering() {
        let db = Db::open_in_memory().unwrap();
        let a = db.notes_create_at("A", "first", 100).unwrap();
        let b = db.notes_create_at("B", "second", 200).unwrap();
        assert_eq!(
            db.notes_list().iter().map(|n| n.id).collect::<Vec<_>>(),
            vec![b.id, a.id]
        );
        let mut a2 = a.clone();
        a2.body = "edited".into();
        let saved = db.notes_update_at(&a2, 300).unwrap();
        assert_eq!(saved.updated_at, 300);
        let list = db.notes_list();
        assert_eq!((list[0].id, list[0].body.as_str()), (a.id, "edited"));
        db.notes_delete(b.id).unwrap();
        assert_eq!(db.notes_list().len(), 1);
        let mut ghost = a2;
        ghost.id = 999;
        assert!(db.notes_update_at(&ghost, 1).is_err());
    }

    #[test]
    fn create_makes_blank_note() {
        let db = Db::open_in_memory().unwrap();
        let n = db.notes_create().unwrap();
        assert_eq!((n.title.as_str(), n.body.as_str()), ("", ""));
        assert!(n.updated_at > 0);
    }
}
