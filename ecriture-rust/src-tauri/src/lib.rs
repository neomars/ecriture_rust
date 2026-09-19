//! Tauri command layer: thin adapters over `ecriture-core`.
//!
//! All actual business logic (project persistence, export, synonyms,
//! backups, AI prompt/fallback plumbing) lives in the `ecriture-core`
//! crate, which has no Tauri dependency and is covered by its own unit and
//! integration test suite. This file's job is limited to (1) translating
//! Tauri command arguments into core calls, (2) holding the app's shared
//! mutable state behind a `Mutex`, and (3) mapping core errors to the
//! `Result<_, String>` shape `#[tauri::command]` expects.

use ecriture_core::ai::inference::LlamaEngine;
use ecriture_core::ai::model_store;
use ecriture_core::export::{self, ExportFormat};
use ecriture_core::model::NovelData;
use ecriture_core::synonyms::SynonymDb;
use ecriture_core::{ai, backup, locale, update, NovelProject, ProjectManager};
use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{Manager, State};

pub struct AppState {
    pub active_project: Mutex<Option<NovelProject>>,
    pub project_manager: ProjectManager,
    /// Where the bundled `lexique.db` resource was found at startup, if any
    /// (see [`resolve_lexique_db_path`]).
    pub lexique_db_path: Option<PathBuf>,
    /// The local Gemma engine, loaded lazily on first use (loading a
    /// multi-gigabyte GGUF file takes real time, so we don't do it at
    /// startup) and cached for the app's lifetime thereafter.
    pub ai_engine: Mutex<Option<Arc<LlamaEngine>>>,
    /// Progress of an in-flight (or just-finished) model download, polled
    /// by the frontend. Shared with the background download thread.
    pub ai_install: Arc<Mutex<AiInstallState>>,
}

#[derive(Clone, Serialize)]
pub struct AiInstallState {
    /// "idle" | "downloading" | "done" | "error"
    status: String,
    message: String,
    progress: u8,
    eta_secs: Option<u64>,
}

impl Default for AiInstallState {
    fn default() -> Self {
        Self {
            status: "idle".into(),
            message: String::new(),
            progress: 0,
            eta_secs: None,
        }
    }
}

/// Locates the bundled `lexique.db` (see `tauri.conf.json`'s
/// `bundle.resources`). Tries Tauri's own resource resolver first - the
/// correct, portable way to find a bundled resource both in a packaged app
/// and under `cargo tauri dev` - then falls back to the in-tree copy owned
/// by `ecriture-core` for a plain `cargo run`/`cargo test` invocation that
/// has no `AppHandle` at all.
fn resolve_lexique_db_path(app: &tauri::App) -> Option<PathBuf> {
    if let Ok(path) = app
        .path()
        .resolve("resources/lexique.db", tauri::path::BaseDirectory::Resource)
    {
        if path.exists() {
            return Some(path);
        }
    }

    let dev_fallback = PathBuf::from(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../ecriture-core/resources/lexique.db"
    ));
    dev_fallback.exists().then_some(dev_fallback)
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
    let Some(db_path) = state.lexique_db_path.as_ref() else {
        return Ok(Vec::new());
    };
    let db = SynonymDb::open(db_path).map_err(|e| e.to_string())?;
    db.lookup(&word, &lang).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_locale(lang: String) -> Result<Value, String> {
    locale::get_locale(&lang).map_err(|e| e.to_string())
}

/// Returns the already-loaded engine if there is one, otherwise loads it
/// synchronously if the model file is present on disk. Loading blocks the
/// calling command for a few seconds (spawning llama.cpp's backend +
/// reading the GGUF file into RAM); that's an acceptable one-time cost on
/// the first AI request, matching `ai_client.py`'s own lazy `_load_model`.
/// Returns `None` (never an error) when no model is installed or loading
/// fails, since every caller here treats "no engine" as "use the fallback".
fn get_or_load_engine(state: &AppState) -> Option<Arc<LlamaEngine>> {
    let mut guard = state.ai_engine.lock().unwrap();
    if let Some(engine) = guard.as_ref() {
        return Some(engine.clone());
    }

    let cache_dir = model_store::model_cache_dir();
    if !model_store::is_model_installed(&cache_dir) {
        eprintln!("[ai] get_or_load_engine: no model file at {}", model_store::model_path(&cache_dir).display());
        return None;
    }

    let model_path = model_store::model_path(&cache_dir);
    eprintln!("[ai] get_or_load_engine: loading {} (this can take a while)...", model_path.display());
    match LlamaEngine::load(&model_path, model_store::N_CTX) {
        Ok(engine) => {
            eprintln!("[ai] get_or_load_engine: model loaded successfully");
            let engine = Arc::new(engine);
            *guard = Some(engine.clone());
            Some(engine)
        }
        Err(e) => {
            eprintln!("[ai] get_or_load_engine: FAILED to load model: {e}");
            None
        }
    }
}

#[derive(Serialize)]
struct AiToolResponse {
    status: &'static str,
    message: String,
}

/// Runs a contextual writing tool (describe/rewrite/expand/...) through the
/// local Gemma engine when it's installed and loads successfully; falls
/// back to the offline simulated response otherwise (missing model, load
/// failure, or a generation error), mirroring `ai_client.py`'s try/except
/// structure in `main.py::handle_ai_tool`.
#[tauri::command]
#[allow(clippy::too_many_arguments)] // one JS-facing key per Tauri command arg; a struct would nest under one key instead
fn ai_tool(
    tool: String,
    style: String,
    text: String,
    lang: String,
    temperature: Option<f32>,
    scene_id: Option<String>,
    inject_lore_context: Option<bool>,
    state: State<AppState>,
) -> Result<AiToolResponse, String> {
    let mut system_prompt = ai::build_tool_system_prompt(&tool, &style, &lang).map_err(|e| e.to_string())?;

    if inject_lore_context.unwrap_or(true) {
        if let Some(scene_id) = scene_id.as_deref().filter(|s| !s.is_empty()) {
            if let Some(lore_ctx) = scene_lore_context(&state, scene_id) {
                system_prompt = format!("{lore_ctx}\n\nConsignes de l'assistant :\n{system_prompt}");
            }
        }
    }

    if let Some(engine) = get_or_load_engine(&state) {
        let messages = ai::normalize_gemma_messages(&[
            ai::ChatMessage { role: "system".into(), content: system_prompt },
            ai::ChatMessage { role: "user".into(), content: text.clone() },
        ]);
        match ai::AiBackend::generate_chat(&*engine, &messages, temperature.unwrap_or(0.7)) {
            Ok(message) => return Ok(AiToolResponse { status: "success", message }),
            Err(e) => eprintln!("[ai] ai_tool: generation failed, falling back: {e}"),
        }
    }

    Ok(AiToolResponse {
        status: "offline_fallback",
        message: ai::fallback_response(&tool, &text, &style, &lang),
    })
}

/// Fetches lore context for `scene_id` from the active project, if any.
fn scene_lore_context(state: &AppState, scene_id: &str) -> Option<String> {
    let project_lock = state.active_project.lock().unwrap();
    let project = project_lock.as_ref()?;
    let ctx = ai::lore::build_scene_context(&project.data, scene_id);
    if ctx.is_empty() {
        None
    } else {
        Some(ctx)
    }
}

#[derive(Serialize)]
struct AiRelectureResponse {
    status: &'static str,
    feedback: String,
}

/// Runs the "relecture" (proofreading) assistant for a block of text.
/// `category` is one of "style", "coherence" or "worldbuilding". Same
/// real-engine-then-fallback strategy as [`ai_tool`].
#[tauri::command]
fn ai_relecture(
    category: String,
    text: String,
    lang: String,
    temperature: Option<f32>,
    lore_context: Option<String>,
    state: State<AppState>,
) -> Result<AiRelectureResponse, String> {
    let fallback_category = match category.as_str() {
        "style" => "relecture_style",
        _ => "relecture_coherence",
    };

    if let Some(engine) = get_or_load_engine(&state) {
        let system_prompt = ai::build_relecture_system_prompt(
            &category,
            &lang,
            lore_context.as_deref().unwrap_or(""),
        );
        let messages = ai::normalize_gemma_messages(&[
            ai::ChatMessage { role: "system".into(), content: system_prompt },
            ai::ChatMessage { role: "user".into(), content: text.clone() },
        ]);
        match ai::AiBackend::generate_chat(&*engine, &messages, temperature.unwrap_or(0.7)) {
            Ok(feedback) => return Ok(AiRelectureResponse { status: "success", feedback }),
            Err(e) => eprintln!("[ai] ai_relecture: generation failed, falling back: {e}"),
        }
    }

    Ok(AiRelectureResponse {
        status: "offline_fallback",
        feedback: ai::fallback_response(fallback_category, &text, "", &lang),
    })
}

#[derive(Serialize)]
struct AiChatResponse {
    status: &'static str,
    message: String,
}

/// A freeform multi-turn chat with the local assistant (used by the AI
/// chat sidebar). `messages` is the full conversation so far, oldest
/// first, with roles among "system"/"user"/"assistant".
#[tauri::command]
fn ai_chat(
    mut messages: Vec<ai::ChatMessage>,
    lang: String,
    temperature: Option<f32>,
    scene_id: Option<String>,
    inject_lore_context: Option<bool>,
    state: State<AppState>,
) -> Result<AiChatResponse, String> {
    let mut system_msgs = vec![format!(
        "Respond strictly in this language: {}.",
        match lang.as_str() {
            "fr" => "French",
            "es" => "Spanish",
            "ru" => "Russian",
            _ => "English",
        }
    )];
    if inject_lore_context.unwrap_or(true) {
        if let Some(scene_id) = scene_id.as_deref().filter(|s| !s.is_empty()) {
            if let Some(lore_ctx) = scene_lore_context(&state, scene_id) {
                system_msgs.push(ai::build_chat_lore_intro(&lang, &lore_ctx));
            }
        }
    }
    messages.insert(
        0,
        ai::ChatMessage { role: "system".into(), content: system_msgs.join("\n\n") },
    );

    let normalized = ai::normalize_gemma_messages(&messages);
    if let Some(engine) = get_or_load_engine(&state) {
        match ai::AiBackend::generate_chat(&*engine, &normalized, temperature.unwrap_or(0.7)) {
            Ok(message) => return Ok(AiChatResponse { status: "success", message }),
            Err(e) => eprintln!("[ai] ai_chat: generation failed, falling back: {e}"),
        }
    }

    let last_user_text = messages
        .iter()
        .rev()
        .find(|m| m.role == "user")
        .map(|m| m.content.as_str())
        .unwrap_or("");
    Ok(AiChatResponse {
        status: "offline_fallback",
        message: ai::fallback_response("chat", last_user_text, "", &lang),
    })
}

#[tauri::command]
fn ai_models() -> Result<Value, String> {
    let installed = model_store::is_model_installed(&model_store::model_cache_dir());
    Ok(serde_json::json!({
        "status": if installed { "success" } else { "offline" },
        "models": if installed { vec!["gemma-2-2b-it"] } else { Vec::<&str>::new() },
    }))
}

#[derive(Serialize)]
struct AiExtractResponse {
    status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    characters: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

/// Extracts character sheets (name/appearance/traits/notes) from freeform
/// text via the local engine. Unlike the writing tools above, there is no
/// offline fallback for this one - structured JSON extraction isn't
/// something a canned string can simulate - matching
/// `main.py::api_extract_characters`, which likewise just reports an error
/// when the model is unavailable or its output isn't parseable JSON.
#[tauri::command]
fn ai_extract_characters(text: String, lang: String, state: State<AppState>) -> Result<AiExtractResponse, String> {
    let text = text.trim();
    if text.is_empty() {
        return Ok(AiExtractResponse {
            status: "empty",
            characters: Some(serde_json::json!([])),
            message: None,
        });
    }

    let Some(engine) = get_or_load_engine(&state) else {
        return Ok(AiExtractResponse {
            status: "error",
            characters: None,
            message: Some("No local AI engine is installed.".into()),
        });
    };

    let system_prompt = format!("{}{}", ai::prompts::EXTRACT_LORE, lang_instruction_for(&lang));
    let messages = ai::normalize_gemma_messages(&[
        ai::ChatMessage { role: "system".into(), content: system_prompt },
        ai::ChatMessage { role: "user".into(), content: text.to_string() },
    ]);

    match ai::AiBackend::generate_chat(&*engine, &messages, 0.1) {
        Ok(content) => match ai::extract_json_array(&content) {
            Some(characters) => Ok(AiExtractResponse {
                status: "success",
                characters: Some(characters),
                message: None,
            }),
            None => Ok(AiExtractResponse {
                status: "error",
                characters: None,
                message: Some("Failed to parse JSON response".into()),
            }),
        },
        Err(e) => Ok(AiExtractResponse {
            status: "error",
            characters: None,
            message: Some(e),
        }),
    }
}

fn lang_instruction_for(lang: &str) -> &'static str {
    match lang {
        "fr" => "Respond strictly in this language: French.",
        "es" => "Respond strictly in this language: Spanish.",
        "ru" => "Respond strictly in this language: Russian.",
        _ => "Respond strictly in this language: English.",
    }
}

#[tauri::command]
fn ai_status(state: State<AppState>) -> Result<Value, String> {
    let cache_dir = model_store::model_cache_dir();
    let installed = model_store::is_model_installed(&cache_dir);
    let engine_loaded = state.ai_engine.lock().unwrap().is_some();
    eprintln!(
        "[ai] ai_status: cache_dir={} installed={installed} engine_loaded={engine_loaded}",
        cache_dir.display()
    );
    Ok(serde_json::json!({
        "status": if installed { "online" } else { "offline" },
        "installed": installed,
        "models": if installed { vec!["gemma-2-2b-it"] } else { Vec::<&str>::new() },
        "engine_loaded": engine_loaded,
    }))
}

/// Starts (or reports already-in-progress) a background download of the
/// Gemma model into `ecriture_core::ai::model_store::model_cache_dir()`.
/// Ports `main.py::install_engine` / `_install_gemma_thread`.
#[tauri::command]
fn ai_install_engine(state: State<AppState>) -> Result<Value, String> {
    eprintln!("[ai] ai_install_engine invoked");
    {
        let current = state.ai_install.lock().unwrap();
        if current.status == "downloading" {
            eprintln!("[ai] ai_install_engine: already downloading, ignoring");
            return Ok(serde_json::json!({"status": "success", "message": "Installation already in progress"}));
        }
    }

    let dest = model_store::model_path(&model_store::model_cache_dir());
    eprintln!("[ai] starting Gemma download: {} -> {}", model_store::MODEL_URL, dest.display());
    let install_state = state.ai_install.clone();
    *install_state.lock().unwrap() = AiInstallState {
        status: "downloading".into(),
        message: "Preparing...".into(),
        progress: 0,
        eta_secs: None,
    };

    std::thread::spawn(move || {
        let started_at = std::time::Instant::now();
        let result = ai::download::download_to_file(model_store::MODEL_URL, &dest, |downloaded, total| {
            let mut s = install_state.lock().unwrap();
            if let Some(total) = total {
                if total > 0 {
                    s.progress = ((downloaded as f64 / total as f64) * 100.0).min(99.0) as u8;
                }
                let elapsed = started_at.elapsed().as_secs_f64();
                if elapsed > 0.5 && downloaded > 0 {
                    let speed = downloaded as f64 / elapsed;
                    let remaining = total.saturating_sub(downloaded) as f64;
                    s.eta_secs = Some((remaining / speed).round() as u64);
                }
            }
            let mb = |b: u64| b / 1_000_000;
            s.message = match total {
                Some(t) => format!("{} / {} Mo", mb(downloaded), mb(t)),
                None => format!("{} Mo", mb(downloaded)),
            };
        });

        let mut s = install_state.lock().unwrap();
        match result {
            Ok(()) => {
                eprintln!("[ai] Gemma download finished successfully");
                *s = AiInstallState {
                    status: "done".into(),
                    message: "Installation complete.".into(),
                    progress: 100,
                    eta_secs: None,
                };
            }
            Err(e) => {
                eprintln!("[ai] Gemma download failed: {e}");
                *s = AiInstallState {
                    status: "error".into(),
                    message: format!("Download failed: {e}"),
                    progress: s.progress,
                    eta_secs: None,
                };
            }
        }
    });

    Ok(serde_json::json!({"status": "success", "message": "Installation started"}))
}

#[tauri::command]
fn ai_install_status(state: State<AppState>) -> Result<AiInstallState, String> {
    Ok(state.ai_install.lock().unwrap().clone())
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
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // IMPORTANT: project data must NOT live under the `src-tauri`
            // source tree. `cargo tauri dev` watches that directory and
            // triggers a full rebuild + app restart on any file change; if
            // every autosave writes there, the app appears to "crash" and
            // need relaunching after every edit. The OS app-data directory
            // is the correct, stable place for this regardless of whether
            // the app is running from `cargo tauri dev` or a packaged
            // install.
            let base_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve the app data directory");
            std::fs::create_dir_all(&base_dir)
                .expect("failed to create the app data directory");

            let lexique_db_path = resolve_lexique_db_path(app);

            let project_manager = ProjectManager::new(&base_dir);
            project_manager
                .ensure_dirs()
                .expect("failed to create the projects directory");

            let initial_project = project_manager
                .load_active()
                .expect("failed to load or create the initial project");

            app.manage(AppState {
                active_project: Mutex::new(Some(initial_project)),
                project_manager,
                lexique_db_path,
                ai_engine: Mutex::new(None),
                ai_install: Arc::new(Mutex::new(AiInstallState::default())),
            });

            Ok(())
        })
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
            ai_chat,
            ai_status,
            ai_models,
            ai_extract_characters,
            ai_install_engine,
            ai_install_status,
            check_updates,
            backup_create,
            backup_list,
            backup_restore,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
