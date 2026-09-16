use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ProjectSettings {
    pub title: String,
    pub daily_goal: u32,
    pub overall_goal: u32,
    pub overall_written: u32,
    pub daily_written: u32,
    pub lang: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Scene {
    pub id: String,
    #[serde(rename = "type")]
    pub node_type: String, // "scene"
    pub title: String,
    pub content: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Chapter {
    pub id: String,
    #[serde(rename = "type")]
    pub node_type: String, // "chapter"
    pub title: String,
    pub summary: String,
    pub children: Vec<Scene>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Plotline {
    pub id: String,
    pub title: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PlotCard {
    pub id: String,
    pub plotline_id: String,
    pub scene_id: String,
    pub title: String,
    pub content: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Plot {
    pub plotlines: Vec<Plotline>,
    pub cards: Vec<PlotCard>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Character {
    pub id: String,
    pub name: String,
    pub role: String,
    pub description: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct StoryNote {
    pub id: String,
    pub title: String,
    #[serde(rename = "type")]
    pub note_type: String,
    pub content: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct KeyEvent {
    pub id: String,
    pub title: String,
    pub description: String,
    pub chapter_id: String,
    pub characters: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct NovelData {
    pub settings: ProjectSettings,
    pub manuscript: Vec<Chapter>,
    pub plot: Plot,
    pub characters: Vec<Character>,
    pub story_notes: Vec<StoryNote>,
    pub key_events: Vec<KeyEvent>,
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
            },
            manuscript: vec![
                Chapter {
                    id: "chap_1".into(),
                    node_type: "chapter".into(),
                    title: "Chapter 1".into(),
                    summary: "Mr. Bingley, a wealthy single gentleman, rents Netherfield Park, exciting Mrs. Bennet who hopes he will marry one of her five daughters.".into(),
                    children: vec![
                        Scene {
                            id: "scene_1_1".into(),
                            node_type: "scene".into(),
                            title: "Netherfield Park is let at last".into(),
                            content: "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.\n\nHowever little known the feelings or views of such a man may be on his first entering a neighborhood, this truth is so well fixed in the minds of the surrounding families, that he is considered the rightful property of some one or other of their daughters.".into(),
                        }
                    ],
                },
                Chapter {
                    id: "chap_2".into(),
                    node_type: "chapter".into(),
                    title: "Chapter 2".into(),
                    summary: "Mr. Bennet visits Mr. Bingley in secret, surprising his family and demonstrating his affection for them.".into(),
                    children: vec![
                        Scene {
                            id: "scene_2_1".into(),
                            node_type: "scene".into(),
                            title: "We cannot escape the subject".into(),
                            content: "Mr. Bennet was among the earliest of those who waited on Mr. Bingley. He had always intended to visit him, though to the last always assuring his wife that he should not go; and till the evening after the visit was paid she had no knowledge of it.".into(),
                        }
                    ],
                }
            ],
            plot: Plot {
                plotlines: vec![
                    Plotline { id: "pl_1".into(), title: "Scenes".into() },
                    Plotline { id: "pl_2".into(), title: "Romance".into() },
                    Plotline { id: "pl_3".into(), title: "Scandal".into() },
                    Plotline { id: "pl_4".into(), title: "Class".into() }
                ],
                cards: vec![
                    PlotCard { id: "card_1".into(), plotline_id: "pl_1".into(), scene_id: "scene_1_1".into(), title: "Bingley Arrives".into(), content: "Bingley rents Netherfield Park, exciting Mrs. Bennet.".into() },
                    PlotCard { id: "card_2".into(), plotline_id: "pl_2".into(), scene_id: "scene_1_1".into(), title: "First Spark".into(), content: "Jane and Bingley meet and there's immediate mutual interest.".into() },
                    PlotCard { id: "card_3".into(), plotline_id: "pl_1".into(), scene_id: "scene_2_1".into(), title: "Mr. Bennet's Visit".into(), content: "Mr. Bennet reveals he has visited Bingley, surprising the family.".into() }
                ],
            },
            characters: vec![
                Character {
                    id: "char_1".into(),
                    name: "Elizabeth Bennet".into(),
                    role: "Protagonist".into(),
                    description: "The second of the Bennet daughters. She is intelligent, lively, and quick-witted, but prone to forming quick judgments.".into(),
                },
                Character {
                    id: "char_2".into(),
                    name: "Jane Bennet".into(),
                    role: "Supporting Character".into(),
                    description: "The eldest Bennet sister, sweet-tempered and beautiful, always thinking the best of everyone.".into(),
                },
                Character {
                    id: "char_3".into(),
                    name: "Mr. Darcy".into(),
                    role: "Love Interest".into(),
                    description: "A wealthy gentleman, proud and socially awkward initially, but highly honorable.".into(),
                }
            ],
            story_notes: vec![
                StoryNote {
                    id: "note_1".into(),
                    title: "Hertfordshire".into(),
                    note_type: "Location".into(),
                    content: "The county in Southern England where the Bennets and Bingleys live.".into(),
                },
                StoryNote {
                    id: "note_2".into(),
                    title: "Longbourn".into(),
                    note_type: "Location".into(),
                    content: "The Bennet family estate, entailed to Mr. Collins.".into(),
                }
            ],
            key_events: vec![
                KeyEvent {
                    id: "evt_1".into(),
                    title: "Mr. Bingley Rents Netherfield".into(),
                    description: "The news of Netherfield being let to a wealthy bachelor spreads across Hertfordshire.".into(),
                    chapter_id: "chap_1".into(),
                    characters: vec![],
                }
            ],
        }
    }
}

pub struct NovelProject {
    pub filepath: Option<PathBuf>,
    pub data: NovelData,
}

impl NovelProject {
    pub fn new(filepath: Option<PathBuf>) -> Self {
        let mut project = NovelProject {
            filepath: filepath.clone(),
            data: NovelData::default(),
        };
        if let Some(path) = filepath {
            if path.exists() {
                let _ = project.load();
            }
        }
        project
    }

    pub fn load(&mut self) -> Result<(), String> {
        if let Some(ref path) = self.filepath {
            let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
            self.data = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn save(&mut self) -> Result<(), String> {
        self.recalculate_word_counts();
        let path = self.filepath.clone().unwrap_or_else(|| PathBuf::from("my_novel_project.json"));
        self.filepath = Some(path.clone());

        // ensure projects dir exists
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }

        let content = serde_json::to_string_pretty(&self.data).map_err(|e| e.to_string())?;
        fs::write(path, content).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn recalculate_word_counts(&mut self) {
        let mut total = 0;
        for chap in &self.data.manuscript {
            for scene in &chap.children {
                total += scene.content.split_whitespace().count() as u32;
            }
        }
        self.data.settings.overall_written = total;
    }
}

pub struct AppState {
    pub active_project: Mutex<Option<NovelProject>>,
    pub base_dir: PathBuf,
}
