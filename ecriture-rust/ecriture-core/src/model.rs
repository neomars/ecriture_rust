//! Data model for a novel project.
//!
//! The original Python implementation stores project data as a schema-less
//! JSON dict: the frontend is free to attach extra fields to characters,
//! plot cards, notes, etc. (e.g. `linked_scenes`, `aliases`, `relations`).
//! To keep round-trip fidelity (load -> mutate -> save must not silently
//! drop fields we don't know about) every struct that mirrors a
//! user-editable JSON object carries a `#[serde(flatten)] extra` catch-all
//! map alongside its well-known fields.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

fn is_empty_map(m: &Map<String, Value>) -> bool {
    m.is_empty()
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ProjectSettings {
    pub title: String,
    #[serde(default = "default_daily_goal")]
    pub daily_goal: u32,
    #[serde(default = "default_overall_goal")]
    pub overall_goal: u32,
    #[serde(default)]
    pub overall_written: u32,
    #[serde(default)]
    pub daily_written: u32,
    #[serde(default = "default_lang")]
    pub lang: String,
    #[serde(flatten, skip_serializing_if = "is_empty_map")]
    pub extra: Map<String, Value>,
}

fn default_daily_goal() -> u32 {
    500
}
fn default_overall_goal() -> u32 {
    50000
}
fn default_lang() -> String {
    "en".into()
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Scene {
    pub id: String,
    #[serde(rename = "type", default = "scene_type")]
    pub node_type: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub content: String,
    #[serde(flatten, skip_serializing_if = "is_empty_map")]
    pub extra: Map<String, Value>,
}

fn scene_type() -> String {
    "scene".into()
}

/// A manuscript node: either a chapter (with nested children) or a leaf
/// scene. The Python source treats both uniformly via a recursive
/// `children` walk, so we mirror that instead of forcing chapters to only
/// ever contain scenes.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Chapter {
    pub id: String,
    #[serde(rename = "type", default = "chapter_type")]
    pub node_type: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub children: Vec<Scene>,
    #[serde(flatten, skip_serializing_if = "is_empty_map")]
    pub extra: Map<String, Value>,
}

fn chapter_type() -> String {
    "chapter".into()
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Plotline {
    pub id: String,
    pub title: String,
    #[serde(flatten, skip_serializing_if = "is_empty_map")]
    pub extra: Map<String, Value>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct PlotCard {
    pub id: String,
    pub plotline_id: String,
    pub scene_id: String,
    pub title: String,
    #[serde(default)]
    pub content: String,
    #[serde(flatten, skip_serializing_if = "is_empty_map")]
    pub extra: Map<String, Value>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Plot {
    #[serde(default)]
    pub plotlines: Vec<Plotline>,
    #[serde(default)]
    pub cards: Vec<PlotCard>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Character {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub role: String,
    #[serde(default)]
    pub description: String,
    #[serde(flatten, skip_serializing_if = "is_empty_map")]
    pub extra: Map<String, Value>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct StoryNote {
    pub id: String,
    pub title: String,
    #[serde(rename = "type", default)]
    pub note_type: String,
    #[serde(default)]
    pub content: String,
    #[serde(flatten, skip_serializing_if = "is_empty_map")]
    pub extra: Map<String, Value>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct KeyEvent {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub chapter_id: String,
    #[serde(default)]
    pub characters: Vec<String>,
    #[serde(flatten, skip_serializing_if = "is_empty_map")]
    pub extra: Map<String, Value>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct NovelData {
    pub settings: ProjectSettings,
    #[serde(default)]
    pub manuscript: Vec<Chapter>,
    #[serde(default)]
    pub plot: Plot,
    #[serde(default)]
    pub characters: Vec<Character>,
    #[serde(default)]
    pub story_notes: Vec<StoryNote>,
    #[serde(default)]
    pub key_events: Vec<KeyEvent>,
    #[serde(flatten, skip_serializing_if = "is_empty_map")]
    pub extra: Map<String, Value>,
}

impl Default for NovelData {
    fn default() -> Self {
        NovelData {
            settings: ProjectSettings {
                title: "Pride & Prejudice (Copy)".into(),
                daily_goal: 500,
                overall_goal: 50000,
                overall_written: 0,
                daily_written: 0,
                lang: "en".into(),
                extra: Map::new(),
            },
            manuscript: vec![
                Chapter {
                    id: "chap_1".into(),
                    node_type: "chapter".into(),
                    title: "Chapter 1".into(),
                    summary: "Mr. Bingley, a wealthy single gentleman, rents Netherfield Park, exciting Mrs. Bennet who hopes he will marry one of her five daughters.".into(),
                    children: vec![Scene {
                        id: "scene_1_1".into(),
                        node_type: "scene".into(),
                        title: "Netherfield Park is let at last".into(),
                        content: "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.\n\nHowever little known the feelings or views of such a man may be on his first entering a neighborhood, this truth is so well fixed in the minds of the surrounding families, that he is considered the rightful property of some one or other of their daughters.".into(),
                        extra: Map::new(),
                    }],
                    extra: Map::new(),
                },
                Chapter {
                    id: "chap_2".into(),
                    node_type: "chapter".into(),
                    title: "Chapter 2".into(),
                    summary: "Mr. Bennet visits Mr. Bingley in secret, surprising his family and demonstrating his affection for them.".into(),
                    children: vec![Scene {
                        id: "scene_2_1".into(),
                        node_type: "scene".into(),
                        title: "We cannot escape the subject".into(),
                        content: "Mr. Bennet was among the earliest of those who waited on Mr. Bingley. He had always intended to visit him, though to the last always assuring his wife that he should not go; and till the evening after the visit was paid she had no knowledge of it.".into(),
                        extra: Map::new(),
                    }],
                    extra: Map::new(),
                },
            ],
            plot: Plot {
                plotlines: vec![
                    Plotline { id: "pl_1".into(), title: "Scenes".into(), extra: Map::new() },
                    Plotline { id: "pl_2".into(), title: "Romance".into(), extra: Map::new() },
                    Plotline { id: "pl_3".into(), title: "Scandal".into(), extra: Map::new() },
                    Plotline { id: "pl_4".into(), title: "Class".into(), extra: Map::new() },
                ],
                cards: vec![
                    PlotCard { id: "card_1".into(), plotline_id: "pl_1".into(), scene_id: "scene_1_1".into(), title: "Bingley Arrives".into(), content: "Bingley rents Netherfield Park, exciting Mrs. Bennet.".into(), extra: Map::new() },
                    PlotCard { id: "card_2".into(), plotline_id: "pl_2".into(), scene_id: "scene_1_1".into(), title: "First Spark".into(), content: "Jane and Bingley meet and there's immediate mutual interest.".into(), extra: Map::new() },
                    PlotCard { id: "card_3".into(), plotline_id: "pl_1".into(), scene_id: "scene_2_1".into(), title: "Mr. Bennet's Visit".into(), content: "Mr. Bennet reveals he has visited Bingley, surprising the family.".into(), extra: Map::new() },
                ],
            },
            characters: vec![
                Character { id: "char_1".into(), name: "Elizabeth Bennet".into(), role: "Protagonist".into(), description: "The second of the Bennet daughters. She is intelligent, lively, and quick-witted, but prone to forming quick judgments.".into(), extra: Map::new() },
                Character { id: "char_2".into(), name: "Jane Bennet".into(), role: "Supporting Character".into(), description: "The eldest Bennet sister, sweet-tempered and beautiful, always thinking the best of everyone.".into(), extra: Map::new() },
                Character { id: "char_3".into(), name: "Mr. Darcy".into(), role: "Love Interest".into(), description: "A wealthy gentleman, proud and socially awkward initially, but highly honorable.".into(), extra: Map::new() },
            ],
            story_notes: vec![
                StoryNote { id: "note_1".into(), title: "Hertfordshire".into(), note_type: "Location".into(), content: "The county in Southern England where the Bennets and Bingleys live.".into(), extra: Map::new() },
                StoryNote { id: "note_2".into(), title: "Longbourn".into(), note_type: "Location".into(), content: "The Bennet family estate, entailed to Mr. Collins.".into(), extra: Map::new() },
            ],
            key_events: vec![KeyEvent {
                id: "evt_1".into(),
                title: "Mr. Bingley Rents Netherfield".into(),
                description: "The news of Netherfield being let to a wealthy bachelor spreads across Hertfordshire.".into(),
                chapter_id: "chap_1".into(),
                characters: vec![],
                extra: Map::new(),
            }],
            extra: Map::new(),
        }
    }
}

/// Generic node reference used by the manuscript tree walker so callers can
/// operate on either a `Chapter` or a `Scene` without matching twice.
pub trait ManuscriptNode {
    fn id(&self) -> &str;
    fn word_count(&self) -> usize;
}

impl ManuscriptNode for Scene {
    fn id(&self) -> &str {
        &self.id
    }
    fn word_count(&self) -> usize {
        self.content.split_whitespace().count()
    }
}

impl Chapter {
    /// Recursively counts words across every scene nested under this
    /// chapter, mirroring `project_manager.py`'s `count_words`.
    pub fn word_count(&self) -> usize {
        self.children.iter().map(|s| s.word_count()).sum()
    }
}
