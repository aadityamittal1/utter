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
    /// Insert a history row; returns the new id.
    pub fn insert_history(&self, h: &NewHistory) -> Result<i64> {
        let conn = self.conn();
        conn.execute(
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
        )?;
        Ok(conn.last_insert_rowid())
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

    /// Delete one item; returns its audio path (if any) for the caller to remove.
    pub fn delete_history(&self, id: i64) -> Option<String> {
        self.delete_audio_rows("id = ?1", params![id])
            .into_iter()
            .next()
    }

    /// Delete everything; returns all audio paths.
    pub fn clear_history(&self) -> Vec<String> {
        self.delete_audio_rows("1 = 1", params![])
    }

    /// `Day` deletes items older than 24 h; `Never` deletes everything; `Forever` is a no-op.
    /// Returns the audio paths of the deleted rows.
    pub fn purge_history(&self, retention: Retention, now_ms: i64) -> Vec<String> {
        match retention {
            Retention::Forever => Vec::new(),
            Retention::Day => {
                self.delete_audio_rows("created_at < ?1", params![now_ms - 24 * 3600 * 1000])
            }
            Retention::Never => self.delete_audio_rows("1 = 1", params![]),
        }
    }

    /// SELECT the audio paths then DELETE the same rows in one transaction (errors are logged).
    fn delete_audio_rows(&self, where_sql: &str, args: &[&dyn rusqlite::ToSql]) -> Vec<String> {
        let run = || -> rusqlite::Result<Vec<String>> {
            let mut conn = self.conn();
            let tx = conn.transaction()?;
            let paths = {
                let mut st = tx.prepare(&format!(
                    "SELECT audio_path FROM history WHERE ({where_sql}) AND audio_path IS NOT NULL"
                ))?;
                let rows = st.query_map(args, |r| r.get::<_, String>(0))?;
                rows.collect::<rusqlite::Result<Vec<_>>>()?
            };
            tx.execute(&format!("DELETE FROM history WHERE {where_sql}"), args)?;
            tx.commit()?;
            Ok(paths)
        };
        run().unwrap_or_else(|e| {
            log::error!("history delete failed: {e}");
            Vec::new()
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
        let a = db.insert_history(&sample(1000, "one raw", "One.")).unwrap();
        let b = db
            .insert_history(&sample(3000, "three raw", "Three."))
            .unwrap();
        let c = db.insert_history(&sample(2000, "two raw", "Two.")).unwrap();
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
        db.insert_history(&sample(1, "um hello world", "Hello world."))
            .unwrap();
        db.insert_history(&sample(2, "something else", "Entirely different."))
            .unwrap();
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
        let id = db.insert_history(&sample(1, "a", "b")).unwrap();
        db.update_history_text(id, "three whole words").unwrap();
        let h = db.get_history(id).unwrap();
        assert_eq!((h.final_text.as_str(), h.words), ("three whole words", 3));
        assert!(db.update_history_text(999, "x").is_err());
        db.delete_history(id);
        assert!(db.get_history(id).is_none());
        db.insert_history(&sample(1, "a", "b")).unwrap();
        db.clear_history();
        assert!(db.list_history(None, 10, 0).is_empty());
    }

    #[test]
    fn audio_path_sets_has_audio() {
        let db = Db::open_in_memory().unwrap();
        let mut h = sample(1, "a", "b");
        h.audio_path = Some("C:\\a.wav".into());
        let id = db.insert_history(&h).unwrap();
        assert!(db.get_history(id).unwrap().has_audio);
        assert_eq!(db.history_audio_path(id).as_deref(), Some("C:\\a.wav"));
    }

    #[test]
    fn purge_by_retention() {
        let now = 10 * 24 * 3600 * 1000;
        let db = Db::open_in_memory().unwrap();
        db.insert_history(&sample(now - 25 * 3600 * 1000, "old", "old"))
            .unwrap();
        db.insert_history(&sample(now - 3600 * 1000, "new", "new"))
            .unwrap();
        db.purge_history(Retention::Forever, now);
        assert_eq!(db.list_history(None, 10, 0).len(), 2);
        db.purge_history(Retention::Day, now);
        let left = db.list_history(None, 10, 0);
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].final_text, "new");
        db.purge_history(Retention::Never, now);
        assert!(db.list_history(None, 10, 0).is_empty());
    }

    fn with_audio(created_at: i64, path: Option<&str>) -> NewHistory {
        let mut h = sample(created_at, "r", "f");
        h.audio_path = path.map(str::to_string);
        h
    }

    #[test]
    fn delete_returns_audio_path() {
        let db = Db::open_in_memory().unwrap();
        let a = db.insert_history(&with_audio(1, Some("a.wav"))).unwrap();
        let b = db.insert_history(&with_audio(2, None)).unwrap();
        assert_eq!(db.delete_history(b), None);
        assert_eq!(db.delete_history(a).as_deref(), Some("a.wav"));
        assert_eq!(db.delete_history(a), None, "already gone");
        assert!(db.list_history(None, 10, 0).is_empty());
    }

    #[test]
    fn clear_returns_all_audio_paths() {
        let db = Db::open_in_memory().unwrap();
        db.insert_history(&with_audio(1, Some("a.wav"))).unwrap();
        db.insert_history(&with_audio(2, None)).unwrap();
        db.insert_history(&with_audio(3, Some("c.wav"))).unwrap();
        let mut paths = db.clear_history();
        paths.sort();
        assert_eq!(paths, vec!["a.wav", "c.wav"]);
        assert!(db.list_history(None, 10, 0).is_empty());
        assert!(db.clear_history().is_empty());
    }

    #[test]
    fn purge_returns_audio_paths_of_deleted_rows_only() {
        let now = 10 * 24 * 3600 * 1000;
        let db = Db::open_in_memory().unwrap();
        db.insert_history(&with_audio(now - 25 * 3600 * 1000, Some("old.wav")))
            .unwrap();
        db.insert_history(&with_audio(now - 3600 * 1000, Some("new.wav")))
            .unwrap();
        assert!(db.purge_history(Retention::Forever, now).is_empty());
        assert_eq!(db.purge_history(Retention::Day, now), vec!["old.wav"]);
        assert_eq!(db.list_history(None, 10, 0).len(), 1);
        assert_eq!(db.purge_history(Retention::Never, now), vec!["new.wav"]);
        assert!(db.list_history(None, 10, 0).is_empty());
    }

    #[test]
    fn stats_exclude_failed_items() {
        let db = Db::open_in_memory().unwrap();
        db.insert_history(&sample(1, "a b", "a b")).unwrap();
        let mut bad = sample(2, "x", "x");
        bad.error = Some("boom".into());
        db.insert_history(&bad).unwrap();
        let stats = db.history_stats();
        assert_eq!(stats.len(), 1);
        assert_eq!(stats[0].words, 2);
    }

    #[test]
    fn serializes_camel_case_without_null_error() {
        let db = Db::open_in_memory().unwrap();
        let id = db.insert_history(&sample(1, "a", "b")).unwrap();
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
