//! Personal dictionary: preferred spellings and misheard-form replacements.

use super::db::Db;
use crate::text::types::DictEntry;
use anyhow::{anyhow, Result};
use rusqlite::{params, OptionalExtension, Row};

pub const MAX_WORD_CHARS: usize = 60;

fn row_to_entry(r: &Row<'_>) -> rusqlite::Result<DictEntry> {
    Ok(DictEntry {
        id: r.get(0)?,
        word: r.get(1)?,
        heard_as: r.get(2)?,
        auto: r.get::<_, i64>(3)? != 0,
    })
}

/// Trim and validate a (word, heard_as) pair; empty `heard_as` becomes `None`.
fn normalize(word: &str, heard_as: Option<&str>) -> Result<(String, Option<String>)> {
    let word = word.trim();
    if word.is_empty() {
        return Err(anyhow!("word is empty"));
    }
    if word.chars().count() > MAX_WORD_CHARS {
        return Err(anyhow!("word is longer than {MAX_WORD_CHARS} characters"));
    }
    let heard = heard_as.map(str::trim).filter(|s| !s.is_empty());
    if let Some(h) = heard {
        if h.chars().count() > MAX_WORD_CHARS {
            return Err(anyhow!(
                "heard-as is longer than {MAX_WORD_CHARS} characters"
            ));
        }
    }
    Ok((word.to_string(), heard.map(str::to_string)))
}

impl Db {
    pub fn dictionary_list(&self) -> Vec<DictEntry> {
        let conn = self.conn();
        let result = (|| -> rusqlite::Result<Vec<DictEntry>> {
            let mut st = conn.prepare(
                "SELECT id, word, heard_as, auto FROM dictionary ORDER BY word COLLATE NOCASE, id",
            )?;
            let rows = st.query_map([], row_to_entry)?;
            rows.collect()
        })();
        result.unwrap_or_default()
    }

    /// Add an entry. An existing identical entry (case-insensitive) is returned instead of duplicated.
    pub fn dictionary_add(
        &self,
        word: &str,
        heard_as: Option<&str>,
        auto: bool,
    ) -> Result<DictEntry> {
        let (word, heard) = normalize(word, heard_as)?;
        let conn = self.conn();
        let existing = conn
            .query_row(
                "SELECT id, word, heard_as, auto FROM dictionary \
                 WHERE word = ?1 COLLATE NOCASE AND COALESCE(heard_as,'') = COALESCE(?2,'') COLLATE NOCASE",
                params![word, heard],
                row_to_entry,
            )
            .optional()?;
        if let Some(e) = existing {
            return Ok(e);
        }
        conn.execute(
            "INSERT INTO dictionary (word, heard_as, auto) VALUES (?1, ?2, ?3)",
            params![word, heard, auto as i64],
        )?;
        Ok(DictEntry {
            id: conn.last_insert_rowid(),
            word,
            heard_as: heard,
            auto,
        })
    }

    pub fn dictionary_update(&self, entry: &DictEntry) -> Result<DictEntry> {
        let (word, heard) = normalize(&entry.word, entry.heard_as.as_deref())?;
        let n = self.conn().execute(
            "UPDATE dictionary SET word = ?1, heard_as = ?2, auto = ?3 WHERE id = ?4",
            params![word, heard, entry.auto as i64, entry.id],
        )?;
        if n == 0 {
            return Err(anyhow!("dictionary entry {} not found", entry.id));
        }
        Ok(DictEntry {
            id: entry.id,
            word,
            heard_as: heard,
            auto: entry.auto,
        })
    }

    pub fn dictionary_delete(&self, id: i64) -> Result<()> {
        self.conn()
            .execute("DELETE FROM dictionary WHERE id = ?1", [id])?;
        Ok(())
    }

    /// Import `word,heard_as` CSV (header optional). Invalid rows are skipped; returns rows added.
    pub fn dictionary_import_csv(&self, text: &str) -> Result<usize> {
        let mut rdr = csv::ReaderBuilder::new()
            .has_headers(false)
            .flexible(true)
            .from_reader(text.trim_start_matches('\u{feff}').as_bytes());
        let mut added = 0;
        for (i, rec) in rdr.records().enumerate() {
            let Ok(rec) = rec else { continue };
            let word = rec.get(0).unwrap_or("");
            if i == 0 && word.trim().eq_ignore_ascii_case("word") {
                continue;
            }
            let before = self.dictionary_list().len();
            if self.dictionary_add(word, rec.get(1), false).is_ok()
                && self.dictionary_list().len() > before
            {
                added += 1;
            }
        }
        Ok(added)
    }

    pub fn dictionary_export_csv(&self) -> Result<String> {
        let mut w = csv::Writer::from_writer(Vec::new());
        w.write_record(["word", "heard_as"])?;
        for e in self.dictionary_list() {
            w.write_record([e.word.as_str(), e.heard_as.as_deref().unwrap_or("")])?;
        }
        Ok(String::from_utf8(w.into_inner()?)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_list_update_delete() {
        let db = Db::open_in_memory().unwrap();
        let e = db.dictionary_add("Utter", Some("udder"), false).unwrap();
        assert_eq!(e.heard_as.as_deref(), Some("udder"));
        let again = db.dictionary_add("utter", Some("UDDER"), false).unwrap();
        assert_eq!(again.id, e.id, "duplicate returns existing");
        db.dictionary_add("Zed", Some("  "), true).unwrap();
        let list = db.dictionary_list();
        assert_eq!(list.len(), 2);
        assert_eq!(list[1].heard_as, None);
        assert!(list[1].auto);
        let mut upd = e.clone();
        upd.word = "Utterly".into();
        assert_eq!(db.dictionary_update(&upd).unwrap().word, "Utterly");
        db.dictionary_delete(e.id).unwrap();
        assert_eq!(db.dictionary_list().len(), 1);
        upd.id = 999;
        assert!(db.dictionary_update(&upd).is_err());
    }

    #[test]
    fn rejects_over_60_chars_and_empty() {
        let db = Db::open_in_memory().unwrap();
        assert!(db.dictionary_add(&"a".repeat(61), None, false).is_err());
        assert!(db.dictionary_add(&"a".repeat(60), None, false).is_ok());
        assert!(db
            .dictionary_add("ok", Some(&"b".repeat(61)), false)
            .is_err());
        assert!(db.dictionary_add("   ", None, false).is_err());
    }

    #[test]
    fn csv_round_trip_skips_invalid() {
        let db = Db::open_in_memory().unwrap();
        let long = "x".repeat(61);
        let csv =
            format!("word,heard_as\nUtter,udder\n\"Smith, Jr.\",\n{long},\n,empty\nUtter,udder\n");
        assert_eq!(db.dictionary_import_csv(&csv).unwrap(), 2);
        let out = db.dictionary_export_csv().unwrap();
        let db2 = Db::open_in_memory().unwrap();
        assert_eq!(db2.dictionary_import_csv(&out).unwrap(), 2);
        let pairs = |d: &Db| -> Vec<(String, Option<String>)> {
            d.dictionary_list()
                .into_iter()
                .map(|e| (e.word, e.heard_as))
                .collect()
        };
        assert_eq!(pairs(&db2), pairs(&db));
        assert_eq!(pairs(&db)[0].0, "Smith, Jr.");
    }
}
