//! Local project backups: timestamped JSON snapshots dropped into a
//! user-chosen folder, and restore-from-snapshot. Ports the
//! `/api/backups/local/{create,list,restore}` routes from `main.py`.
//!
//! Note: the Python `local_backup_list` route filters backups by a
//! `project.data['id']` field that no project ever actually has (it's not
//! part of the schema written anywhere), so in practice every call returns
//! an empty/error list - a latent bug. Here, [`list_backups`] simply lists
//! every `backup_*.json` file in the folder, sorted newest first, which is
//! what the feature is actually meant to do.

use crate::model::NovelData;
use std::fs;
use std::path::{Path, PathBuf};
use time::OffsetDateTime;

#[derive(Debug, thiserror::Error)]
pub enum BackupError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("backup file not found")]
    NotFound,
    #[error("invalid backup filename")]
    InvalidFilename,
}

pub type Result<T> = std::result::Result<T, BackupError>;

#[derive(Debug, Clone, serde::Serialize)]
pub struct BackupInfo {
    pub filename: String,
    pub path: PathBuf,
    pub modified_unix: i64,
    pub size_bytes: u64,
}

/// Sanitises the project title into the filesystem-safe fragment used by
/// `main.py`: keep alphanumerics, spaces, `_` and `-`, trim trailing
/// whitespace, then turn spaces into underscores.
fn clean_title_fragment(title: &str) -> String {
    let filtered: String = title
        .chars()
        .filter(|c| c.is_alphanumeric() || matches!(c, ' ' | '_' | '-'))
        .collect();
    filtered.trim_end().replace(' ', "_")
}

fn timestamp_suffix() -> String {
    let now = OffsetDateTime::now_utc();
    format!(
        "{:04}-{:02}-{:02}_{:02}-{:02}-{:02}",
        now.year(),
        u8::from(now.month()),
        now.day(),
        now.hour(),
        now.minute(),
        now.second()
    )
}

/// Writes a timestamped JSON snapshot of `data` into `folder`, creating the
/// folder if necessary. Returns the created filename.
pub fn create_backup(folder: impl AsRef<Path>, data: &NovelData, frequency: &str) -> Result<String> {
    let folder = folder.as_ref();
    fs::create_dir_all(folder)?;

    let clean_title = clean_title_fragment(&data.settings.title);
    let title = if clean_title.is_empty() { "roman".to_string() } else { clean_title };
    let filename = format!("backup_{title}_{}_{frequency}.json", timestamp_suffix());
    let full_path = folder.join(&filename);

    let content = serde_json::to_string_pretty(data)?;
    fs::write(full_path, content)?;
    Ok(filename)
}

/// Lists every backup snapshot found directly inside `folder`, most
/// recently modified first. A missing folder yields an empty list rather
/// than an error (matching the Python route's graceful handling).
pub fn list_backups(folder: impl AsRef<Path>) -> Result<Vec<BackupInfo>> {
    let folder = folder.as_ref();
    if !folder.exists() {
        return Ok(Vec::new());
    }

    let mut backups = Vec::new();
    for entry in fs::read_dir(folder)? {
        let entry = entry?;
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !name.starts_with("backup_") || !name.ends_with(".json") {
            continue;
        }
        let meta = entry.metadata()?;
        let modified_unix = meta
            .modified()
            .ok()
            .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        backups.push(BackupInfo {
            filename: name.to_string(),
            path: path.clone(),
            modified_unix,
            size_bytes: meta.len(),
        });
    }
    backups.sort_by(|a, b| b.modified_unix.cmp(&a.modified_unix));
    Ok(backups)
}

/// Loads a backup snapshot and returns the parsed project data, ready to
/// replace the active project's in-memory state and be saved. Rejects
/// filenames containing path separators to avoid path traversal, matching
/// the Python route's `secure_filename` sanitisation.
pub fn restore_backup(folder: impl AsRef<Path>, filename: &str) -> Result<NovelData> {
    if filename.contains('/') || filename.contains('\\') || filename.contains("..") {
        return Err(BackupError::InvalidFilename);
    }
    let path = folder.as_ref().join(filename);
    if !path.exists() {
        return Err(BackupError::NotFound);
    }
    let content = fs::read_to_string(path)?;
    Ok(serde_json::from_str(&content)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn create_backup_writes_a_timestamped_snapshot() {
        let dir = tempdir().unwrap();
        let data = NovelData::default();
        let filename = create_backup(dir.path(), &data, "manual").unwrap();

        assert!(filename.starts_with("backup_Pride_Prejudice_(Copy)_") || filename.starts_with("backup_Pride"));
        assert!(filename.ends_with("_manual.json"));
        assert!(dir.path().join(&filename).exists());
    }

    #[test]
    fn create_backup_falls_back_to_roman_for_blank_title() {
        let dir = tempdir().unwrap();
        let mut data = NovelData::default();
        data.settings.title = "***".to_string();
        let filename = create_backup(dir.path(), &data, "manual").unwrap();
        assert!(filename.starts_with("backup_roman_"));
    }

    #[test]
    fn list_backups_on_missing_folder_is_empty_not_an_error() {
        let dir = tempdir().unwrap();
        let missing = dir.path().join("does_not_exist");
        assert_eq!(list_backups(missing).unwrap().len(), 0);
    }

    #[test]
    fn list_backups_filters_by_prefix_and_sorts_newest_first() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("backup_a_manual.json"), "{}").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(1100));
        fs::write(dir.path().join("backup_b_manual.json"), "{}").unwrap();
        fs::write(dir.path().join("not_a_backup.json"), "{}").unwrap();
        fs::write(dir.path().join("backup_ignored.txt"), "nope").unwrap();

        let backups = list_backups(dir.path()).unwrap();
        assert_eq!(backups.len(), 2);
        assert_eq!(backups[0].filename, "backup_b_manual.json");
    }

    #[test]
    fn restore_backup_round_trips_project_data() {
        let dir = tempdir().unwrap();
        let mut data = NovelData::default();
        data.settings.title = "Restored Title".into();
        let filename = create_backup(dir.path(), &data, "daily").unwrap();

        let restored = restore_backup(dir.path(), &filename).unwrap();
        assert_eq!(restored.settings.title, "Restored Title");
    }

    #[test]
    fn restore_backup_rejects_path_traversal() {
        let dir = tempdir().unwrap();
        assert!(matches!(
            restore_backup(dir.path(), "../../etc/passwd"),
            Err(BackupError::InvalidFilename)
        ));
        assert!(matches!(
            restore_backup(dir.path(), "sub/dir.json"),
            Err(BackupError::InvalidFilename)
        ));
    }

    #[test]
    fn restore_backup_missing_file_errors() {
        let dir = tempdir().unwrap();
        assert!(matches!(
            restore_backup(dir.path(), "backup_ghost.json"),
            Err(BackupError::NotFound)
        ));
    }
}
