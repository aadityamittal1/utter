//! The dictation pipeline: routing rules, text stage, session worker.

pub mod bindings;
pub mod machine;
pub mod process;
pub mod retry;
pub mod route;
pub mod session;

#[cfg(test)]
mod e2e;
