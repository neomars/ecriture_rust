//! `ecriture-core`: the framework-agnostic backend of the Écriture novel
//! writing app, ported from the original Python/Flask implementation
//! (`neomars/ecriture`).
//!
//! This crate intentionally has **no Tauri dependency**. The desktop shell
//! (`src-tauri`) is a thin adapter that exposes these functions as
//! `#[tauri::command]`s; keeping the logic here means it can be built and
//! tested with plain `cargo test`, without a GTK/WebKit toolchain.

pub mod ai;
pub mod backup;
pub mod export;
pub mod locale;
pub mod model;
pub mod project;
pub mod synonyms;
pub mod update;

pub use model::NovelData;
pub use project::{NovelProject, ProjectManager};
