//! Foreground-app classification into a `Category`.

use crate::text::types::Category;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppInfo {
    pub process: String,
    pub title: String,
    pub hwnd: isize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryRule {
    pub category: Category,
    pub process: Option<String>,
    pub title_contains: Option<String>,
}

/// Built-in rules; filled in by the context task.
pub fn default_rules() -> Vec<CategoryRule> {
    Vec::new()
}
