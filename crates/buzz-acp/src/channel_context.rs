//! Owner-curated context files for a channel — the Desktop's Channel
//! Settings → Context folder (`<BUZZ_ACP_CONTEXT_DIR>/<channel-id>/`).
//!
//! Rendered once per session creation into a `<channel-context>` system
//! prompt section: small text files are inlined so the agent has them
//! without a tool call; everything else is listed with its path and size so
//! the agent can read it with its own file tools when relevant. Bounded by
//! [`INLINE_TOTAL_BUDGET`] / [`INLINE_FILE_MAX`] so a large folder can never
//! blow up the prompt — the list itself is capped at [`MAX_LISTED_FILES`].

use std::path::Path;

use uuid::Uuid;

/// Total bytes of file content inlined per session.
pub const INLINE_TOTAL_BUDGET: usize = 32 * 1024;
/// Largest single file that may be inlined; bigger text files are listed.
pub const INLINE_FILE_MAX: usize = 16 * 1024;
/// Files listed at most; the remainder is summarized as a count.
pub const MAX_LISTED_FILES: usize = 200;

const TEXT_EXTENSIONS: &[&str] = &[
    "md", "markdown", "txt", "text", "csv", "tsv", "json", "jsonl", "yaml", "yml", "toml", "xml",
    "ini", "cfg", "conf", "env", "log", "rs", "ts", "tsx", "js", "jsx", "mjs", "py", "rb", "go",
    "java", "kt", "swift", "c", "h", "cpp", "hpp", "cs", "sh", "bash", "zsh", "sql", "html", "css",
    "scss",
];

#[derive(Debug, Clone, PartialEq, Eq)]
struct ContextFile {
    name: String,
    size: u64,
    path: String,
}

fn is_text_name(name: &str) -> bool {
    Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .is_some_and(|e| TEXT_EXTENSIONS.contains(&e.as_str()))
}

fn human_size(size: u64) -> String {
    if size < 1024 {
        format!("{size} B")
    } else if size < 1024 * 1024 {
        format!("{:.1} KB", size as f64 / 1024.0)
    } else {
        format!("{:.1} MB", size as f64 / (1024.0 * 1024.0))
    }
}

/// The channel's context folder, or `None` when it does not exist.
fn list_files(dir: &Path) -> Option<Vec<ContextFile>> {
    let entries = std::fs::read_dir(dir).ok()?;
    let mut files: Vec<ContextFile> = entries
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
            Some(ContextFile {
                path: entry.path().to_string_lossy().into_owned(),
                name,
                size: meta.len(),
            })
        })
        .collect();
    files.sort_by(|a, b| a.name.cmp(&b.name));
    Some(files)
}

/// Render the `<channel-context>` section for `channel_id`, or `None` when
/// the channel has no context folder or the folder is empty.
pub fn render_section(root: &Path, channel_id: Uuid) -> Option<String> {
    let dir = root.join(channel_id.to_string());
    let files = list_files(&dir)?;
    if files.is_empty() {
        return None;
    }
    let mut inlined = String::new();
    let mut listed: Vec<String> = Vec::new();
    let mut budget = INLINE_TOTAL_BUDGET;
    let total = files.len();
    for file in files.iter().take(MAX_LISTED_FILES) {
        let size = usize::try_from(file.size).unwrap_or(usize::MAX);
        let inline = is_text_name(&file.name)
            && size <= INLINE_FILE_MAX
            && size <= budget
            && std::fs::read(&file.path)
                .ok()
                .and_then(|bytes| String::from_utf8(bytes).ok())
                .map(|text| {
                    budget = budget.saturating_sub(size);
                    inlined.push_str(&format!(
                        "\n### {} ({})\n```\n{}\n```\n",
                        file.name,
                        human_size(file.size),
                        text.trim_end()
                    ));
                })
                .is_some();
        if !inline {
            listed.push(format!(
                "- {} ({}) — {}",
                file.name,
                human_size(file.size),
                file.path
            ));
        }
    }
    if total > MAX_LISTED_FILES {
        listed.push(format!(
            "- … and {} more files in the folder",
            total - MAX_LISTED_FILES
        ));
    }
    let mut body = format!(
        "Reference material the owner attached to this channel ({} file{}). Small text files are \
         included below; read the others from their paths when they matter to the task.\nFolder: {}",
        total,
        if total == 1 { "" } else { "s" },
        dir.to_string_lossy()
    );
    if !inlined.is_empty() {
        body.push('\n');
        body.push_str(&inlined);
    }
    if !listed.is_empty() {
        body.push_str("\nOther files:\n");
        body.push_str(&listed.join("\n"));
    }
    Some(crate::prompt_framing::semantic_section(
        "channel-context",
        body.trim_end(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(channel: Uuid) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("buzz-acp-ctx-{}", Uuid::new_v4()));
        std::fs::create_dir_all(root.join(channel.to_string())).unwrap();
        root
    }

    #[test]
    fn missing_or_empty_folder_renders_nothing() {
        let channel = Uuid::new_v4();
        let root = std::env::temp_dir().join(format!("buzz-acp-ctx-none-{}", Uuid::new_v4()));
        assert_eq!(render_section(&root, channel), None);
        let root = scratch(channel);
        assert_eq!(render_section(&root, channel), None);
    }

    #[test]
    fn small_text_is_inlined_and_binaries_are_listed_with_paths() {
        let channel = Uuid::new_v4();
        let root = scratch(channel);
        let dir = root.join(channel.to_string());
        std::fs::write(dir.join("spec.md"), "# Spec\n\nDo the thing.\n").unwrap();
        std::fs::write(dir.join("photo.png"), [0x89, b'P', b'N', b'G', 0, 0]).unwrap();
        std::fs::write(dir.join(".DS_Store"), b"x").unwrap();
        let section = render_section(&root, channel).unwrap();
        assert!(section.starts_with("<channel-context>\n"), "{section}");
        assert!(
            section.contains("### spec.md (22 B)\n```\n# Spec\n\nDo the thing.\n```"),
            "{section}"
        );
        assert!(
            section.contains("Other files:\n- photo.png (6 B) — "),
            "{section}"
        );
        assert!(section.contains(&dir.join("photo.png").to_string_lossy().to_string()));
        assert!(!section.contains(".DS_Store"));
        assert!(section.contains("(2 files)"), "{section}");
    }

    #[test]
    fn inline_budget_is_bounded_and_overflow_falls_back_to_the_list() {
        let channel = Uuid::new_v4();
        let root = scratch(channel);
        let dir = root.join(channel.to_string());
        std::fs::write(dir.join("a.txt"), "a".repeat(INLINE_FILE_MAX)).unwrap();
        std::fs::write(dir.join("b.txt"), "b".repeat(INLINE_FILE_MAX)).unwrap();
        std::fs::write(dir.join("c.txt"), "c".repeat(INLINE_FILE_MAX)).unwrap();
        std::fs::write(dir.join("huge.md"), "h".repeat(INLINE_FILE_MAX + 1)).unwrap();
        std::fs::write(dir.join("bin.txt"), [0xff, 0xfe, 0x00]).unwrap();
        let section = render_section(&root, channel).unwrap();
        // a + b fill the 32 KB budget; c, the oversized file and the
        // non-UTF-8 "text" file are listed instead.
        assert!(section.contains("### a.txt"));
        assert!(section.contains("### b.txt"));
        assert!(!section.contains("### c.txt"));
        assert!(section.contains("- c.txt (16.0 KB)"), "{section}");
        assert!(section.contains("- huge.md (16.0 KB)"), "{section}");
        assert!(section.contains("- bin.txt (3 B)"), "{section}");
        assert!(section.len() < INLINE_TOTAL_BUDGET + 4096);
    }
}
