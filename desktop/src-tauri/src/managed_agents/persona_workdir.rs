//! Per-persona working directories. A persona whose env carries
//! `BUZZ_PERSONA_WORKDIR=own` spawns its agents in `<nest>/personas/<id>/`
//! instead of the shared nest: a full mini-nest (`ensure_nest_at`, so the
//! AGENTS.md conventions and the `buzz-cli` skill are all there) plus the
//! persona's own skills under `.agents/skills/<folder>/SKILL.md`. Every skill
//! is linked into each known runtime's skill directory (`.claude/skills`,
//! `.codex/skills`, `.goose/skills`) so each harness discovers it by its own
//! convention; buzz-agent scans `.agents/skills` directly.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::discovery::known_skill_dirs;

/// Persona env marker; `own` = spawn in the persona's own folder.
pub(crate) const WORKDIR_ENV_KEY: &str = "BUZZ_PERSONA_WORKDIR";
const OWN_MARKER: &str = "own";
/// Folder under the nest that holds every persona workdir.
const PERSONAS_DIR: &str = "personas";
const SKILLS_DIR: &str = ".agents/skills";
/// The nest's managed skill; never listed, imported or removed here.
const BUILTIN_SKILL: &str = "buzz-cli";

/// True when the (layered) agent env asks for the persona's own folder.
pub(crate) fn wants_own_workdir(env: &BTreeMap<String, String>) -> bool {
    env.get(WORKDIR_ENV_KEY)
        .map(|v| v.trim().eq_ignore_ascii_case(OWN_MARKER))
        .unwrap_or(false)
}

/// `<nest>/personas/<folder>` where `folder` is the persona id reduced to a
/// safe single path component. Ids are UUIDs for owner personas and
/// `builtin:<name>` for the bundled ones; any other character maps to `_`
/// and, when that changed the id, a short hash keeps the folder unique.
pub(crate) fn persona_workdir(nest: &Path, persona_id: &str) -> Result<PathBuf, String> {
    let id = persona_id.trim();
    if id.is_empty() {
        return Err("persona id is empty".to_string());
    }
    let cleaned: String = id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.') {
                c
            } else {
                '_'
            }
        })
        .collect();
    let cleaned = cleaned.trim_start_matches('.').to_string();
    if cleaned.is_empty() {
        return Err(format!("invalid persona id: {persona_id}"));
    }
    let folder = if cleaned == id {
        cleaned
    } else {
        use sha2::Digest as _;
        let digest = sha2::Sha256::digest(id.as_bytes());
        format!("{cleaned}-{}", hex::encode(&digest[..4]))
    };
    Ok(nest.join(PERSONAS_DIR).join(folder))
}

/// Create (or refresh) the persona's folder as a mini-nest and link its
/// skills for every known runtime. Idempotent; safe before every spawn.
pub(crate) fn ensure_persona_workdir(nest: &Path, persona_id: &str) -> Result<PathBuf, String> {
    let dir = persona_workdir(nest, persona_id)?;
    fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    super::ensure_nest_at(&dir)?;
    link_skills(&dir)?;
    Ok(dir)
}

/// One owner-managed skill in a persona folder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonaSkill {
    /// Frontmatter `name`.
    pub name: String,
    /// Frontmatter `description` (may be empty).
    pub description: String,
    /// The folder under `.agents/skills`.
    pub folder: String,
}

fn skills_root(dir: &Path) -> PathBuf {
    dir.join(SKILLS_DIR)
}

/// Owner skills in `<dir>/.agents/skills`, sorted by folder; the built-in
/// `buzz-cli` and folders without a valid `SKILL.md` are left out.
pub(crate) fn list_skills(dir: &Path) -> Vec<PersonaSkill> {
    let Ok(entries) = fs::read_dir(skills_root(dir)) else {
        return Vec::new();
    };
    let mut folders: Vec<PathBuf> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| fs::metadata(p).map(|m| m.is_dir()).unwrap_or(false))
        .collect();
    folders.sort();
    folders
        .into_iter()
        .filter_map(|folder| {
            let folder_name = folder.file_name()?.to_str()?.to_string();
            if folder_name == BUILTIN_SKILL {
                return None;
            }
            let content = fs::read_to_string(folder.join("SKILL.md")).ok()?;
            let (name, description) = parse_skill_frontmatter(&content)?;
            Some(PersonaSkill {
                name,
                description,
                folder: folder_name,
            })
        })
        .collect()
}

/// `SKILL.md` frontmatter: `name` (required) and `description`. Same
/// contract as buzz-agent's `hints::parse_skill_frontmatter`.
pub(crate) fn parse_skill_frontmatter(content: &str) -> Option<(String, String)> {
    let rest = content
        .strip_prefix("---\n")
        .or_else(|| content.strip_prefix("---\r\n"))?;
    let close = rest.find("\n---")?;
    let map: BTreeMap<String, serde_yaml::Value> = serde_yaml::from_str(&rest[..close]).ok()?;
    let name = map
        .get("name")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())?
        .to_string();
    let description = map
        .get("description")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .unwrap_or("")
        .to_string();
    Some((name, description))
}

/// A single safe folder name: no separators, no traversal, never hidden.
fn sanitize_folder(name: &str) -> Option<String> {
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

/// Copy `source` (a folder holding a valid `SKILL.md`) into the persona's
/// skills and link it for every runtime.
pub(crate) fn import_skill(dir: &Path, source: &Path) -> Result<PersonaSkill, String> {
    let meta =
        fs::metadata(source).map_err(|e| format!("cannot read {}: {e}", source.display()))?;
    if !meta.is_dir() {
        return Err(format!("{} is not a folder", source.display()));
    }
    let content = fs::read_to_string(source.join("SKILL.md"))
        .map_err(|_| format!("{} has no SKILL.md", source.display()))?;
    let (name, description) = parse_skill_frontmatter(&content).ok_or_else(|| {
        format!(
            "{}/SKILL.md needs YAML frontmatter with a `name`",
            source.display()
        )
    })?;
    let folder = source
        .file_name()
        .and_then(|n| n.to_str())
        .and_then(sanitize_folder)
        .ok_or_else(|| format!("{} has an unusable folder name", source.display()))?;
    if folder == BUILTIN_SKILL {
        return Err(format!(
            "{BUILTIN_SKILL} is the built-in skill; pick another folder name"
        ));
    }
    let root = skills_root(dir);
    fs::create_dir_all(&root).map_err(|e| format!("create {}: {e}", root.display()))?;
    let target = root.join(&folder);
    if target.symlink_metadata().is_ok() {
        return Err(format!("a skill folder named {folder} already exists"));
    }
    copy_dir(source, &target)?;
    link_skills(dir)?;
    Ok(PersonaSkill {
        name,
        description,
        folder,
    })
}

/// Remove a skill folder and every runtime link that pointed at it.
pub(crate) fn remove_skill(dir: &Path, folder: &str) -> Result<(), String> {
    let folder = sanitize_folder(folder).ok_or_else(|| "invalid skill folder".to_string())?;
    if folder == BUILTIN_SKILL {
        return Err(format!("{BUILTIN_SKILL} is managed by Buzz"));
    }
    let target = skills_root(dir).join(&folder);
    if target.symlink_metadata().is_ok() {
        fs::remove_dir_all(&target).map_err(|e| format!("could not remove {folder}: {e}"))?;
    }
    link_skills(dir)
}

fn copy_dir(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target).map_err(|e| format!("create {}: {e}", target.display()))?;
    for entry in fs::read_dir(source).map_err(|e| format!("read {}: {e}", source.display()))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let from = entry.path();
        let to = target.join(entry.file_name());
        let meta =
            fs::metadata(&from).map_err(|e| format!("cannot read {}: {e}", from.display()))?;
        if meta.is_dir() {
            copy_dir(&from, &to)?;
        } else {
            fs::copy(&from, &to).map_err(|e| format!("could not copy {}: {e}", from.display()))?;
        }
    }
    Ok(())
}

/// Link every owner skill into each known runtime skill directory and drop
/// links whose skill is gone. The built-in link is `ensure_nest_at`'s.
#[cfg(unix)]
pub(crate) fn link_skills(dir: &Path) -> Result<(), String> {
    let skills: Vec<String> = list_skills(dir).into_iter().map(|s| s.folder).collect();
    for skill_dir in known_skill_dirs() {
        let parent = dir.join(skill_dir);
        fs::create_dir_all(&parent).map_err(|e| format!("create {}: {e}", parent.display()))?;
        let depth = Path::new(skill_dir).components().count();
        let prefix = "../".repeat(depth);
        // Drop dangling links we own (relative links into `.agents/skills`).
        if let Ok(entries) = fs::read_dir(&parent) {
            for entry in entries.filter_map(|e| e.ok()) {
                let link = entry.path();
                let Ok(stored) = fs::read_link(&link) else {
                    continue;
                };
                let name = entry.file_name().to_string_lossy().into_owned();
                let ours = stored
                    .to_string_lossy()
                    .starts_with(&format!("{prefix}{SKILLS_DIR}/"));
                if ours && name != BUILTIN_SKILL && !skills.contains(&name) {
                    fs::remove_file(&link)
                        .map_err(|e| format!("unlink {}: {e}", link.display()))?;
                }
            }
        }
        for folder in &skills {
            let link = parent.join(folder);
            if link.symlink_metadata().is_ok() {
                continue;
            }
            let target = format!("{prefix}{SKILLS_DIR}/{folder}");
            crate::util::create_symlink(Path::new(&target), &link)
                .map_err(|e| format!("symlink {} → {target}: {e}", link.display()))?;
        }
    }
    Ok(())
}

#[cfg(not(unix))]
pub(crate) fn link_skills(_dir: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const PERSONA: &str = "11111111-2222-4333-8444-555555555555";

    fn write_skill(dir: &Path, folder: &str, name: &str) {
        fs::create_dir_all(dir.join(folder)).unwrap();
        fs::write(
            dir.join(folder).join("SKILL.md"),
            format!("---\nname: {name}\ndescription: does {name}\n---\n# {name}\n"),
        )
        .unwrap();
    }

    #[test]
    fn marker_and_path_are_strict() {
        let mut env = BTreeMap::new();
        assert!(!wants_own_workdir(&env));
        env.insert(WORKDIR_ENV_KEY.to_string(), " OWN ".to_string());
        assert!(wants_own_workdir(&env));
        env.insert(WORKDIR_ENV_KEY.to_string(), "shared".to_string());
        assert!(!wants_own_workdir(&env));

        let nest = Path::new("/nest");
        assert_eq!(
            persona_workdir(nest, PERSONA).unwrap(),
            PathBuf::from("/nest/personas").join(PERSONA)
        );
        // Bundled personas: `builtin:fizz` → a safe, unique folder.
        let builtin = persona_workdir(nest, "builtin:fizz").unwrap();
        let folder = builtin.file_name().unwrap().to_string_lossy().into_owned();
        assert!(folder.starts_with("builtin_fizz-"), "{folder}");
        assert_eq!(builtin.parent(), Some(Path::new("/nest/personas")));
        assert_ne!(
            persona_workdir(nest, "builtin:fizz").unwrap(),
            persona_workdir(nest, "builtin/fizz").unwrap()
        );
        // Traversal never escapes the personas folder.
        let odd = persona_workdir(nest, "../etc").unwrap();
        assert_eq!(odd.parent(), Some(Path::new("/nest/personas")));
        assert!(persona_workdir(nest, "  ").is_err());
        assert!(persona_workdir(nest, "...").is_err());
    }

    #[test]
    fn frontmatter_requires_a_name() {
        assert_eq!(
            parse_skill_frontmatter("---\nname: fetch\ndescription: get pages\n---\nbody"),
            Some(("fetch".into(), "get pages".into()))
        );
        assert_eq!(
            parse_skill_frontmatter("---\nname: fetch\n---\n"),
            Some(("fetch".into(), String::new()))
        );
        assert_eq!(parse_skill_frontmatter("---\ndescription: x\n---\n"), None);
        assert_eq!(parse_skill_frontmatter("# no frontmatter"), None);
    }

    #[cfg(unix)]
    #[test]
    fn workdir_is_a_mini_nest_whose_skills_are_linked_for_every_runtime() {
        let temp = tempfile::tempdir().unwrap();
        let dir = ensure_persona_workdir(temp.path(), PERSONA).unwrap();
        assert!(dir.join("AGENTS.md").is_file(), "mini-nest rendered");
        assert!(dir
            .join(".claude/skills/buzz-cli")
            .symlink_metadata()
            .is_ok());
        assert!(
            list_skills(&dir).is_empty(),
            "built-in skill is not an owner skill"
        );

        // Import from an outside folder.
        let src = tempfile::tempdir().unwrap();
        write_skill(src.path(), "fetch", "fetch");
        let imported = import_skill(&dir, &src.path().join("fetch")).unwrap();
        assert_eq!(imported.folder, "fetch");
        assert_eq!(list_skills(&dir).len(), 1);
        for skill_dir in known_skill_dirs() {
            let link = dir.join(skill_dir).join("fetch");
            assert!(link.join("SKILL.md").is_file(), "{skill_dir} link resolves");
            assert_eq!(
                fs::read_link(&link).unwrap(),
                PathBuf::from("../../.agents/skills/fetch")
            );
        }
        // Duplicates and the built-in name are refused.
        assert!(import_skill(&dir, &src.path().join("fetch")).is_err());
        write_skill(src.path(), "buzz-cli", "x");
        assert!(import_skill(&dir, &src.path().join("buzz-cli")).is_err());
        // A folder without frontmatter is refused.
        fs::create_dir_all(src.path().join("bare")).unwrap();
        fs::write(src.path().join("bare/SKILL.md"), "no frontmatter").unwrap();
        assert!(import_skill(&dir, &src.path().join("bare")).is_err());

        // Removal drops the folder and the links, keeps the built-in link.
        remove_skill(&dir, "fetch").unwrap();
        assert!(list_skills(&dir).is_empty());
        for skill_dir in known_skill_dirs() {
            assert!(dir
                .join(skill_dir)
                .join("fetch")
                .symlink_metadata()
                .is_err());
            assert!(dir
                .join(skill_dir)
                .join("buzz-cli")
                .symlink_metadata()
                .is_ok());
        }
        assert!(remove_skill(&dir, "buzz-cli").is_err());
    }
}
