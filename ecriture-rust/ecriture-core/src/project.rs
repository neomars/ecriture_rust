//! Project persistence and manuscript-tree operations.
//!
//! Ports `project_manager.py`'s `NovelProject` plus the project-lifecycle
//! routes from `main.py` (list / create / switch active / delete).

use crate::model::{Chapter, NovelData, Scene};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, thiserror::Error)]
pub enum ProjectError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("project file not found")]
    NotFound,
    #[error("no active project")]
    NoActiveProject,
    #[error("chapter '{0}' not found or is not a chapter")]
    ChapterNotFound(String),
    #[error("title cannot be empty")]
    EmptyTitle,
    #[error("cannot delete a protected default project")]
    ProtectedProject,
}

pub type Result<T> = std::result::Result<T, ProjectError>;

/// A single project bound to a JSON file on disk.
#[derive(Debug, Clone)]
pub struct NovelProject {
    pub filepath: Option<PathBuf>,
    pub data: NovelData,
}

impl NovelProject {
    /// Mirrors `NovelProject.__init__`: starts from the built-in sample
    /// data, then loads the file in place if it already exists.
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

    pub fn load(&mut self) -> Result<()> {
        let path = self.filepath.as_ref().ok_or(ProjectError::NoActiveProject)?;
        let content = fs::read_to_string(path)?;
        self.data = serde_json::from_str(&content)?;
        Ok(())
    }

    /// Saves to disk, recalculating word counts first and creating parent
    /// directories on demand (parity with the Python `save()`).
    pub fn save(&mut self) -> Result<()> {
        self.recalculate_word_counts();
        let path = self
            .filepath
            .clone()
            .unwrap_or_else(|| PathBuf::from("my_novel_project.json"));
        self.filepath = Some(path.clone());

        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                fs::create_dir_all(parent)?;
            }
        }

        // serde preserves struct field declaration order, and `settings` is
        // declared first on NovelData, so "settings" naturally lands first
        // in the emitted JSON - matching the Python reordering step.
        let content = serde_json::to_string_pretty(&self.data)?;
        fs::write(&path, content)?;
        Ok(())
    }

    pub fn recalculate_word_counts(&mut self) {
        let total: usize = self.data.manuscript.iter().map(|c| c.word_count()).sum();
        self.data.settings.overall_written = total as u32;
    }

    /// Depth-first search across the manuscript tree for a chapter or scene
    /// by id, returning a reference for read access.
    pub fn find_node(&self, node_id: &str) -> Option<ManuscriptRef<'_>> {
        for chap in &self.data.manuscript {
            if chap.id == node_id {
                return Some(ManuscriptRef::Chapter(chap));
            }
            for scene in &chap.children {
                if scene.id == node_id {
                    return Some(ManuscriptRef::Scene(scene));
                }
            }
        }
        None
    }

    pub fn add_chapter(&mut self, title: &str) -> &Chapter {
        let new_id = format!(
            "chap_{}_{}",
            self.data.manuscript.len() + 1,
            rand::random::<u16>()
        );
        let chapter = Chapter {
            id: new_id,
            node_type: "chapter".into(),
            title: title.to_string(),
            summary: String::new(),
            children: Vec::new(),
            extra: serde_json::Map::new(),
        };
        self.data.manuscript.push(chapter);
        self.data.manuscript.last().unwrap()
    }

    pub fn add_scene(&mut self, parent_chapter_id: &str, title: &str) -> Result<&Scene> {
        let parent = self
            .data
            .manuscript
            .iter_mut()
            .find(|c| c.id == parent_chapter_id)
            .ok_or_else(|| ProjectError::ChapterNotFound(parent_chapter_id.to_string()))?;

        let new_id = format!("scene_{}_{}", parent.children.len() + 1, rand::random::<u16>());
        let scene = Scene {
            id: new_id,
            node_type: "scene".into(),
            title: title.to_string(),
            content: String::new(),
            extra: serde_json::Map::new(),
        };
        parent.children.push(scene);
        Ok(parent.children.last().unwrap())
    }

    /// Removes a chapter or scene by id. When a scene is removed, any plot
    /// cards referencing it are cascaded away too, matching the Python
    /// implementation.
    pub fn delete_node(&mut self, node_id: &str) -> bool {
        if let Some(pos) = self.data.manuscript.iter().position(|c| c.id == node_id) {
            self.data.manuscript.remove(pos);
            return true;
        }

        for chap in &mut self.data.manuscript {
            if let Some(pos) = chap.children.iter().position(|s| s.id == node_id) {
                chap.children.remove(pos);
                self.data
                    .plot
                    .cards
                    .retain(|card| card.scene_id != node_id);
                return true;
            }
        }
        false
    }
}

pub enum ManuscriptRef<'a> {
    Chapter(&'a Chapter),
    Scene(&'a Scene),
}

impl<'a> ManuscriptRef<'a> {
    pub fn title(&self) -> &str {
        match self {
            ManuscriptRef::Chapter(c) => &c.title,
            ManuscriptRef::Scene(s) => &s.title,
        }
    }
}

/// Metadata surfaced by the "list projects" screen.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ProjectSummary {
    pub filename: String,
    pub title: String,
}

/// Coordinates the `projects/` directory and the `active_project.txt`
/// pointer, mirroring the module-level state in `main.py`.
pub struct ProjectManager {
    pub projects_dir: PathBuf,
    pub active_config_file: PathBuf,
}

const PROTECTED_PROJECTS: &[&str] = &["le_comte_de_monte_cristo.json", "le_cid_corneille.json"];

impl ProjectManager {
    pub fn new(base_dir: impl AsRef<Path>) -> Self {
        let base_dir = base_dir.as_ref();
        Self {
            projects_dir: base_dir.join("projects"),
            active_config_file: base_dir.join("active_project.txt"),
        }
    }

    pub fn ensure_dirs(&self) -> Result<()> {
        fs::create_dir_all(&self.projects_dir)?;
        Ok(())
    }

    pub fn list_projects(&self) -> Result<Vec<ProjectSummary>> {
        self.ensure_dirs()?;
        let mut out = Vec::new();
        for entry in fs::read_dir(&self.projects_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let Ok(content) = fs::read_to_string(&path) else {
                continue;
            };
            let Ok(data) = serde_json::from_str::<NovelData>(&content) else {
                continue;
            };
            out.push(ProjectSummary {
                filename: path.file_name().unwrap().to_string_lossy().to_string(),
                title: data.settings.title,
            });
        }
        out.sort_by(|a, b| a.filename.cmp(&b.filename));
        Ok(out)
    }

    pub fn get_active_filename(&self) -> Result<String> {
        self.ensure_dirs()?;
        if let Ok(content) = fs::read_to_string(&self.active_config_file) {
            let fn_ = content.trim().to_string();
            if !fn_.is_empty() && self.projects_dir.join(&fn_).exists() {
                return Ok(fn_);
            }
        }

        let mut files: Vec<String> = fs::read_dir(&self.projects_dir)?
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.ends_with(".json"))
            .collect();
        files.sort();

        if let Some(preferred) = files.iter().find(|f| f.as_str() == "le_comte_de_monte_cristo.json") {
            let preferred = preferred.clone();
            self.set_active_filename(&preferred)?;
            return Ok(preferred);
        }

        if let Some(first) = files.into_iter().next() {
            self.set_active_filename(&first)?;
            return Ok(first);
        }

        let default_fn = "my_novel_project.json".to_string();
        let mut proj = NovelProject::new(Some(self.projects_dir.join(&default_fn)));
        proj.save()?;
        self.set_active_filename(&default_fn)?;
        Ok(default_fn)
    }

    pub fn set_active_filename(&self, filename: &str) -> Result<()> {
        fs::write(&self.active_config_file, filename)?;
        Ok(())
    }

    pub fn load_active(&self) -> Result<NovelProject> {
        let filename = self.get_active_filename()?;
        Ok(NovelProject::new(Some(self.projects_dir.join(filename))))
    }

    /// Switches the active project pointer to `filename`, returning the
    /// loaded project.
    pub fn switch_active(&self, filename: &str) -> Result<NovelProject> {
        let path = self.projects_dir.join(filename);
        if !path.exists() {
            return Err(ProjectError::NotFound);
        }
        self.set_active_filename(filename)?;
        Ok(NovelProject::new(Some(path)))
    }

    /// Creates a new, empty project from a title, sanitising the filename
    /// the same way `main.py`'s `create_project` route does, and sets it
    /// active.
    pub fn create_project(&self, title: &str) -> Result<NovelProject> {
        let title = title.trim();
        if title.is_empty() {
            return Err(ProjectError::EmptyTitle);
        }
        self.ensure_dirs()?;

        let safe_title = sanitize_title(title);
        let mut filename = format!("{safe_title}.json");
        let mut filepath = self.projects_dir.join(&filename);
        let mut counter = 1;
        while filepath.exists() {
            filename = format!("{safe_title}_{counter}.json");
            filepath = self.projects_dir.join(&filename);
            counter += 1;
        }

        let mut project = NovelProject::new(Some(filepath));
        project.data = NovelData {
            settings: crate::model::ProjectSettings {
                title: title.to_string(),
                daily_goal: 500,
                overall_goal: 50000,
                overall_written: 0,
                daily_written: 0,
                lang: "en".into(),
                extra: Default::default(),
            },
            manuscript: Vec::new(),
            plot: Default::default(),
            characters: Vec::new(),
            story_notes: Vec::new(),
            key_events: Vec::new(),
            extra: Default::default(),
        };
        project.save()?;
        self.set_active_filename(&filename)?;
        Ok(project)
    }

    /// Deletes `filename`. If it was the active project, a new active
    /// project is elected (or created) and returned as `Some`.
    pub fn delete_project(&self, filename: &str) -> Result<Option<NovelProject>> {
        if PROTECTED_PROJECTS.contains(&filename) {
            return Err(ProjectError::ProtectedProject);
        }
        let path = self.projects_dir.join(filename);
        if !path.exists() {
            return Err(ProjectError::NotFound);
        }

        let active_before = self.get_active_filename()?;
        fs::remove_file(&path)?;

        if active_before == filename || !self.projects_dir.join(&active_before).exists() {
            let _ = fs::remove_file(&self.active_config_file);
            let new_active = self.get_active_filename()?;
            return Ok(Some(NovelProject::new(Some(
                self.projects_dir.join(new_active),
            ))));
        }
        Ok(None)
    }
}

/// Mirrors the filename-safety filter in `main.py::create_project`:
/// keep only ASCII letters/digits and a small punctuation allow-list,
/// replace spaces with underscores, and lowercase the result.
fn sanitize_title(title: &str) -> String {
    const EXTRA_ALLOWED: &[char] = &['-', '_', '.', '(', ')', ' '];
    let filtered: String = title
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || EXTRA_ALLOWED.contains(c))
        .collect();
    let replaced = filtered.replace(' ', "_").to_lowercase();
    if replaced.is_empty() {
        "unnamed_project".to_string()
    } else {
        replaced
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn scene_with_content(id: &str, content: &str) -> Scene {
        Scene {
            id: id.into(),
            node_type: "scene".into(),
            title: "Scene".into(),
            content: content.into(),
            extra: Default::default(),
        }
    }

    #[test]
    fn default_data_matches_python_seed() {
        let project = NovelProject::new(None);
        assert_eq!(project.data.settings.title, "Pride & Prejudice (Copy)");
        assert!(project.data.manuscript.len() == 2);
        assert!(project.data.plot.plotlines.len() == 4);
    }

    #[test]
    fn recalculate_word_counts_matches_python_split_semantics() {
        let mut project = NovelProject::new(None);
        project.data.manuscript = vec![Chapter {
            id: "chap_1".into(),
            node_type: "chapter".into(),
            title: "Chapter 1".into(),
            summary: String::new(),
            children: vec![scene_with_content(
                "scene_1",
                "Hello world! This is a test of the word count.",
            )],
            extra: Default::default(),
        }];
        project.recalculate_word_counts();
        assert_eq!(project.data.settings.overall_written, 10);
    }

    #[test]
    fn word_count_ignores_extra_whitespace_like_python_str_split() {
        let mut project = NovelProject::new(None);
        project.data.manuscript = vec![Chapter {
            id: "c".into(),
            node_type: "chapter".into(),
            title: "C".into(),
            summary: String::new(),
            children: vec![scene_with_content("s", "  a   b\n\nc\t d  ")],
            extra: Default::default(),
        }];
        project.recalculate_word_counts();
        assert_eq!(project.data.settings.overall_written, 4);
    }

    #[test]
    fn find_node_locates_chapters_and_scenes() {
        let project = NovelProject::new(None);
        let found = project.find_node("scene_1_1").expect("scene should exist");
        assert_eq!(found.title(), "Netherfield Park is let at last");
        assert!(project.find_node("does_not_exist").is_none());
    }

    #[test]
    fn add_chapter_and_add_scene() {
        let mut project = NovelProject::new(None);
        let chap_id = project.add_chapter("Chapter 3").id.clone();
        assert!(chap_id.starts_with("chap_"));
        assert!(project.find_node(&chap_id).is_some());

        let scene = project.add_scene(&chap_id, "A New Scene").unwrap();
        assert!(scene.id.starts_with("scene_"));
        assert_eq!(scene.title, "A New Scene");

        assert!(matches!(
            project.add_scene("invalid_chap_id", "Failed Scene"),
            Err(ProjectError::ChapterNotFound(_))
        ));
    }

    #[test]
    fn delete_node_cascades_plot_cards() {
        let mut project = NovelProject::new(None);
        assert!(project
            .data
            .plot
            .cards
            .iter()
            .any(|c| c.scene_id == "scene_1_1"));

        assert!(project.delete_node("scene_1_1"));
        assert!(project.find_node("scene_1_1").is_none());
        assert!(!project
            .data
            .plot
            .cards
            .iter()
            .any(|c| c.scene_id == "scene_1_1"));

        assert!(!project.delete_node("scene_1_1"));
    }

    #[test]
    fn save_and_load_round_trip() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("test_novel_project_temp.json");
        let mut project = NovelProject::new(Some(path.clone()));
        project.data.settings.title = "Persuasion".into();
        project.save().unwrap();

        assert!(path.exists());
        let reloaded = NovelProject::new(Some(path));
        assert_eq!(reloaded.data.settings.title, "Persuasion");
    }

    #[test]
    fn unknown_fields_survive_a_save_and_load_round_trip() {
        // Regression test: the frontend attaches ad-hoc fields (e.g.
        // "characters"/"links" on a plot card) that our typed structs don't
        // explicitly model. They must not be dropped on save/load.
        let dir = tempdir().unwrap();
        let path = dir.path().join("custom_fields.json");
        let mut project = NovelProject::new(Some(path.clone()));

        let card = &mut project.data.plot.cards[0];
        card.extra.insert(
            "characters".into(),
            serde_json::json!(["char_1", "char_3"]),
        );
        card.extra.insert("links".into(), serde_json::json!(["card_2"]));
        project.save().unwrap();

        let reloaded = NovelProject::new(Some(path));
        let loaded_card = &reloaded.data.plot.cards[0];
        assert_eq!(
            loaded_card.extra.get("characters").unwrap(),
            &serde_json::json!(["char_1", "char_3"])
        );
        assert_eq!(
            loaded_card.extra.get("links").unwrap(),
            &serde_json::json!(["card_2"])
        );
    }

    #[test]
    fn settings_key_is_serialized_first() {
        let mut project = NovelProject::new(None);
        project.recalculate_word_counts();
        let json = serde_json::to_string(&project.data).unwrap();
        let settings_pos = json.find("\"settings\"").unwrap();
        let manuscript_pos = json.find("\"manuscript\"").unwrap();
        assert!(settings_pos < manuscript_pos);
    }

    #[test]
    fn project_manager_full_lifecycle() {
        let dir = tempdir().unwrap();
        let mgr = ProjectManager::new(dir.path());
        mgr.ensure_dirs().unwrap();

        // No projects yet -> an active one is created on demand.
        let active = mgr.get_active_filename().unwrap();
        assert!(mgr.projects_dir.join(&active).exists());

        let created = mgr.create_project("My Amazing Novel!").unwrap();
        let created_filename = created.filepath.unwrap().file_name().unwrap().to_string_lossy().to_string();
        assert_eq!(created_filename, "my_amazing_novel.json");
        assert_eq!(mgr.get_active_filename().unwrap(), created_filename);

        // Creating a second project with a colliding sanitized name gets a
        // numeric suffix.
        let created2 = mgr.create_project("My Amazing Novel!!!").unwrap();
        let created2_filename = created2
            .filepath
            .unwrap()
            .file_name()
            .unwrap()
            .to_string_lossy()
            .to_string();
        assert_eq!(created2_filename, "my_amazing_novel_1.json");

        let listed = mgr.list_projects().unwrap();
        assert!(listed.iter().any(|p| p.filename == created_filename));
        assert!(listed.iter().any(|p| p.filename == created2_filename));

        // Switch back to the first, then delete it -> a new active project
        // must be elected automatically.
        mgr.switch_active(&created_filename).unwrap();
        let switched = mgr.delete_project(&created_filename).unwrap();
        assert!(switched.is_some());
        assert_ne!(mgr.get_active_filename().unwrap(), created_filename);
    }

    #[test]
    fn protected_default_projects_cannot_be_deleted() {
        let dir = tempdir().unwrap();
        let mgr = ProjectManager::new(dir.path());
        mgr.ensure_dirs().unwrap();
        fs::write(
            mgr.projects_dir.join("le_comte_de_monte_cristo.json"),
            "{}",
        )
        .unwrap();

        let result = mgr.delete_project("le_comte_de_monte_cristo.json");
        assert!(matches!(result, Err(ProjectError::ProtectedProject)));
    }

    #[test]
    fn create_project_rejects_blank_title() {
        let dir = tempdir().unwrap();
        let mgr = ProjectManager::new(dir.path());
        assert!(matches!(
            mgr.create_project("   "),
            Err(ProjectError::EmptyTitle)
        ));
    }

    #[test]
    fn sanitize_title_matches_python_filter_semantics() {
        assert_eq!(sanitize_title("Écriture: a Tale!"), "criture_a_tale");
        assert_eq!(sanitize_title("***"), "unnamed_project");
        assert_eq!(sanitize_title("Le Comte (v2)"), "le_comte_(v2)");
    }
}
