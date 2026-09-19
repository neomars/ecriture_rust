//! Tauri command layer: thin adapters over `ecriture-core`.
//!
//! All actual business logic (project persistence, export, synonyms,
//! backups, AI prompt/fallback plumbing) lives in the `ecriture-core`
//! crate, which has no Tauri dependency and is covered by its own unit and
//! integration test suite. This file's job is limited to (1) translating
//! Tauri command arguments into core calls, (2) holding the app's shared
//! mutable state behind a `Mutex`, and (3) mapping core errors to the
//! `Result<_, String>` shape `#[tauri::command]` expects.

use ecriture_core::export::{self, ExportFormat};
use ecriture_core::model::NovelData;
use ecriture_core::synonyms::SynonymDb;
use ecriture_core::{ai, backup, locale, update, NovelProject, ProjectManager};
use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

pub struct AppState {
    pub active_project: Mutex<Option<NovelProject>>,
    pub project_manager: ProjectManager,
    pub base_dir: PathBuf,
}

/// Locates the bundled `lexique.db` (see `tauri.conf.json`'s
/// `bundle.resources`), trying the handful of places it could plausibly
/// live depending on how the app was launched: next to the working
/// directory, next to the executable (typical for an installed bundle on
/// Linux/Windows and inside a macOS `.app/Contents/Resources`), and
/// finally the in-tree copy owned by `ecriture-core` for `cargo run`/
/// `cargo tauri dev`.
fn lexique_db_path(base_dir: &std::path::Path) -> PathBuf {
    let mut candidates = vec![base_dir.join("resources").join("lexique.db")];

    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            candidates.push(exe_dir.join("resources").join("lexique.db"));
            candidates.push(exe_dir.join("..").join("Resources").join("resources").join("lexique.db"));
        }
    }

    candidates.push(PathBuf::from(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../ecriture-core/resources/lexique.db"
    )));

    candidates
        .into_iter()
        .find(|p| p.exists())
        .unwrap_or_else(|| PathBuf::from("resources/lexique.db"))
}

#[tauri::command]
fn get_active_project(state: State<AppState>) -> Result<NovelData, String> {
    let project_lock = state.active_project.lock().unwrap();
    if let Some(ref project) = *project_lock {
        Ok(project.data.clone())
    } else {
        Err("No active project".into())
    }
}

#[tauri::command]
fn get_project_list(state: State<AppState>) -> Result<Vec<Value>, String> {
    let projects = state
        .project_manager
        .list_projects()
        .map_err(|e| e.to_string())?;
    Ok(projects
        .into_iter()
        .map(|p| serde_json::json!({"filename": p.filename, "title": p.title}))
        .collect())
}

#[tauri::command]
fn create_project(title: String, state: State<AppState>) -> Result<NovelData, String> {
    let project = state
        .project_manager
        .create_project(&title)
        .map_err(|e| e.to_string())?;
    let data = project.data.clone();
    *state.active_project.lock().unwrap() = Some(project);
    Ok(data)
}

#[tauri::command]
fn load_project(filename: String, state: State<AppState>) -> Result<NovelData, String> {
    let project = state
        .project_manager
        .switch_active(&filename)
        .map_err(|e| e.to_string())?;
    let data = project.data.clone();
    *state.active_project.lock().unwrap() = Some(project);
    Ok(data)
}

/// Persists `data` as the active project and returns it back with word
/// counts recalculated server-side, mirroring `main.py::save_project`
/// (`{"status": "success", "data": project.data}`) closely enough that the
/// frontend can just do `projectData = await invoke(...)`.
#[tauri::command]
fn update_project(data: NovelData, state: State<AppState>) -> Result<NovelData, String> {
    let mut project_lock = state.active_project.lock().unwrap();
    if let Some(ref mut project) = *project_lock {
        project.data = data;
        project.save().map_err(|e| e.to_string())?;
        Ok(project.data.clone())
    } else {
        Err("No active project".into())
    }
}

#[derive(Serialize)]
struct DeleteOutcome {
    switched: bool,
    active_filename: String,
    data: Option<NovelData>,
}

#[tauri::command]
fn delete_project(filename: String, state: State<AppState>) -> Result<DeleteOutcome, String> {
    let replacement = state
        .project_manager
        .delete_project(&filename)
        .map_err(|e| e.to_string())?;

    match replacement {
        Some(new_project) => {
            let data = new_project.data.clone();
            let active_filename = new_project
                .filepath
                .as_ref()
                .and_then(|p| p.file_name())
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            *state.active_project.lock().unwrap() = Some(new_project);
            Ok(DeleteOutcome {
                switched: true,
                active_filename,
                data: Some(data),
            })
        }
        None => {
            let active_filename = state
                .project_manager
                .get_active_filename()
                .map_err(|e| e.to_string())?;
            Ok(DeleteOutcome {
                switched: false,
                active_filename,
                data: None,
            })
        }
    }
}

#[tauri::command]
fn export_draft(format: String, state: State<AppState>) -> Result<Vec<u8>, String> {
    let project_lock = state.active_project.lock().unwrap();
    let project = project_lock.as_ref().ok_or("No active project")?;
    let fmt = ExportFormat::parse(&format).map_err(|e| e.to_string())?;
    export::export(&project.data, fmt).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_synonyms(word: String, lang: String, state: State<AppState>) -> Result<Vec<String>, String> {
    if word.trim().is_empty() {
        return Ok(Vec::new());
    }
    let db_path = lexique_db_path(&state.base_dir);
    if !db_path.exists() {
        return Ok(Vec::new());
    }
    let db = SynonymDb::open(&db_path).map_err(|e| e.to_string())?;
    db.lookup(&word, &lang).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_locale(lang: String) -> Result<Value, String> {
    locale::get_locale(&lang).map_err(|e| e.to_string())
}

#[derive(Serialize)]
struct AiToolResponse {
    status: &'static str,
    message: String,
}

/// Runs a contextual writing tool (describe/rewrite/expand/...). No local
/// inference engine is bundled (see `ecriture_core::ai` docs), so this
/// always returns the offline simulated fallback today; a real backend can
/// be plugged in later behind `ecriture_core::ai::AiBackend` without
/// changing this command's signature.
#[tauri::command]
fn ai_tool(tool: String, style: String, text: String, lang: String) -> Result<AiToolResponse, String> {
    let _system_prompt = ai::build_tool_system_prompt(&tool, &style, &lang).map_err(|e| e.to_string())?;
    let message = ai::fallback_response(&tool, &text, &style, &lang);
    Ok(AiToolResponse {
        status: "offline_fallback",
        message,
    })
}

#[derive(Serialize)]
struct AiRelectureResponse {
    status: &'static str,
    feedback: String,
}

/// Runs the "relecture" (proofreading) assistant for a block of text.
/// `category` is one of "style", "coherence" or "worldbuilding"; like
/// [`ai_tool`], this always returns the offline fallback today.
#[tauri::command]
fn ai_relecture(category: String, text: String, lang: String) -> Result<AiRelectureResponse, String> {
    let fallback_category = match category.as_str() {
        "style" => "relecture_style",
        _ => "relecture_coherence",
    };
    Ok(AiRelectureResponse {
        status: "offline_fallback",
        feedback: ai::fallback_response(fallback_category, &text, "", &lang),
    })
}

#[tauri::command]
fn ai_status() -> Result<Value, String> {
    Ok(serde_json::json!({
        "status": "offline",
        "installed": false,
        "message": "No local inference engine is bundled; contextual tools use the offline fallback simulator."
    }))
}

#[tauri::command]
fn check_updates() -> Result<Value, String> {
    struct NoFetcher;
    impl update::ReleaseFetcher for NoFetcher {
        fn latest_release(&self, _repo: &str) -> Result<update::GithubRelease, String> {
            // No HTTP client is wired up in this build; report "no update"
            // rather than fabricate a result. See `update` module docs.
            Err("update checks are not wired to a network client in this build".into())
        }
    }
    let status = update::check_for_update(&NoFetcher, update::os_keyword());
    serde_json::to_value(status).map_err(|e| e.to_string())
}

#[tauri::command]
fn backup_create(folder_path: String, frequency: String, state: State<AppState>) -> Result<String, String> {
    let project_lock = state.active_project.lock().unwrap();
    let project = project_lock.as_ref().ok_or("No active project")?;
    backup::create_backup(&folder_path, &project.data, &frequency).map_err(|e| e.to_string())
}

#[tauri::command]
fn backup_list(folder_path: String) -> Result<Vec<backup::BackupInfo>, String> {
    backup::list_backups(&folder_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn backup_restore(folder_path: String, filename: String, state: State<AppState>) -> Result<NovelData, String> {
    let restored = backup::restore_backup(&folder_path, &filename).map_err(|e| e.to_string())?;
    let mut project_lock = state.active_project.lock().unwrap();
    let project = project_lock.as_mut().ok_or("No active project")?;
    project.data = restored.clone();
    project.save().map_err(|e| e.to_string())?;
    Ok(restored)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let base_dir = std::env::current_dir().unwrap();
    let project_manager = ProjectManager::new(&base_dir);
    project_manager.ensure_dirs().expect("failed to create projects directory");

    let initial_project = project_manager
        .load_active()
        .expect("failed to load or create the initial project");

    let state = AppState {
        active_project: Mutex::new(Some(initial_project)),
        project_manager,
        base_dir,
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            get_active_project,
            get_project_list,
            create_project,
            load_project,
            update_project,
            delete_project,
            export_draft,
            get_synonyms,
            get_locale,
            ai_tool,
            ai_relecture,
            ai_status,
            check_updates,
            backup_create,
            backup_list,
            backup_restore,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
