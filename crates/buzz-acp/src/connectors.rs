//! Owner Connectors: extra MCP servers the Desktop attaches to an agent's
//! persona and hands to the harness as JSON in `BUZZ_ACP_MCP_SERVERS`. They
//! are appended to every `session/new` after the built-in dev MCP server.
//!
//! Each entry is either a local process (`kind: "stdio"`) or an HTTP server
//! (`kind: "http"`). Entries are validated one at a time: a bad one is
//! reported and dropped, the rest still load, and the session still starts.

use std::collections::{BTreeMap, HashSet};

use crate::acp::{EnvVar, McpServer, McpServerHttp, McpServerSpec};

/// One connector as the Desktop serializes it (`lib/agentConnectors.ts`).
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub(crate) enum ConnectorSpec {
    Stdio {
        name: String,
        command: String,
        #[serde(default)]
        args: Vec<String>,
        #[serde(default)]
        env: BTreeMap<String, String>,
    },
    Http {
        name: String,
        url: String,
        #[serde(default)]
        headers: BTreeMap<String, String>,
    },
}

/// What [`parse_connectors`] produced: the servers to send and one warning
/// per entry it had to drop.
#[derive(Debug, Default)]
pub(crate) struct ParsedConnectors {
    pub servers: Vec<McpServerSpec>,
    pub warnings: Vec<String>,
}

/// Whether the adapter can take an HTTP MCP server from `session/new`.
/// buzz-agent's own registry spawns processes only; claude-agent-acp and
/// codex-acp both accept `type: "http"`.
pub(crate) fn http_supported(agent_command: &str) -> bool {
    crate::config::normalize_agent_command_identity(agent_command) != "buzz-agent"
}

/// Parse the `BUZZ_ACP_MCP_SERVERS` JSON. `reserved_name` is the built-in
/// server's name, which a connector may not shadow.
pub(crate) fn parse_connectors(
    json: &str,
    reserved_name: Option<&str>,
    http_supported: bool,
) -> ParsedConnectors {
    let mut out = ParsedConnectors::default();
    if json.trim().is_empty() {
        return out;
    }
    let entries: Vec<serde_json::Value> = match serde_json::from_str(json) {
        Ok(serde_json::Value::Array(entries)) => entries,
        Ok(_) => {
            out.warnings
                .push("BUZZ_ACP_MCP_SERVERS must be a JSON array".to_string());
            return out;
        }
        Err(e) => {
            out.warnings
                .push(format!("BUZZ_ACP_MCP_SERVERS is not valid JSON: {e}"));
            return out;
        }
    };
    let mut seen: HashSet<String> = HashSet::new();
    for (index, entry) in entries.into_iter().enumerate() {
        let spec: ConnectorSpec = match serde_json::from_value(entry) {
            Ok(spec) => spec,
            Err(e) => {
                out.warnings.push(format!("connector #{}: {e}", index + 1));
                continue;
            }
        };
        let name = spec_name(&spec).trim().to_string();
        if let Err(reason) = validate_name(&name, reserved_name) {
            out.warnings
                .push(format!("connector #{}: {reason}", index + 1));
            continue;
        }
        if !seen.insert(name.clone()) {
            out.warnings.push(format!(
                "connector {name:?}: duplicate name, later entry skipped"
            ));
            continue;
        }
        match spec {
            ConnectorSpec::Stdio {
                command, args, env, ..
            } => {
                if command.trim().is_empty() {
                    out.warnings
                        .push(format!("connector {name:?}: command is empty"));
                    continue;
                }
                out.servers.push(McpServerSpec::Stdio(McpServer {
                    name,
                    command: command.trim().to_string(),
                    args,
                    env: pairs(env),
                }));
            }
            ConnectorSpec::Http { url, headers, .. } => {
                let url = url.trim().to_string();
                if !(url.starts_with("http://") || url.starts_with("https://")) {
                    out.warnings.push(format!(
                        "connector {name:?}: url must start with http:// or https://"
                    ));
                    continue;
                }
                if !http_supported {
                    out.warnings.push(format!(
                        "connector {name:?}: this harness takes local (stdio) connectors only"
                    ));
                    continue;
                }
                out.servers.push(McpServerSpec::Http(McpServerHttp::new(
                    name,
                    url,
                    pairs(headers),
                )));
            }
        }
    }
    out
}

fn spec_name(spec: &ConnectorSpec) -> &str {
    match spec {
        ConnectorSpec::Stdio { name, .. } | ConnectorSpec::Http { name, .. } => name,
    }
}

/// Names must be safe as adapter tool prefixes: ASCII letters, digits, `_`,
/// `-`, `.`; no `__` (buzz-agent's tool separator); at most 64 chars; and
/// never the built-in server's name.
fn validate_name(name: &str, reserved_name: Option<&str>) -> Result<(), String> {
    if name.is_empty() {
        return Err("name is empty".to_string());
    }
    if name.len() > 64 {
        return Err(format!("name {name:?} is longer than 64 characters"));
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
    {
        return Err(format!(
            "name {name:?} may only use letters, digits, '_', '-' and '.'"
        ));
    }
    if name.contains("__") {
        return Err(format!("name {name:?} may not contain '__'"));
    }
    if reserved_name.is_some_and(|reserved| reserved == name) {
        return Err(format!("name {name:?} is reserved for the built-in server"));
    }
    Ok(())
}

fn pairs(map: BTreeMap<String, String>) -> Vec<EnvVar> {
    map.into_iter()
        .filter(|(name, _)| !name.trim().is_empty())
        .map(|(name, value)| EnvVar {
            name: name.trim().to_string(),
            value,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blank_and_invalid_input_produce_no_servers() {
        assert!(parse_connectors("", None, true).servers.is_empty());
        assert!(parse_connectors("   ", None, true).warnings.is_empty());
        let bad = parse_connectors("{not json", None, true);
        assert!(bad.servers.is_empty());
        assert_eq!(bad.warnings.len(), 1);
        let obj = parse_connectors("{}", None, true);
        assert!(obj.warnings[0].contains("JSON array"));
    }

    #[test]
    fn stdio_and_http_connectors_serialize_to_the_acp_shapes() {
        let json = r#"[
          {"kind":"stdio","name":"github","command":"npx","args":["-y","server-github"],"env":{"GITHUB_TOKEN":"t"}},
          {"kind":"http","name":"linear","url":"https://mcp.linear.app/mcp","headers":{"Authorization":"Bearer x"}}
        ]"#;
        let parsed = parse_connectors(json, Some("buzz-dev-mcp"), true);
        assert!(parsed.warnings.is_empty(), "{:?}", parsed.warnings);
        assert_eq!(parsed.servers.len(), 2);
        let wire = serde_json::to_value(&parsed.servers).unwrap();
        assert_eq!(wire[0]["name"], "github");
        assert_eq!(wire[0]["command"], "npx");
        assert_eq!(wire[0]["args"][1], "server-github");
        assert_eq!(wire[0]["env"][0]["name"], "GITHUB_TOKEN");
        assert!(wire[0].get("type").is_none(), "stdio stays untagged");
        assert_eq!(wire[1]["type"], "http");
        assert_eq!(wire[1]["url"], "https://mcp.linear.app/mcp");
        assert_eq!(wire[1]["headers"][0]["value"], "Bearer x");
    }

    #[test]
    fn bad_entries_are_dropped_one_at_a_time_with_a_reason() {
        let json = r#"[
          {"kind":"stdio","name":"buzz-dev-mcp","command":"evil"},
          {"kind":"stdio","name":"a__b","command":"x"},
          {"kind":"stdio","name":"ok","command":"x"},
          {"kind":"stdio","name":"ok","command":"y"},
          {"kind":"stdio","name":"blank","command":"  "},
          {"kind":"http","name":"nourl","url":"ftp://x"},
          {"kind":"sse","name":"unknown","url":"https://x"},
          {"kind":"http","name":"remote","url":"https://x/mcp"}
        ]"#;
        let parsed = parse_connectors(json, Some("buzz-dev-mcp"), true);
        let names: Vec<&str> = parsed.servers.iter().map(McpServerSpec::name).collect();
        assert_eq!(names, vec!["ok", "remote"]);
        assert_eq!(parsed.warnings.len(), 6, "{:?}", parsed.warnings);
        assert!(parsed.warnings[0].contains("reserved"));
        assert!(parsed.warnings[1].contains("'__'"));
        assert!(parsed.warnings[2].contains("duplicate"));
    }

    #[test]
    fn http_connectors_are_skipped_for_stdio_only_harnesses() {
        let json = r#"[{"kind":"http","name":"remote","url":"https://x/mcp"}]"#;
        let parsed = parse_connectors(json, None, false);
        assert!(parsed.servers.is_empty());
        assert!(parsed.warnings[0].contains("stdio"));
        assert!(!http_supported("buzz-agent"));
        assert!(http_supported("claude-agent-acp"));
        assert!(http_supported("codex-acp"));
    }
}
