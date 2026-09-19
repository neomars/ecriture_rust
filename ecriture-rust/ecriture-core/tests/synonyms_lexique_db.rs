//! Non-regression test against the real, bundled `lexique.db`, mirroring
//! `test_synonyms.py::test_get_synonyms_fr` from the original Python
//! implementation: looking up "bonjour" must include "salut".

use ecriture_core::synonyms::SynonymDb;

fn db() -> SynonymDb {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/resources/lexique.db");
    SynonymDb::open(path).expect("bundled lexique.db should open")
}

#[test]
fn bonjour_synonyms_include_salut() {
    let db = db();
    let syns = db.lookup("bonjour", "fr").unwrap();
    assert!(syns.contains(&"salut".to_string()), "got {syns:?}");
}

#[test]
fn synonym_lookup_is_case_and_punctuation_insensitive() {
    let db = db();
    let plain = db.lookup("bonjour", "fr").unwrap();
    let noisy = db.lookup("  Bonjour !  ", "fr").unwrap();
    assert_eq!(plain, noisy);
}

#[test]
fn unknown_word_returns_an_empty_list_without_erroring() {
    let db = db();
    let syns = db.lookup("zzzznotaword", "fr").unwrap();
    assert!(syns.is_empty());
}

#[test]
fn non_french_language_returns_empty_without_touching_the_db() {
    let db = db();
    assert!(db.lookup("hello", "en").unwrap().is_empty());
}
