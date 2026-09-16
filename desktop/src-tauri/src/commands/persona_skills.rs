//! Persona working directory and skills — the owner-facing side of
//! `managed_agents::persona_workdir`. Every command resolves the persona's
//! folder under the nest and makes sure it is rendered before touching it.

use std::path::PathBuf;

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::managed_agents::persona_workdir::{
    ensure_persona_workdir, import_skill, list_skills, remove_skill, PersonaSkill,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonaWorkdirInfo {
    /// Absolute path of the persona's folder.
    pub path: String,
    pub skills: Vec<PersonaSkill>,
}

fn workdir(persona_id: &str) -> Result<PathBuf, String> {
    let nest = crate::managed_agents::nest_dir()
        .ok_or_else(|| "could not resolve the home directory".to_string())?;
    ensure_persona_workdir(&nest, persona_id)
}

fn info(dir: &std::path::Path) -> PersonaWorkdirInfo {
    PersonaWorkdirInfo {
        path: dir.to_string_lossy().into_owned(),
        skills: list_skills(dir),
    }
}

/// The persona's folder (created on first call) and its skills.
#[tauri::command]
pub async fn get_persona_workdir(persona_id: String) -> Result<PersonaWorkdirInfo, String> {
    Ok(info(&workdir(&persona_id)?))
}

/// Open the OS folder picker and copy the chosen skill folder in. An empty
/// pick is not an error; the result is the folder's new state.
#[tauri::command]
pub async fn add_persona_skill(
    persona_id: String,
    app: AppHandle,
) -> Result<PersonaWorkdirInfo, String> {
    let dir = workdir(&persona_id)?;
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Add a skill folder (contains SKILL.md)")
            .blocking_pick_folder()
    })
    .await
    .map_err(|e| format!("folder picker failed: {e}"))?;
    if let Some(folder) = picked {
        let source = folder
            .into_path()
            .map_err(|e| format!("unsupported folder location: {e}"))?;
        import_skill(&dir, &source)?;
    }
    Ok(info(&dir))
}

#[tauri::command]
pub async fn remove_persona_skill(
    persona_id: String,
    folder: String,
) -> Result<PersonaWorkdirInfo, String> {
    let dir = workdir(&persona_id)?;
    remove_skill(&dir, &folder)?;
    Ok(info(&dir))
}

/// Reveal the persona's folder in the OS file browser.
#[tauri::command]
pub async fn reveal_persona_workdir(persona_id: String, app: AppHandle) -> Result<(), String> {
    let dir = workdir(&persona_id)?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| format!("could not open folder: {e}"))
}
