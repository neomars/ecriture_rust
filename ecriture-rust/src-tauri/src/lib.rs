pub mod project_manager;

use project_manager::{AppState, NovelProject, NovelData};
use std::sync::Mutex;
use tauri::State;
use std::fs;
use serde_json::Value;

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
    let mut projects = Vec::new();
    let projects_dir = state.base_dir.join("projects");
    if projects_dir.exists() {
        if let Ok(entries) = fs::read_dir(projects_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) == Some("json") {
                    if let Ok(content) = fs::read_to_string(&path) {
                        if let Ok(data) = serde_json::from_str::<Value>(&content) {
                            if let Some(title) = data.get("settings").and_then(|s| s.get("title")).and_then(|t| t.as_str()) {
                                projects.push(serde_json::json!({
                                    "filename": path.file_name().unwrap().to_str().unwrap(),
                                    "title": title
                                }));
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(projects)
}

#[tauri::command]
fn create_project(title: String, state: State<AppState>) -> Result<String, String> {
    let filename = format!("{}.json", uuid::Uuid::new_v4());
    let filepath = state.base_dir.join("projects").join(&filename);

    let mut project = NovelProject::new(Some(filepath.clone()));
    project.data.settings.title = title;
    project.save()?;

    let mut project_lock = state.active_project.lock().unwrap();
    *project_lock = Some(project);

    // update active project
    let active_path = state.base_dir.join("active_project.txt");
    let _ = fs::write(active_path, &filename);

    Ok("Project created".into())
}

#[tauri::command]
fn load_project(filename: String, state: State<AppState>) -> Result<NovelData, String> {
    let filepath = state.base_dir.join("projects").join(&filename);
    let mut project = NovelProject::new(Some(filepath));
    let _ = project.load();

    let data = project.data.clone();
    let mut project_lock = state.active_project.lock().unwrap();
    *project_lock = Some(project);

    let active_path = state.base_dir.join("active_project.txt");
    let _ = fs::write(active_path, &filename);

    Ok(data)
}

#[tauri::command]
fn update_project(data: NovelData, state: State<AppState>) -> Result<String, String> {
    let mut project_lock = state.active_project.lock().unwrap();
    if let Some(ref mut project) = *project_lock {
        project.data = data;
        project.save()?;
        Ok("Project saved".into())
    } else {
        Err("No active project".into())
    }
}

#[tauri::command]
fn check_updates() -> Result<Value, String> {
    Ok(serde_json::json!({"latest_version": "0.1.0"}))
}

#[tauri::command]
fn get_locale(lang: String) -> Result<Value, String> {
    let locale_path = format!("locales/{}.json", lang);
    if let Ok(content) = fs::read_to_string(&locale_path) {
        if let Ok(data) = serde_json::from_str(&content) {
            return Ok(data);
        }
    }
    Err(format!("Locale {} not found", lang))
}

#[tauri::command]
fn ai_status() -> Result<Value, String> {
    Ok(serde_json::json!({"installed": false, "message": "AI not implemented in mock"}))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let base_dir = std::env::current_dir().unwrap();
    let _ = fs::create_dir_all(base_dir.join("projects"));

    let active_path = base_dir.join("active_project.txt");
    let mut initial_project = None;
    if let Ok(filename) = fs::read_to_string(&active_path) {
        let filepath = base_dir.join("projects").join(filename.trim());
        if filepath.exists() {
            let mut project = NovelProject::new(Some(filepath));
            let _ = project.load();
            initial_project = Some(project);
        }
    }

    if initial_project.is_none() {
        let filename = "default.json";
        let filepath = base_dir.join("projects").join(filename);
        let mut project = NovelProject::new(Some(filepath.clone()));
        let _ = project.save();
        let _ = fs::write(&active_path, filename);
        initial_project = Some(project);
    }

    let state = AppState {
        active_project: Mutex::new(initial_project),
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
            check_updates,
            get_locale,
            ai_status,
            delete_project
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn delete_project(filename: String, state: tauri::State<AppState>) -> Result<Value, String> {
    let filepath = state.base_dir.join("projects").join(&filename);
    if filepath.exists() {
        if let Err(e) = std::fs::remove_file(filepath) {
            return Ok(serde_json::json!({"status": "error", "message": e.to_string()}));
        }

        let mut project_lock = state.active_project.lock().unwrap();
        if let Some(ref project) = *project_lock {
            if let Some(ref active_path) = project.filepath {
                if active_path.file_name().and_then(|n| n.to_str()) == Some(&filename) {
                    *project_lock = None;
                }
            }
        }

        Ok(serde_json::json!({"status": "success"}))
    } else {
        Ok(serde_json::json!({"status": "error", "message": "File not found"}))
    }
}
