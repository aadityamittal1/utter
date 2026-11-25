//! Voice snippets: a spoken trigger that expands to longer text.

use super::db::Db;
use crate::text::types::Snippet;
use anyhow::{anyhow, Result};
use rusqlite::{params, Row};

pub const MAX_TRIGGER_CHARS: usize = 60;
pub const MAX_EXPANSION_CHARS: usize = 4000;

fn row_to_snippet(r: &Row<'_>) -> rusqlite::Result<Snippet> {
    Ok(Snippet {
        id: r.get(0)?,
        trigger: r.get(1)?,
        expansion: r.get(2)?,
    })
}

fn validate(trigger: &str, expansion: &str) -> Result<String> {
    let trigger = trigger.trim();
    if trigger.is_empty() {
        return Err(anyhow!("trigger is empty"));
    }
    if trigger.chars().count() > MAX_TRIGGER_CHARS {
        return Err(anyhow!(
            "trigger is longer than {MAX_TRIGGER_CHARS} characters"
        ));
    }
    if expansion.trim().is_empty() {
        return Err(anyhow!("expansion is empty"));
    }
    if expansion.chars().count() > MAX_EXPANSION_CHARS {
        return Err(anyhow!(
            "expansion is longer than {MAX_EXPANSION_CHARS} characters"
        ));
    }
    Ok(trigger.to_string())
}

impl Db {
    pub fn snippets_list(&self) -> Vec<Snippet> {
        let conn = self.conn();
        let result = (|| -> rusqlite::Result<Vec<Snippet>> {
            let mut st = conn.prepare(
                "SELECT id, trigger, expansion FROM snippets ORDER BY trigger COLLATE NOCASE, id",
            )?;
            let rows = st.query_map([], row_to_snippet)?;
            rows.collect()
        })();
        result.unwrap_or_default()
    }

    /// Add a snippet; triggers are unique case-insensitively.
    pub fn snippets_add(&self, trigger: &str, expansion: &str) -> Result<Snippet> {
        let trigger = validate(trigger, expansion)?;
        let conn = self.conn();
        let dup: i64 = conn.query_row(
            "SELECT COUNT(*) FROM snippets WHERE trigger = ?1 COLLATE NOCASE",
            [&trigger],
            |r| r.get(0),
        )?;
        if dup > 0 {
            return Err(anyhow!(
                "a snippet with trigger \"{trigger}\" already exists"
            ));
        }
        conn.execute(
            "INSERT INTO snippets (trigger, expansion) VALUES (?1, ?2)",
            params![trigger, expansion],
        )?;
        Ok(Snippet {
            id: conn.last_insert_rowid(),
            trigger,
            expansion: expansion.to_string(),
        })
    }

    pub fn snippets_update(&self, s: &Snippet) -> Result<Snippet> {
        let trigger = validate(&s.trigger, &s.expansion)?;
        let conn = self.conn();
        let dup: i64 = conn.query_row(
            "SELECT COUNT(*) FROM snippets WHERE trigger = ?1 COLLATE NOCASE AND id != ?2",
            params![trigger, s.id],
            |r| r.get(0),
        )?;
        if dup > 0 {
            return Err(anyhow!(
                "a snippet with trigger \"{trigger}\" already exists"
            ));
        }
        let n = conn.execute(
            "UPDATE snippets SET trigger = ?1, expansion = ?2 WHERE id = ?3",
            params![trigger, s.expansion, s.id],
        )?;
        if n == 0 {
            return Err(anyhow!("snippet {} not found", s.id));
        }
        Ok(Snippet {
            id: s.id,
            trigger,
            expansion: s.expansion.clone(),
        })
    }

    pub fn snippets_delete(&self, id: i64) -> Result<()> {
        self.conn()
            .execute("DELETE FROM snippets WHERE id = ?1", [id])?;
        Ok(())
    }

    /// Import `trigger,expansion` CSV (header optional). Invalid or duplicate rows are skipped.
    pub fn snippets_import_csv(&self, text: &str) -> Result<usize> {
        let mut rdr = csv::ReaderBuilder::new()
            .has_headers(false)
            .flexible(true)
            .from_reader(text.trim_start_matches('\u{feff}').as_bytes());
        let mut added = 0;
        let mut data_rows = 0;
        for (i, rec) in rdr.records().enumerate() {
            let Ok(rec) = rec else { continue };
            let trigger = rec.get(0).unwrap_or("");
            let expansion = rec.get(1).unwrap_or("");
            if i == 0
                && trigger.trim().eq_ignore_ascii_case("trigger")
                && expansion.trim().eq_ignore_ascii_case("expansion")
            {
                continue;
            }
            data_rows += 1;
            if data_rows > super::dictionary::MAX_IMPORT_ROWS {
                break;
            }
            if self.snippets_add(trigger, expansion).is_ok() {
                added += 1;
            }
        }
        Ok(added)
    }

    pub fn snippets_export_csv(&self) -> Result<String> {
        let mut w = csv::Writer::from_writer(Vec::new());
        w.write_record(["trigger", "expansion"])?;
        for s in self.snippets_list() {
            w.write_record([s.trigger.as_str(), s.expansion.as_str()])?;
        }
        Ok(String::from_utf8(w.into_inner()?)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crud_and_unique_trigger() {
        let db = Db::open_in_memory().unwrap();
        let s = db.snippets_add("my email", "me@example.com").unwrap();
        assert!(db.snippets_add("MY EMAIL", "x").is_err());
        let mut upd = s.clone();
        upd.expansion = "other@example.com".into();
        assert_eq!(
            db.snippets_update(&upd).unwrap().expansion,
            "other@example.com"
        );
        assert_eq!(db.snippets_list().len(), 1);
        db.snippets_delete(s.id).unwrap();
        assert!(db.snippets_list().is_empty());
        upd.id = 77;
        assert!(db.snippets_update(&upd).is_err());
    }

    #[test]
    fn enforces_length_limits() {
        let db = Db::open_in_memory().unwrap();
        assert!(db.snippets_add(&"t".repeat(61), "x").is_err());
        assert!(db.snippets_add(&"t".repeat(60), "x").is_ok());
        assert!(db.snippets_add("big", &"e".repeat(4001)).is_err());
        assert!(db.snippets_add("big", &"e".repeat(4000)).is_ok());
        assert!(db.snippets_add("", "x").is_err());
    }

    #[test]
    fn csv_round_trip_with_commas_quotes_newlines() {
        let db = Db::open_in_memory().unwrap();
        let tricky = "Hi,\n\"Quoted\" line, with commas\r\nBye";
        db.snippets_add("sig", tricky).unwrap();
        db.snippets_add("plain", "hello").unwrap();
        let out = db.snippets_export_csv().unwrap();
        assert!(out.starts_with("trigger,expansion"));
        let db2 = Db::open_in_memory().unwrap();
        assert_eq!(db2.snippets_import_csv(&out).unwrap(), 2);
        let sig = db2
            .snippets_list()
            .into_iter()
            .find(|s| s.trigger == "sig")
            .unwrap();
        assert_eq!(sig.expansion, tricky);
    }

    #[test]
    fn csv_import_is_capped_at_5000_rows() {
        let db = Db::open_in_memory().unwrap();
        let mut csv = String::from("trigger,expansion\n");
        for i in 0..5050 {
            csv.push_str(&format!("t{i},x\n"));
        }
        assert_eq!(db.snippets_import_csv(&csv).unwrap(), 5000);
    }

    #[test]
    fn import_skips_invalid_rows() {
        let db = Db::open_in_memory().unwrap();
        let long = "t".repeat(61);
        let csv = format!("trigger,expansion\na,one\n{long},x\nb,\na,dup\nc,three\n");
        assert_eq!(db.snippets_import_csv(&csv).unwrap(), 2);
    }
}
