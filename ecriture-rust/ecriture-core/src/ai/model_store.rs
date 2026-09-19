//! Resolves where the local Gemma GGUF model file lives on disk.
//!
//! This is deliberately **independent** from the original Python app
//! (`github.com/neomars/ecriture`), which caches its model under
//! `~/.cache/ecriture` (see its `util.py::get_model_dir`). This Rust port
//! (`github.com/neomars/ecriture-rust`) is a separate piece of software
//! with its own working directory, `~/.cache/ecriture-rust` - the two
//! don't share a model file, even though the Python directory happens to
//! use a similarly-named cache folder for its own, unrelated data. The
//! candidate order below otherwise mirrors the Python app's
//! `util.py::get_model_dir` fallback strategy.
pub const MODEL_FILENAME: &str = "gemma-2-2b-it-Q8_0.gguf";
pub const MODEL_URL: &str =
    "https://huggingface.co/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it-Q8_0.gguf";

use std::path::{Path, PathBuf};

/// The context window size the model is loaded with
/// (matches the Python app's `Llama(..., n_ctx=8192, ...)`).
pub const N_CTX: u32 = 8192;

/// Environment variable that overrides the cache directory.
const ENV_OVERRIDE: &str = "ECRITURE_RUST_MODEL_DIR";

/// Picks the best writable directory to store the model, trying candidates
/// in order:
/// 1. `$ECRITURE_RUST_MODEL_DIR`
/// 2. `$XDG_CACHE_HOME/ecriture-rust`
/// 3. `~/.cache/ecriture-rust`
/// 4. `<cwd>/ecriture-rust_models`
/// 5. `<system temp dir>/ecriture-rust`
///
/// Each candidate is probed with a real write (a throwaway file) so a
/// read-only or missing filesystem is skipped rather than silently
/// returning an unusable path.
pub fn model_cache_dir() -> PathBuf {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(dir) = std::env::var(ENV_OVERRIDE) {
        if !dir.is_empty() {
            candidates.push(PathBuf::from(dir));
        }
    }
    if let Ok(xdg) = std::env::var("XDG_CACHE_HOME") {
        if !xdg.is_empty() {
            candidates.push(PathBuf::from(xdg).join("ecriture-rust"));
        }
    }
    if let Some(home) = std::env::var_os("HOME") {
        candidates.push(PathBuf::from(home).join(".cache").join("ecriture-rust"));
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("ecriture-rust_models"));
    }
    candidates.push(std::env::temp_dir().join("ecriture-rust"));

    for candidate in &candidates {
        if is_writable_dir(candidate) {
            return candidate.clone();
        }
    }

    // Last-resort fallback, matching the Python function's unconditional
    // final fallback.
    let fallback = std::env::temp_dir().join("ecriture-rust");
    let _ = std::fs::create_dir_all(&fallback);
    fallback
}

fn is_writable_dir(dir: &Path) -> bool {
    if std::fs::create_dir_all(dir).is_err() {
        return false;
    }
    let probe = dir.join(".write_test");
    if std::fs::write(&probe, b"test").is_err() {
        return false;
    }
    let _ = std::fs::remove_file(&probe);
    true
}

pub fn model_path(cache_dir: &Path) -> PathBuf {
    cache_dir.join(MODEL_FILENAME)
}

pub fn is_model_installed(cache_dir: &Path) -> bool {
    model_path(cache_dir).is_file()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn env_override_takes_priority() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("custom_models");
        temp_env::with_var(ENV_OVERRIDE, Some(target.to_str().unwrap()), || {
            let resolved = model_cache_dir();
            assert_eq!(resolved, target);
            assert!(target.exists());
        });
    }

    #[test]
    fn model_path_appends_expected_filename() {
        let dir = tempdir().unwrap();
        let path = model_path(dir.path());
        assert_eq!(path.file_name().unwrap(), MODEL_FILENAME);
    }

    #[test]
    fn is_model_installed_reflects_file_presence() {
        let dir = tempdir().unwrap();
        assert!(!is_model_installed(dir.path()));
        std::fs::write(model_path(dir.path()), b"fake gguf bytes").unwrap();
        assert!(is_model_installed(dir.path()));
    }

    #[test]
    fn is_writable_dir_rejects_a_file_masquerading_as_a_directory() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("not_a_dir");
        std::fs::write(&file_path, b"x").unwrap();
        assert!(!is_writable_dir(&file_path));
    }
}
