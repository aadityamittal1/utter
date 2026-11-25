//! Text transforms: two built-ins (Polish, Prompt engineer) plus up to 8 custom ones.

use super::db::Db;
use anyhow::{anyhow, Result};
use rusqlite::{params, Row};
use serde::{Deserialize, Serialize};

pub const MAX_CUSTOM_TRANSFORMS: usize = 8;
pub const MAX_NAME_CHARS: usize = 60;
pub const MAX_INSTRUCTION_CHARS: usize = 2000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transform {
    pub id: String,
    pub name: String,
    pub instruction: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shortcut: Option<String>,
    pub builtin: bool,
}

fn row_to_transform(r: &Row<'_>) -> rusqlite::Result<Transform> {
    Ok(Transform {
        id: r.get(0)?,
        name: r.get(1)?,
        instruction: r.get(2)?,
        shortcut: r.get(3)?,
        builtin: r.get::<_, i64>(4)? != 0,
    })
}

fn validate(name: &str, instruction: &str) -> Result<(String, String)> {
    let name = name.trim();
    let instruction = instruction.trim();
    if name.is_empty() {
        return Err(anyhow!("name is empty"));
    }
    if name.chars().count() > MAX_NAME_CHARS {
        return Err(anyhow!("name is longer than {MAX_NAME_CHARS} characters"));
    }
    if instruction.is_empty() {
        return Err(anyhow!("instruction is empty"));
    }
    if instruction.chars().count() > MAX_INSTRUCTION_CHARS {
        return Err(anyhow!(
            "instruction is longer than {MAX_INSTRUCTION_CHARS} characters"
        ));
    }
    Ok((name.to_string(), instruction.to_string()))
}

fn clean_shortcut(s: Option<&str>) -> Option<String> {
    s.map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

impl Db {
    /// Built-ins first, then custom transforms in creation order.
    pub fn transforms_list(&self) -> Vec<Transform> {
        let conn = self.conn();
        let result = (|| -> rusqlite::Result<Vec<Transform>> {
            let mut st = conn.prepare(
                "SELECT id, name, instruction, shortcut, builtin FROM transforms \
                 ORDER BY builtin DESC, position, rowid",
            )?;
            let rows = st.query_map([], row_to_transform)?;
            rows.collect()
        })();
        result.unwrap_or_default()
    }

    pub fn transforms_add(
        &self,
        name: &str,
        instruction: &str,
        shortcut: Option<&str>,
    ) -> Result<Transform> {
        let (name, instruction) = validate(name, instruction)?;
        let shortcut = clean_shortcut(shortcut);
        let conn = self.conn();
        let custom: i64 = conn.query_row(
            "SELECT COUNT(*) FROM transforms WHERE builtin = 0",
            [],
            |r| r.get(0),
        )?;
        if custom as usize >= MAX_CUSTOM_TRANSFORMS {
            return Err(anyhow!(
                "at most {MAX_CUSTOM_TRANSFORMS} custom transforms are allowed"
            ));
        }
        let position: i64 = conn.query_row(
            "SELECT COALESCE(MAX(position), 1) + 1 FROM transforms",
            [],
            |r| r.get(0),
        )?;
        // Ids appear in shortcut action names (`transform:<id>`), so keep them short and URL-safe.
        let mut n = chrono::Utc::now().timestamp_micros();
        let id = loop {
            let candidate = format!("t{n:x}");
            let taken: i64 = conn.query_row(
                "SELECT COUNT(*) FROM transforms WHERE id = ?1",
                [&candidate],
                |r| r.get(0),
            )?;
            if taken == 0 {
                break candidate;
            }
            n += 1;
        };
        conn.execute(
            "INSERT INTO transforms (id, name, instruction, shortcut, builtin, position) \
             VALUES (?1, ?2, ?3, ?4, 0, ?5)",
            params![id, name, instruction, shortcut, position],
        )?;
        Ok(Transform {
            id,
            name,
            instruction,
            shortcut,
            builtin: false,
        })
    }

    /// Update a transform. For built-ins only the shortcut can change.
    pub fn transforms_update(&self, t: &Transform) -> Result<Transform> {
        let conn = self.conn();
        let (builtin, cur_name, cur_instr): (i64, String, String) = conn
            .query_row(
                "SELECT builtin, name, instruction FROM transforms WHERE id = ?1",
                [&t.id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .map_err(|_| anyhow!("transform {} not found", t.id))?;
        let shortcut = clean_shortcut(t.shortcut.as_deref());
        let (name, instruction) = if builtin != 0 {
            (cur_name, cur_instr)
        } else {
            validate(&t.name, &t.instruction)?
        };
        conn.execute(
            "UPDATE transforms SET name = ?1, instruction = ?2, shortcut = ?3 WHERE id = ?4",
            params![name, instruction, shortcut, t.id],
        )?;
        Ok(Transform {
            id: t.id.clone(),
            name,
            instruction,
            shortcut,
            builtin: builtin != 0,
        })
    }

    pub fn transforms_delete(&self, id: &str) -> Result<()> {
        let n = self
            .conn()
            .execute("DELETE FROM transforms WHERE id = ?1 AND builtin = 0", [id])?;
        if n == 0 {
            return Err(anyhow!("transform {id} not found or is built in"));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seeds_builtins_with_shortcuts() {
        let db = Db::open_in_memory().unwrap();
        let list = db.transforms_list();
        assert_eq!(list.len(), 2);
        assert_eq!(
            (list[0].id.as_str(), list[0].name.as_str()),
            ("polish", "Polish")
        );
        assert_eq!(list[0].shortcut.as_deref(), Some("Alt+Shift+1"));
        assert_eq!(
            (list[1].id.as_str(), list[1].name.as_str()),
            ("prompt", "Prompt engineer")
        );
        assert_eq!(list[1].shortcut.as_deref(), Some("Alt+Shift+2"));
        assert!(list.iter().all(|t| t.builtin));
    }

    #[test]
    fn ninth_custom_transform_is_rejected() {
        let db = Db::open_in_memory().unwrap();
        for i in 0..8 {
            db.transforms_add(&format!("T{i}"), "Do a thing.", None)
                .unwrap();
        }
        assert!(db.transforms_add("T9", "Do a thing.", None).is_err());
        assert_eq!(db.transforms_list().len(), 10);
        let victim = db.transforms_list().pop().unwrap();
        db.transforms_delete(&victim.id).unwrap();
        assert!(db.transforms_add("T9", "Do a thing.", None).is_ok());
    }

    #[test]
    fn ids_unique_and_custom_listed_in_creation_order() {
        let db = Db::open_in_memory().unwrap();
        let a = db.transforms_add("A", "a", Some("Alt+Shift+3")).unwrap();
        let b = db.transforms_add("B", "b", None).unwrap();
        assert_ne!(a.id, b.id);
        let ids: Vec<_> = db.transforms_list().into_iter().map(|t| t.id).collect();
        assert_eq!(ids, vec!["polish".to_string(), "prompt".into(), a.id, b.id]);
    }

    #[test]
    fn builtins_cannot_be_deleted_or_renamed_only_reshortcut() {
        let db = Db::open_in_memory().unwrap();
        assert!(db.transforms_delete("polish").is_err());
        let mut t = db.transforms_list().remove(0);
        t.name = "Hacked".into();
        t.shortcut = Some("Alt+Shift+9".into());
        let out = db.transforms_update(&t).unwrap();
        assert_eq!(out.name, "Polish");
        assert_eq!(out.shortcut.as_deref(), Some("Alt+Shift+9"));
        assert!(out.builtin);
    }

    #[test]
    fn update_custom_and_validate() {
        let db = Db::open_in_memory().unwrap();
        assert!(db.transforms_add("", "x", None).is_err());
        assert!(db.transforms_add("x", "  ", None).is_err());
        let mut t = db
            .transforms_add("Short", "Make it shorter.", None)
            .unwrap();
        t.name = "Shorter".into();
        t.shortcut = Some("Alt+Shift+4".into());
        let out = db.transforms_update(&t).unwrap();
        assert_eq!(out.name, "Shorter");
        assert_eq!(out.shortcut.as_deref(), Some("Alt+Shift+4"));
        t.id = "nope".into();
        assert!(db.transforms_update(&t).is_err());
    }

    #[test]
    fn serializes_without_null_shortcut() {
        let t = Transform {
            id: "x".into(),
            name: "n".into(),
            instruction: "i".into(),
            shortcut: None,
            builtin: false,
        };
        let v = serde_json::to_value(&t).unwrap();
        assert!(v.get("shortcut").is_none());
        assert_eq!(v["builtin"], false);
    }
}
