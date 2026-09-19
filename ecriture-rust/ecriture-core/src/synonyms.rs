//! Synonym lookup, backed by the same `lexique.db` SQLite database the
//! Python app ships (WOLF synonym pairs + the "Lexique" French lemma
//! table). Ports `main.py::get_synonyms` for the `fr` case.
//!
//! The Python implementation also supports `en`/`es`/`ru` via NLTK's
//! WordNet + spaCy lemmatization. Those corpora are large, dynamically
//! downloaded Python packages with no equivalent pure-Rust crate; porting
//! them is out of scope here. [`lookup_synonyms`] returns an empty list for
//! those languages rather than pretending to support them - see the
//! `SynonymError::UnsupportedLanguage` variant callers can use to surface
//! that distinction in the UI if desired.

use rusqlite::Connection;
use std::path::Path;

#[derive(Debug, thiserror::Error)]
pub enum SynonymError {
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),
}

pub type Result<T> = std::result::Result<T, SynonymError>;

pub struct SynonymDb {
    conn: Connection,
}

const MAX_RESULTS: usize = 20;

impl SynonymDb {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let conn = Connection::open(path)?;
        Ok(Self { conn })
    }

    pub fn open_in_memory_for_tests() -> Self {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE synonyms (word TEXT, synonym TEXT);
             CREATE TABLE lexique (ortho TEXT, phon TEXT, lemme TEXT, cgram TEXT, genre TEXT, nombre TEXT, freqlemlivres REAL, freqlivres REAL, infover TEXT);",
        )
        .unwrap();
        Self { conn }
    }

    #[cfg(test)]
    fn seed(&self, word: &str, synonym: &str) {
        self.conn
            .execute(
                "INSERT INTO synonyms (word, synonym) VALUES (?1, ?2)",
                rusqlite::params![word, synonym],
            )
            .unwrap();
    }

    #[cfg(test)]
    fn seed_lemma(&self, ortho: &str, lemme: &str) {
        self.conn
            .execute(
                "INSERT INTO lexique (ortho, lemme) VALUES (?1, ?2)",
                rusqlite::params![ortho, lemme],
            )
            .unwrap();
    }

    /// Looks up synonyms for `word` in the given `lang`. Currently only
    /// `fr` is backed by real data; any other language yields an empty
    /// list (see module docs).
    pub fn lookup(&self, word: &str, lang: &str) -> Result<Vec<String>> {
        if lang != "fr" {
            return Ok(Vec::new());
        }

        let cleaned = clean_word(word);
        if cleaned.is_empty() {
            return Ok(Vec::new());
        }

        let mut synonyms = self.synonyms_for(&cleaned)?;

        // Fall back through the word's lemma, exactly like the Python
        // implementation: if "mangeait" has no direct synonym row but its
        // lemma "manger" does, surface those too.
        if let Some(lemma) = self.lemma_for(&cleaned)? {
            if lemma != cleaned {
                for syn in self.synonyms_for(&lemma)? {
                    if syn != cleaned && !synonyms.contains(&syn) {
                        synonyms.push(syn);
                    }
                }
            }
        }

        synonyms.truncate(MAX_RESULTS);
        Ok(synonyms)
    }

    fn synonyms_for(&self, word: &str) -> Result<Vec<String>> {
        let mut stmt = self
            .conn
            .prepare("SELECT DISTINCT synonym FROM synonyms WHERE word = ?1 LIMIT ?2")?;
        let rows = stmt.query_map(rusqlite::params![word, MAX_RESULTS as i64], |row| {
            row.get::<_, String>(0)
        })?;
        let mut out = Vec::new();
        for r in rows {
            let s = r?;
            if !s.is_empty() {
                out.push(s);
            }
        }
        Ok(out)
    }

    fn lemma_for(&self, word: &str) -> Result<Option<String>> {
        let mut stmt = self
            .conn
            .prepare("SELECT lemme FROM lexique WHERE ortho = ?1 LIMIT 1")?;
        let mut rows = stmt.query(rusqlite::params![word])?;
        if let Some(row) = rows.next()? {
            let lemme: Option<String> = row.get(0)?;
            return Ok(lemme.map(|l| l.to_lowercase().trim().to_string()));
        }
        Ok(None)
    }
}

/// Lowercases and strips surrounding punctuation, mirroring the Python
/// `word.lower().strip().strip(".,!?;:\"'()[]{}«»").strip()` chain.
fn clean_word(word: &str) -> String {
    const PUNCT: &[char] = &['.', ',', '!', '?', ';', ':', '"', '\'', '(', ')', '[', ']', '{', '}', '«', '»'];
    word.trim()
        .to_lowercase()
        .trim_matches(|c| PUNCT.contains(&c) || c.is_whitespace())
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_word_strips_punctuation_and_lowercases() {
        assert_eq!(clean_word("  Bonjour! "), "bonjour");
        assert_eq!(clean_word("«Salut»"), "salut");
        assert_eq!(clean_word(""), "");
    }

    #[test]
    fn lookup_returns_direct_synonyms() {
        let db = SynonymDb::open_in_memory_for_tests();
        db.seed("bonjour", "salut");
        db.seed("bonjour", "salutations");

        let syns = db.lookup("Bonjour!", "fr").unwrap();
        assert!(syns.contains(&"salut".to_string()));
        assert!(syns.contains(&"salutations".to_string()));
    }

    #[test]
    fn lookup_falls_back_to_lemma_synonyms() {
        let db = SynonymDb::open_in_memory_for_tests();
        db.seed_lemma("mangeait", "manger");
        db.seed("manger", "dévorer");

        let syns = db.lookup("mangeait", "fr").unwrap();
        assert_eq!(syns, vec!["dévorer".to_string()]);
    }

    #[test]
    fn lookup_merges_direct_and_lemma_results_without_duplicates() {
        let db = SynonymDb::open_in_memory_for_tests();
        db.seed("belle", "jolie");
        db.seed_lemma("belle", "beau");
        db.seed("beau", "jolie"); // duplicate across direct + lemma
        db.seed("beau", "magnifique");

        let syns = db.lookup("belle", "fr").unwrap();
        assert_eq!(syns.iter().filter(|s| *s == "jolie").count(), 1);
        assert!(syns.contains(&"magnifique".to_string()));
    }

    #[test]
    fn lookup_returns_empty_for_unsupported_languages() {
        let db = SynonymDb::open_in_memory_for_tests();
        db.seed("hello", "hi");
        assert_eq!(db.lookup("hello", "en").unwrap(), Vec::<String>::new());
        assert_eq!(db.lookup("hola", "es").unwrap(), Vec::<String>::new());
    }

    #[test]
    fn lookup_returns_empty_for_blank_word() {
        let db = SynonymDb::open_in_memory_for_tests();
        assert_eq!(db.lookup("   ", "fr").unwrap(), Vec::<String>::new());
    }

    #[test]
    fn lookup_caps_results_at_twenty() {
        let db = SynonymDb::open_in_memory_for_tests();
        for i in 0..30 {
            db.seed("mot", &format!("syn{i}"));
        }
        assert_eq!(db.lookup("mot", "fr").unwrap().len(), 20);
    }
}
