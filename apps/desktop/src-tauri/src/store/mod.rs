//! Local SQLite store behind History, Dictionary, Snippets, Transforms, Notes, Insights and usage.

pub mod db;
pub mod dictionary;
pub mod history;
pub mod insights;
pub mod notes;
pub mod snippets;
pub mod transforms;
pub mod usage;

pub use db::Db;
pub use history::{HistoryItem, HistoryMode, HistoryStat, NewHistory, Retention};
pub use insights::{compute_insights, AppWords, CategoryWords, Insights};
pub use notes::Note;
pub use transforms::Transform;
pub use usage::Usage;
