//! Resolves where the local Gemma GGUF model file lives on disk. Ports
//! `util.py::get_model_dir` and the model path/filename constants from
//! `ai_client.py`/`main.py`.

use std::path::{Path, PathBuf};

/// Exact filename `ai_client.py` uses, and the Hugging Face path it comes
/// from (see `main.py::_install_gemma_thread`). Kept identical so a model
/// downloaded by the Python app is recognised by this build and vice versa.
pub const MODEL_FILENAME: &str = "gemma-2-2b-it-Q8_0.gguf";
pub const MODEL_URL: &str =
    "https://huggingface.co/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it-Q8_0.gguf";

/// The context window size the Python app loads the model with
/// (`Llama(..., n_ctx=8192, ...)`).
pub const N_CTX: u32 = 8192;

/// Environment variable that overrides the cache directory, matching
/// `ECRITURE_MODEL_DIR` in the Python app.
const ENV_OVERRIDE: &str = "ECRITURE_MODEL_DIR";

/// Picks the best writable directory to store the model, trying candidates
/// in the same order as `util.py::get_model_dir`:
/// 1. `$ECRITURE_MODEL_DIR`
/// 2. `$XDG_CACHE_HOME/ecriture`
/// 3. `~/.cache/ecriture`
/// 4. `<cwd>/ecriture_models`
/// 5. `<system temp dir>/ecriture`
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
            candidates.push(PathBuf::from(xdg).join("ecriture"));
        }
    }
    if let Some(home) = std::env::var_os("HOME") {
        candidates.push(PathBuf::from(home).join(".cache").join("ecriture"));
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("ecriture_models"));
    }
    candidates.push(std::env::temp_dir().join("ecriture"));

    for candidate in &candidates {
        if is_writable_dir(candidate) {
            return candidate.clone();
        }
    }

    // Last-resort fallback, matching the Python function's unconditional
    // final fallback.
    let fallback = std::env::temp_dir().join("ecriture");
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
