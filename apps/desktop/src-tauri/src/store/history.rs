//! History table: dictations, commands and transforms.

use super::db::{enum_from_str, enum_to_str, Db};
use crate::text::types::Category;
use anyhow::{anyhow, Result};
use rusqlite::{params, Row};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HistoryMode {
    #[default]
    Dictate,
    DictateEnhance,
    Command,
    Transform,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryItem {
    pub id: i64,
    /// Unix ms.
    pub created_at: i64,
    pub app_name: String,
    pub category: Category,
    pub mode: HistoryMode,
    pub raw_text: String,
    pub final_text: String,
    pub duration_ms: i64,
    pub words: u32,
    pub used_ai: bool,
    pub has_audio: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// A history row to insert: `HistoryItem` minus `id`/`has_audio`, plus `audio_path`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewHistory {
    pub created_at: i64,
    pub app_name: String,
    pub category: Category,
    pub mode: HistoryMode,
    pub raw_text: String,
    pub final_text: String,
    pub duration_ms: i64,
    pub words: u32,
    pub used_ai: bool,
    pub audio_path: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryStat {
    pub created_at: i64,
    pub app_name: String,
    pub category: Category,
    pub words: u32,
    pub duration_ms: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Retention {
    #[default]
    Forever,
    Day,
    Never,
}

const COLS: &str = "id, created_at, app_name, category, mode, raw_text, final_text, \
                    duration_ms, words, used_ai, audio_path, error";

fn row_to_item(r: &Row<'_>) -> rusqlite::Result<HistoryItem> {
    let category: String = r.get(3)?;
    let mode: String = r.get(4)?;
    let audio: Option<String> = r.get(10)?;
    Ok(HistoryItem {
        id: r.get(0)?,
        created_at: r.get(1)?,
        app_name: r.get(2)?,
        category: enum_from_str(&category),
        mode: enum_from_str(&mode),
        raw_text: r.get(5)?,
        final_text: r.get(6)?,
        duration_ms: r.get(7)?,
        words: r.get::<_, i64>(8)? as u32,
        used_ai: r.get::<_, i64>(9)? != 0,
        has_audio: audio.is_some(),
        error: r.get(11)?,
    })
}

fn escape_like(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

impl Db {
    /// Insert a history row; returns the new id, or -1 if the insert failed (logged).
    pub fn insert_history(&self, h: &NewHistory) -> i64 {
        let conn = self.conn();
        let res = conn.execute(
            "INSERT INTO history (created_at, app_name, category, mode, raw_text, final_text, \
             duration_ms, words, used_ai, audio_path, error) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![
                h.created_at,
                h.app_name,
                enum_to_str(&h.category),
                enum_to_str(&h.mode),
                h.raw_text,
                h.final_text,
                h.duration_ms,
                h.words,
                h.used_ai as i64,
                h.audio_path,
                h.error
            ],
        );
        match res {
            Ok(_) => conn.last_insert_rowid(),
            Err(e) => {
                log::error!("history insert failed: {e}");
                -1
            }
        }
    }

    /// Newest first. `query` matches final or raw text (case-insensitive substring).
    pub fn list_history(&self, query: Option<&str>, limit: u32, offset: u32) -> Vec<HistoryItem> {
        let conn = self.conn();
        let q = query.map(str::trim).filter(|q| !q.is_empty());
        let result = (|| -> rusqlite::Result<Vec<HistoryItem>> {
            match q {
                Some(q) => {
                    let pat = format!("%{}%", escape_like(q));
                    let mut st = conn.prepare(&format!(
                        "SELECT {COLS} FROM history WHERE final_text LIKE ?1 ESCAPE '\\' \
                         OR raw_text LIKE ?1 ESCAPE '\\' ORDER BY created_at DESC, id DESC LIMIT ?2 OFFSET ?3"
                    ))?;
                    let rows = st.query_map(params![pat, limit, offset], row_to_item)?;
                    rows.collect()
                }
                None => {
                    let mut st = conn.prepare(&format!(
                        "SELECT {COLS} FROM history ORDER BY created_at DESC, id DESC LIMIT ?1 OFFSET ?2"
                    ))?;
                    let rows = st.query_map(params![limit, offset], row_to_item)?;
                    rows.collect()
                }
            }
        })();
        result.unwrap_or_else(|e| {
            log::error!("history list failed: {e}");
            Vec::new()
        })
    }

    pub fn get_history(&self, id: i64) -> Option<HistoryItem> {
        let conn = self.conn();
        conn.query_row(
            &format!("SELECT {COLS} FROM history WHERE id = ?1"),
            [id],
            row_to_item,
        )
        .ok()
    }

    pub fn history_audio_path(&self, id: i64) -> Option<String> {
        let conn = self.conn();
        conn.query_row("SELECT audio_path FROM history WHERE id = ?1", [id], |r| {
            r.get::<_, Option<String>>(0)
        })
        .ok()
        .flatten()
    }

    /// Replace the final text (user edit) and recount words.
    pub fn update_history_text(&self, id: i64, text: &str) -> Result<()> {
        let words = crate::text::types::word_count(text);
        let n = self.conn().execute(
            "UPDATE history SET final_text = ?1, words = ?2 WHERE id = ?3",
            params![text, words, id],
        )?;
        if n == 0 {
            return Err(anyhow!("history item {id} not found"));
        }
        Ok(())
    }

    pub fn delete_history(&self, id: i64) -> Result<()> {
        self.conn()
            .execute("DELETE FROM history WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn clear_history(&self) -> Result<()> {
        self.conn().execute("DELETE FROM history", [])?;
        Ok(())
    }

    /// `Day` deletes items older than 24 h; `Never` deletes everything; `Forever` is a no-op.
    pub fn purge_history(&self, retention: Retention, now_ms: i64) -> Result<usize> {
        let conn = self.conn();
        Ok(match retention {
            Retention::Forever => 0,
            Retention::Day => conn.execute(
                "DELETE FROM history WHERE created_at < ?1",
                [now_ms - 24 * 3600 * 1000],
            )?,
            Retention::Never => conn.execute("DELETE FROM history", [])?,
        })
    }

    /// Stats for Insights; failed items (with an error) are excluded.
    pub fn history_stats(&self) -> Vec<HistoryStat> {
        let conn = self.conn();
        let result = (|| -> rusqlite::Result<Vec<HistoryStat>> {
            let mut st = conn.prepare(
                "SELECT created_at, app_name, category, words, duration_ms FROM history \
                 WHERE error IS NULL ORDER BY created_at",
            )?;
            let rows = st.query_map([], |r| {
                let cat: String = r.get(2)?;
                Ok(HistoryStat {
                    created_at: r.get(0)?,
                    app_name: r.get(1)?,
                    category: enum_from_str(&cat),
                    words: r.get::<_, i64>(3)? as u32,
                    duration_ms: r.get(4)?,
                })
            })?;
            rows.collect()
        })();
        result.unwrap_or_default()
    }
}

#[cfg(test)]
pub(crate) fn sample(created_at: i64, raw: &str, fin: &str) -> NewHistory {
    NewHistory {
        created_at,
        app_name: "Code".into(),
        category: Category::Code,
        mode: HistoryMode::Dictate,
        raw_text: raw.into(),
        final_text: fin.into(),
        duration_ms: 3000,
        words: crate::text::types::word_count(fin),
        used_ai: false,
        audio_path: None,
        error: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn insert_list_newest_first_and_get() {
        let db = Db::open_in_memory().unwrap();
        let a = db.insert_history(&sample(1000, "one raw", "One."));
        let b = db.insert_history(&sample(3000, "three raw", "Three."));
        let c = db.insert_history(&sample(2000, "two raw", "Two."));
        let ids: Vec<i64> = db.list_history(None, 10, 0).iter().map(|h| h.id).collect();
        assert_eq!(ids, vec![b, c, a]);
        let page: Vec<i64> = db.list_history(None, 1, 1).iter().map(|h| h.id).collect();
        assert_eq!(page, vec![c]);
        let item = db.get_history(a).unwrap();
        assert_eq!(item.final_text, "One.");
        assert_eq!(item.category, Category::Code);
        assert!(!item.has_audio);
    }

    #[test]
    fn search_matches_final_or_raw_text() {
        let db = Db::open_in_memory().unwrap();
        db.insert_history(&sample(1, "um hello world", "Hello world."));
        db.insert_history(&sample(2, "something else", "Entirely different."));
        assert_eq!(db.list_history(Some("hello"), 10, 0).len(), 1);
        assert_eq!(
            db.list_history(Some("um hello"), 10, 0).len(),
            1,
            "raw text"
        );
        assert_eq!(
            db.list_history(Some("different"), 10, 0).len(),
            1,
            "final text"
        );
        assert_eq!(db.list_history(Some("nope"), 10, 0).len(), 0);
        assert_eq!(
            db.list_history(Some("100%"), 10, 0).len(),
            0,
            "wildcards escaped"
        );
    }

    #[test]
    fn update_delete_clear() {
        let db = Db::open_in_memory().unwrap();
        let id = db.insert_history(&sample(1, "a", "b"));
        db.update_history_text(id, "three whole words").unwrap();
        let h = db.get_history(id).unwrap();
        assert_eq!((h.final_text.as_str(), h.words), ("three whole words", 3));
        assert!(db.update_history_text(999, "x").is_err());
        db.delete_history(id).unwrap();
        assert!(db.get_history(id).is_none());
        db.insert_history(&sample(1, "a", "b"));
        db.clear_history().unwrap();
        assert!(db.list_history(None, 10, 0).is_empty());
    }

    #[test]
    fn audio_path_sets_has_audio() {
        let db = Db::open_in_memory().unwrap();
        let mut h = sample(1, "a", "b");
        h.audio_path = Some("C:\\a.wav".into());
        let id = db.insert_history(&h);
        assert!(db.get_history(id).unwrap().has_audio);
        assert_eq!(db.history_audio_path(id).as_deref(), Some("C:\\a.wav"));
    }

    #[test]
    fn purge_by_retention() {
        let now = 10 * 24 * 3600 * 1000;
        let db = Db::open_in_memory().unwrap();
        db.insert_history(&sample(now - 25 * 3600 * 1000, "old", "old"));
        db.insert_history(&sample(now - 3600 * 1000, "new", "new"));
        db.purge_history(Retention::Forever, now).unwrap();
        assert_eq!(db.list_history(None, 10, 0).len(), 2);
        db.purge_history(Retention::Day, now).unwrap();
        let left = db.list_history(None, 10, 0);
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].final_text, "new");
        db.purge_history(Retention::Never, now).unwrap();
        assert!(db.list_history(None, 10, 0).is_empty());
    }

    #[test]
    fn stats_exclude_failed_items() {
        let db = Db::open_in_memory().unwrap();
        db.insert_history(&sample(1, "a b", "a b"));
        let mut bad = sample(2, "x", "x");
        bad.error = Some("boom".into());
        db.insert_history(&bad);
        let stats = db.history_stats();
        assert_eq!(stats.len(), 1);
        assert_eq!(stats[0].words, 2);
    }

    #[test]
    fn serializes_camel_case_without_null_error() {
        let db = Db::open_in_memory().unwrap();
        let id = db.insert_history(&sample(1, "a", "b"));
        let v = serde_json::to_value(db.get_history(id).unwrap()).unwrap();
        assert!(v.get("error").is_none());
        assert_eq!(v["createdAt"], 1);
        assert_eq!(v["mode"], "dictate");
        assert_eq!(v["hasAudio"], false);
        assert_eq!(
            serde_json::to_string(&HistoryMode::DictateEnhance).unwrap(),
            "\"dictateEnhance\""
        );
        assert_eq!(serde_json::to_string(&Retention::Day).unwrap(), "\"day\"");
    }
}
