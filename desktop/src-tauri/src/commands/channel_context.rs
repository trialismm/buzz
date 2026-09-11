//! Channel context files — owner-curated reference material for a channel,
//! kept in this device's nest (`<nest>/context/<channel-id>/`). The harness
//! renders the folder into each new session's `<channel-context>` section
//! (see `buzz-acp::channel_context`), so files here reach the agents that run
//! on this machine without touching the relay.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

/// Per-file cap; matches the CLI's non-video upload limit.
const MAX_FILE_BYTES: u64 = 50 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelContextFile {
    pub name: String,
    pub size: u64,
    /// Unix seconds of the last modification, 0 when unknown.
    pub modified_at: i64,
}

/// Root of every channel's context folder; what the harness receives as
/// `BUZZ_ACP_CONTEXT_DIR`.
pub fn channel_context_root() -> Option<PathBuf> {
    crate::managed_agents::nest_dir().map(|nest| nest.join("context"))
}

fn channel_dir(channel_id: &str) -> Result<PathBuf, String> {
    let uuid = uuid::Uuid::parse_str(channel_id)
        .map_err(|_| format!("invalid channel UUID: {channel_id}"))?;
    channel_context_root()
        .map(|root| root.join(uuid.to_string()))
        .ok_or_else(|| "could not resolve the home directory".to_string())
}

/// Reduce an arbitrary name to a single safe path component: no separators,
/// no traversal, no control characters, never hidden.
fn sanitize_name(name: &str) -> Option<String> {
    let base = Path::new(name).file_name()?.to_str()?;
    let cleaned: String = base
        .chars()
        .filter(|c| !c.is_control() && *c != '/' && *c != '\\')
        .collect();
    let trimmed = cleaned.trim().trim_start_matches('.').to_string();
    if trimmed.is_empty() || trimmed == ".." {
        return None;
    }
    Some(trimmed)
}

/// `name`, or `name (2)`, `name (3)`, … until it does not collide in `dir`.
fn unique_name(dir: &Path, name: &str) -> String {
    if !dir.join(name).exists() {
        return name.to_string();
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => (stem.to_string(), format!(".{ext}")),
        _ => (name.to_string(), String::new()),
    };
    (2..)
        .map(|n| format!("{stem} ({n}){ext}"))
        .find(|candidate| !dir.join(candidate).exists())
        .unwrap_or_else(|| name.to_string())
}

fn list_dir(dir: &Path) -> Result<Vec<ChannelContextFile>, String> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Ok(Vec::new());
    };
    let mut files: Vec<ChannelContextFile> = entries
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let name = entry.file_name().to_str()?.to_string();
            if name.starts_with('.') {
                return None;
            }
            let meta = entry.metadata().ok()?;
            if !meta.is_file() {
                return None;
            }
            let modified_at = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            Some(ChannelContextFile {
                name,
                size: meta.len(),
                modified_at,
            })
        })
        .collect();
    files.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(files)
}

#[tauri::command]
pub async fn list_channel_context_files(
    channel_id: String,
) -> Result<Vec<ChannelContextFile>, String> {
    list_dir(&channel_dir(&channel_id)?)
}

/// Open the OS file picker and copy the chosen files into the channel's
/// context folder. Returns the folder's new listing; an empty pick is not
/// an error.
#[tauri::command]
pub async fn add_channel_context_files(
    channel_id: String,
    app: AppHandle,
) -> Result<Vec<ChannelContextFile>, String> {
    let dir = channel_dir(&channel_id)?;
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Add context files")
            .blocking_pick_files()
    })
    .await
    .map_err(|e| format!("file picker failed: {e}"))?;
    let Some(picked) = picked else {
        return list_dir(&dir);
    };
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    for file in picked {
        let source = file
            .into_path()
            .map_err(|e| format!("unsupported file location: {e}"))?;
        let meta = std::fs::metadata(&source)
            .map_err(|e| format!("cannot read {}: {e}", source.display()))?;
        if !meta.is_file() {
            return Err(format!("{} is not a file", source.display()));
        }
        if meta.len() > MAX_FILE_BYTES {
            return Err(format!(
                "{} is larger than the 50 MB limit",
                source.display()
            ));
        }
        let name = source
            .file_name()
            .and_then(|n| n.to_str())
            .and_then(sanitize_name)
            .ok_or_else(|| format!("{} has an unusable name", source.display()))?;
        let target = dir.join(unique_name(&dir, &name));
        std::fs::copy(&source, &target)
            .map_err(|e| format!("could not copy {}: {e}", source.display()))?;
    }
    list_dir(&dir)
}

#[tauri::command]
pub async fn remove_channel_context_file(channel_id: String, name: String) -> Result<(), String> {
    let dir = channel_dir(&channel_id)?;
    let name = sanitize_name(&name).ok_or_else(|| "invalid file name".to_string())?;
    let target = dir.join(&name);
    if target.parent() != Some(dir.as_path()) {
        return Err("invalid file name".into());
    }
    std::fs::remove_file(&target).map_err(|e| format!("could not remove {name}: {e}"))
}

/// Reveal the channel's context folder in the OS file browser (creating it
/// so there is always something to open).
#[tauri::command]
pub async fn reveal_channel_context_dir(channel_id: String, app: AppHandle) -> Result<(), String> {
    let dir = channel_dir(&channel_id)?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| format!("could not open folder: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_name_keeps_a_single_safe_component() {
        assert_eq!(sanitize_name("plan.md"), Some("plan.md".into()));
        assert_eq!(sanitize_name("/tmp/dir/plan.md"), Some("plan.md".into()));
        assert_eq!(sanitize_name("..\\..\\evil"), Some("evil".into()));
        assert_eq!(sanitize_name(".hidden"), Some("hidden".into()));
        assert_eq!(
            sanitize_name("bad\u{7}name.txt"),
            Some("badname.txt".into())
        );
        assert_eq!(sanitize_name(""), None);
        assert_eq!(sanitize_name(".."), None);
        assert_eq!(sanitize_name("   "), None);
    }

    #[test]
    fn unique_name_suffixes_collisions() {
        let dir = std::env::temp_dir().join(format!("buzz-ctx-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(unique_name(&dir, "a.md"), "a.md");
        std::fs::write(dir.join("a.md"), "x").unwrap();
        assert_eq!(unique_name(&dir, "a.md"), "a (2).md");
        std::fs::write(dir.join("a (2).md"), "x").unwrap();
        assert_eq!(unique_name(&dir, "a.md"), "a (3).md");
        assert_eq!(unique_name(&dir, "README"), "README");
    }

    #[test]
    fn list_dir_skips_hidden_and_non_files() {
        let dir = std::env::temp_dir().join(format!("buzz-ctx-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("b.txt"), "bb").unwrap();
        std::fs::write(dir.join("a.txt"), "a").unwrap();
        std::fs::write(dir.join(".DS_Store"), "x").unwrap();
        let names: Vec<(String, u64)> = list_dir(&dir)
            .unwrap()
            .into_iter()
            .map(|f| (f.name, f.size))
            .collect();
        assert_eq!(
            names,
            vec![("a.txt".to_string(), 1), ("b.txt".to_string(), 2)]
        );
        assert!(list_dir(&dir.join("missing")).unwrap().is_empty());
    }
}
