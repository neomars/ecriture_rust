//! UI translation strings, embedded at compile time.
//!
//! Ports `main.py`'s `/api/locale/<lang>` route. Unlike the Python version
//! (which reads the JSON file from disk on every request), the strings are
//! baked into the binary with `include_str!` so a packaged desktop app
//! never has to ship or locate a `locales/` directory at runtime.

use serde_json::Value;

const EN: &str = include_str!("../locales/en.json");
const FR: &str = include_str!("../locales/fr.json");
const ES: &str = include_str!("../locales/es.json");
const RU: &str = include_str!("../locales/ru.json");

pub const SUPPORTED_LANGS: &[&str] = &["en", "fr", "es", "ru"];

#[derive(Debug, thiserror::Error)]
pub enum LocaleError {
    #[error("embedded locale JSON is malformed: {0}")]
    Malformed(#[from] serde_json::Error),
}

/// Returns the parsed translation table for `lang`, falling back to
/// English for any unrecognised code (matching the Python route's
/// `if lang not in [...]: lang = "en"`).
pub fn get_locale(lang: &str) -> Result<Value, LocaleError> {
    let raw = match lang {
        "fr" => FR,
        "es" => ES,
        "ru" => RU,
        _ => EN,
    };
    Ok(serde_json::from_str(raw)?)
}

/// Fetches a single translation string, returning `default` when the key
/// is absent (used by the AI fallback simulator).
pub fn get_string(lang: &str, key: &str, default: &str) -> String {
    get_locale(lang)
        .ok()
        .and_then(|v| v.get(key).and_then(|s| s.as_str()).map(str::to_string))
        .unwrap_or_else(|| default.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_embedded_locale_parses_and_has_app_title() {
        for lang in SUPPORTED_LANGS {
            let locale = get_locale(lang).unwrap();
            assert!(
                locale.get("app_title").is_some(),
                "{lang} locale is missing app_title"
            );
        }
    }

    #[test]
    fn unknown_language_falls_back_to_english() {
        let en = get_locale("en").unwrap();
        let unknown = get_locale("klingon").unwrap();
        assert_eq!(en, unknown);
    }

    #[test]
    fn get_string_returns_default_for_missing_key() {
        assert_eq!(
            get_string("en", "this_key_does_not_exist", "fallback"),
            "fallback"
        );
    }
}
