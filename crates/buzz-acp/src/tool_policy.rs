//! Owner-configured tool policy for a managed agent: Claude Code permission
//! rules (`Write`, `Bash(git push:*)`, `Edit(src/**)`) carried in
//! `BUZZ_ACP_TOOL_POLICY` as JSON `{"allow":[…],"deny":[…]}`.
//!
//! Two enforcement layers, both fed from the same rules:
//!
//! 1. **Native** — the rules ride into `session/new` as
//!    `_meta.claudeCode.options.settings.permissions`, so Claude Code applies
//!    them itself (its own matcher, all tools, deny before allow).
//! 2. **Harness seam** — every `session/request_permission` that reaches the
//!    harness is checked against the deny rules before the usual auto-approve
//!    ([`ToolPolicy::decide_prompt`]). This is the backstop for adapters that
//!    ignore the meta and for prompts Claude Code forwards regardless.
//!
//! The seam sees no tool name — only the ACP `title`, `kind` and `rawInput` —
//! so it matches the tools whose input shape identifies them (Bash, the
//! file-editing tools, WebFetch/WebSearch); anything else is left to the
//! native layer.

use serde::{Deserialize, Serialize};

/// Allow/deny rules in Claude Code's `Tool` / `Tool(specifier)` syntax.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolPolicy {
    #[serde(default)]
    pub allow: Vec<String>,
    #[serde(default)]
    pub deny: Vec<String>,
}

/// Outcome of matching a permission prompt against the policy.
#[derive(Debug, PartialEq, Eq)]
pub enum PromptDecision {
    /// A deny rule matched; carries the rule for the log line.
    Deny(String),
    /// An allow rule matched (no deny did).
    Allow(String),
    /// No rule speaks to this prompt.
    NoMatch,
}

impl ToolPolicy {
    /// Parse the env value. Blank → empty policy. Every rule must be a tool
    /// name (`[A-Za-z0-9_-]+`, MCP names like `mcp__server__tool` included)
    /// optionally followed by one `(specifier)` group.
    pub fn parse(raw: &str) -> Result<Self, String> {
        if raw.trim().is_empty() {
            return Ok(Self::default());
        }
        let policy: Self = serde_json::from_str(raw).map_err(|e| {
            format!("tool policy is not valid JSON ({e}); expected {{\"allow\":[…],\"deny\":[…]}}")
        })?;
        for rule in policy.allow.iter().chain(policy.deny.iter()) {
            parse_rule(rule).ok_or_else(|| format!("invalid tool policy rule {rule:?}"))?;
        }
        Ok(policy)
    }

    pub fn is_empty(&self) -> bool {
        self.allow.is_empty() && self.deny.is_empty()
    }

    /// The `settings` object for `_meta.claudeCode.options` — Claude Code's own
    /// `permissions` block, so the rules are enforced natively.
    pub fn claude_settings(&self) -> serde_json::Value {
        serde_json::json!({
            "permissions": {
                "allow": self.allow,
                "deny": self.deny,
            }
        })
    }

    /// Match a permission prompt. Deny rules win over allow rules.
    pub fn decide_prompt(
        &self,
        title: &str,
        kind: &str,
        raw_input: Option<&serde_json::Value>,
    ) -> PromptDecision {
        let prompt = Prompt {
            title,
            kind,
            raw_input,
        };
        if let Some(rule) = self.deny.iter().find(|rule| rule_matches(rule, &prompt)) {
            return PromptDecision::Deny(rule.clone());
        }
        if let Some(rule) = self.allow.iter().find(|rule| rule_matches(rule, &prompt)) {
            return PromptDecision::Allow(rule.clone());
        }
        PromptDecision::NoMatch
    }
}

struct Prompt<'a> {
    title: &'a str,
    kind: &'a str,
    raw_input: Option<&'a serde_json::Value>,
}

impl Prompt<'_> {
    fn input_str(&self, key: &str) -> Option<&str> {
        self.raw_input?.get(key)?.as_str()
    }
    fn has_input(&self, key: &str) -> bool {
        self.raw_input.is_some_and(|raw| raw.get(key).is_some())
    }
}

/// Split `Tool(spec)` into `(tool, Some(spec))`, `Tool` into `(tool, None)`.
fn parse_rule(rule: &str) -> Option<(&str, Option<&str>)> {
    let rule = rule.trim();
    let (name, spec) = match rule.split_once('(') {
        Some((name, rest)) => (name, Some(rest.strip_suffix(')')?)),
        None => (rule, None),
    };
    if name.is_empty()
        || !name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return None;
    }
    Some((name, spec))
}

fn rule_matches(rule: &str, prompt: &Prompt<'_>) -> bool {
    let Some((tool, spec)) = parse_rule(rule) else {
        return false;
    };
    let by_shape = match tool {
        "Bash" => {
            let Some(command) = prompt.input_str("command") else {
                return false;
            };
            match spec {
                None | Some("*") => true,
                Some(spec) => match spec.strip_suffix(":*") {
                    Some(prefix) => command.trim_start().starts_with(prefix.trim_end()),
                    None => command.trim() == spec.trim(),
                },
            }
        }
        "Write" | "Edit" | "MultiEdit" | "NotebookEdit" => {
            // Identify the tool from its input shape. The adapter marks every
            // file mutation `kind: "edit"`; one with a path but an unrecognized
            // shape still counts for a bare file rule, so a newer tool schema
            // fails closed rather than slipping past a `Write`/`Edit` deny.
            let shape = if prompt.has_input("notebook_path") {
                Some("NotebookEdit")
            } else if !prompt.has_input("file_path") {
                None
            } else if prompt.has_input("old_string") {
                Some("Edit")
            } else if prompt.has_input("edits") {
                Some("MultiEdit")
            } else if prompt.has_input("content") {
                Some("Write")
            } else {
                None
            };
            let unrecognized_edit = shape.is_none()
                && prompt.kind == "edit"
                && (prompt.has_input("file_path") || prompt.has_input("notebook_path"));
            if !(shape == Some(tool) || (spec.is_none() && unrecognized_edit)) {
                return false;
            }
            match spec {
                None => true,
                Some(pattern) => prompt
                    .input_str("file_path")
                    .or_else(|| prompt.input_str("notebook_path"))
                    .is_some_and(|path| path_matches(pattern, path)),
            }
        }
        "WebFetch" => {
            let Some(url) = prompt.input_str("url") else {
                return false;
            };
            match spec.and_then(|s| s.strip_prefix("domain:")) {
                None => spec.is_none(),
                Some(domain) => url_host(url)
                    .is_some_and(|host| host == domain || host.ends_with(&format!(".{domain}"))),
            }
        }
        "WebSearch" => spec.is_none() && prompt.kind == "search" && prompt.has_input("query"),
        _ => false,
    };
    by_shape || title_is_tool(prompt.title, tool, spec)
}

/// Fallback identification by the adapter's title when the input shape did
/// not identify the tool: a bare rule (no specifier) matches a prompt whose
/// title is exactly the tool name (e.g. `"Write"`, `"WebSearch"`).
fn title_is_tool(title: &str, tool: &str, spec: Option<&str>) -> bool {
    spec.is_none() && title.trim() == tool
}

fn url_host(url: &str) -> Option<&str> {
    let rest = url.split_once("://").map(|(_, r)| r).unwrap_or(url);
    let host = rest.split(['/', '?', '#']).next()?;
    let host = host.rsplit('@').next()?;
    let host = host.split(':').next()?;
    (!host.is_empty()).then_some(host)
}

/// gitignore-flavoured glob: `*` matches within one path segment, `**` across
/// segments, `?` one character. A leading `~/` expands to `$HOME/`. A pattern
/// without a slash matches the basename; one with a slash matches the path
/// (relative patterns also match as a suffix of an absolute path).
fn path_matches(pattern: &str, path: &str) -> bool {
    let pattern = match pattern.strip_prefix("~/") {
        Some(rest) => match std::env::var("HOME") {
            Ok(home) => format!("{}/{rest}", home.trim_end_matches('/')),
            Err(_) => return false,
        },
        None => pattern.to_string(),
    };
    if !pattern.contains('/') {
        let base = path.rsplit('/').next().unwrap_or(path);
        return glob_match(&pattern, base);
    }
    if glob_match(&pattern, path) {
        return true;
    }
    // `src/**` against `/abs/repo/src/x.rs`: match on any segment boundary.
    !pattern.starts_with('/')
        && path
            .match_indices('/')
            .any(|(i, _)| glob_match(&pattern, &path[i + 1..]))
}

fn glob_match(pattern: &str, text: &str) -> bool {
    fn go(p: &[char], t: &[char]) -> bool {
        match p.split_first() {
            None => t.is_empty(),
            Some(('*', rest)) if rest.first() == Some(&'*') => {
                // `**`: swallow any run of characters, slashes included; an
                // immediately following `/` is optional.
                let rest = &rest[1..];
                let rest = rest.strip_prefix(&['/']).unwrap_or(rest);
                (0..=t.len()).any(|i| go(rest, &t[i..]))
            }
            Some(('*', rest)) => (0..=t.len())
                .take_while(|&i| i == 0 || t[i - 1] != '/')
                .any(|i| go(rest, &t[i..])),
            Some(('?', rest)) => t.first().is_some_and(|c| *c != '/') && go(rest, &t[1..]),
            Some((c, rest)) => t.first() == Some(c) && go(rest, &t[1..]),
        }
    }
    let p: Vec<char> = pattern.chars().collect();
    let t: Vec<char> = text.chars().collect();
    go(&p, &t)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bash(command: &str) -> serde_json::Value {
        serde_json::json!({"command": command})
    }

    #[test]
    fn parse_accepts_json_rules_and_rejects_garbage() {
        assert_eq!(ToolPolicy::parse("  ").unwrap(), ToolPolicy::default());
        let policy = ToolPolicy::parse(
            r#"{"deny":["Write","Bash(git push:*)"],"allow":["Bash(pnpm test:*)"]}"#,
        )
        .unwrap();
        assert_eq!(policy.deny, vec!["Write", "Bash(git push:*)"]);
        assert_eq!(policy.allow, vec!["Bash(pnpm test:*)"]);
        assert!(ToolPolicy::parse("Write").is_err());
        assert!(ToolPolicy::parse(r#"{"deny":["Bash(unclosed"]}"#).is_err());
        assert!(ToolPolicy::parse(r#"{"deny":["rm -rf"]}"#).is_err());
        assert!(ToolPolicy::parse(r#"{"deny":["mcp__github__push"]}"#).is_ok());
    }

    #[test]
    fn claude_settings_is_the_native_permissions_block() {
        let policy = ToolPolicy::parse(r#"{"deny":["Write"]}"#).unwrap();
        assert_eq!(
            policy.claude_settings(),
            serde_json::json!({"permissions": {"allow": [], "deny": ["Write"]}})
        );
    }

    #[test]
    fn bash_rules_match_prefix_or_exact_command() {
        let policy = ToolPolicy::parse(
            r#"{"deny":["Bash(git push:*)","Bash(rm -rf /)"],"allow":["Bash(pnpm test:*)"]}"#,
        )
        .unwrap();
        assert_eq!(
            policy.decide_prompt("Bash", "execute", Some(&bash("git push origin main"))),
            PromptDecision::Deny("Bash(git push:*)".into())
        );
        assert_eq!(
            policy.decide_prompt("Bash", "execute", Some(&bash("rm -rf /"))),
            PromptDecision::Deny("Bash(rm -rf /)".into())
        );
        assert_eq!(
            policy.decide_prompt("Bash", "execute", Some(&bash("rm -rf /tmp/x"))),
            PromptDecision::NoMatch
        );
        assert_eq!(
            policy.decide_prompt("Bash", "execute", Some(&bash("pnpm test:unit"))),
            PromptDecision::Allow("Bash(pnpm test:*)".into())
        );
        // A bare `Bash` rule covers every shell command; a Write is not a Bash.
        let no_shell = ToolPolicy::parse(r#"{"deny":["Bash"]}"#).unwrap();
        assert_eq!(
            no_shell.decide_prompt("Bash", "execute", Some(&bash("ls"))),
            PromptDecision::Deny("Bash".into())
        );
        let write = serde_json::json!({"file_path": "/x/a.md", "content": "hi"});
        assert_eq!(
            no_shell.decide_prompt("Write", "edit", Some(&write)),
            PromptDecision::NoMatch
        );
    }

    #[test]
    fn file_rules_match_by_input_shape_and_path_glob() {
        let policy = ToolPolicy::parse(r#"{"deny":["Write","Edit(src/**)"]}"#).unwrap();
        let write = serde_json::json!({"file_path": "/repo/docs/a.md", "content": "hi"});
        let edit_src = serde_json::json!({"file_path": "/repo/src/lib.rs", "old_string": "a", "new_string": "b"});
        let edit_docs = serde_json::json!({"file_path": "/repo/docs/a.md", "old_string": "a", "new_string": "b"});
        assert_eq!(
            policy.decide_prompt("Write", "edit", Some(&write)),
            PromptDecision::Deny("Write".into())
        );
        assert_eq!(
            policy.decide_prompt("Edit", "edit", Some(&edit_src)),
            PromptDecision::Deny("Edit(src/**)".into())
        );
        assert_eq!(
            policy.decide_prompt("Edit", "edit", Some(&edit_docs)),
            PromptDecision::NoMatch
        );
        // Deny wins over allow.
        let both = ToolPolicy::parse(r#"{"allow":["Write"],"deny":["Write(*.md)"]}"#).unwrap();
        assert_eq!(
            both.decide_prompt("Write", "edit", Some(&write)),
            PromptDecision::Deny("Write(*.md)".into())
        );
        let rs = serde_json::json!({"file_path": "/repo/a.rs", "content": "x"});
        assert_eq!(
            both.decide_prompt("Write", "edit", Some(&rs)),
            PromptDecision::Allow("Write".into())
        );
        // An unrecognized edit-shaped prompt still trips a bare rule (fails closed).
        let odd = serde_json::json!({"file_path": "/repo/a.rs", "patch": "…"});
        assert_eq!(
            policy.decide_prompt("Patch", "edit", Some(&odd)),
            PromptDecision::Deny("Write".into())
        );
    }

    #[test]
    fn web_rules_match_domain_and_search() {
        let policy =
            ToolPolicy::parse(r#"{"deny":["WebFetch(domain:example.com)","WebSearch"]}"#).unwrap();
        let fetch = |url: &str| serde_json::json!({"url": url});
        assert_eq!(
            policy.decide_prompt("Fetch", "fetch", Some(&fetch("https://api.example.com/x"))),
            PromptDecision::Deny("WebFetch(domain:example.com)".into())
        );
        assert_eq!(
            policy.decide_prompt("Fetch", "fetch", Some(&fetch("https://example.org/"))),
            PromptDecision::NoMatch
        );
        let search = serde_json::json!({"query": "rust glob"});
        assert_eq!(
            policy.decide_prompt("Search", "search", Some(&search)),
            PromptDecision::Deny("WebSearch".into())
        );
    }

    #[test]
    fn unknown_tools_are_left_to_the_native_layer_unless_the_title_names_them() {
        let policy = ToolPolicy::parse(r#"{"deny":["Read","Task"]}"#).unwrap();
        let read = serde_json::json!({"file_path": "/x"});
        assert_eq!(
            policy.decide_prompt("Read /x", "read", Some(&read)),
            PromptDecision::NoMatch
        );
        assert_eq!(
            policy.decide_prompt("Task", "other", None),
            PromptDecision::Deny("Task".into())
        );
    }

    #[test]
    fn glob_semantics() {
        assert!(glob_match("*.md", "a.md"));
        assert!(!glob_match("*.md", "dir/a.md"));
        assert!(glob_match("src/**", "src/a/b.rs"));
        assert!(glob_match("src/**/*.rs", "src/a/b.rs"));
        assert!(glob_match("src/**/*.rs", "src/b.rs"));
        assert!(!glob_match("src/*.rs", "src/a/b.rs"));
        assert!(glob_match("a?c", "abc"));
        assert!(path_matches("src/**", "/repo/src/x.rs"));
        assert!(!path_matches("/src/**", "/repo/src/x.rs"));
        assert!(path_matches("*.md", "/any/where/a.md"));
        assert!(path_matches("/repo/docs/**", "/repo/docs/a/b.md"));
    }
}
