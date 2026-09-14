//! API-key connections. The Desktop's Connection field (`lib/agentConnection.ts`)
//! sets `BUZZ_AGENT_CONNECTION=api-key` plus the runtime's key variable on the
//! agent env. Runtimes whose CLI would still prefer its own login over the
//! key (Codex keeps ChatGPT auth in `$CODEX_HOME/auth.json` and uses it first)
//! run in an isolated home under the nest that no login ever touched, so the
//! key is the only credential the CLI can find.

use std::path::{Path, PathBuf};

pub(crate) const CONNECTION_ENV_KEY: &str = "BUZZ_AGENT_CONNECTION";
const API_KEY_MARKER: &str = "api-key";

/// `(env var, home dir)` the spawn must set for an API-key connection on
/// `runtime_id`, or `None` when the runtime honours the key as is (Claude) or
/// is unknown.
pub(crate) fn api_key_home_for(
    runtime_id: Option<&str>,
    nest: &Path,
) -> Option<(&'static str, PathBuf)> {
    match runtime_id {
        Some("codex") => Some(("CODEX_HOME", nest.join("homes").join("codex-api"))),
        _ => None,
    }
}

/// True when the agent env asks for the API-key connection.
pub(crate) fn wants_api_key(env: &std::collections::BTreeMap<String, String>) -> bool {
    env.get(CONNECTION_ENV_KEY)
        .map(|v| v.trim().eq_ignore_ascii_case(API_KEY_MARKER))
        .unwrap_or(false)
}

/// The env var that carries the key for an API-key connection on
/// `runtime_id` — mirrors `AGENT_CONNECTION_CATALOG` in
/// `lib/agentConnection.ts`. `None` for runtimes without an API-key option.
pub(crate) fn api_key_env_var(runtime_id: &str) -> Option<&'static str> {
    match runtime_id {
        "claude" => Some("ANTHROPIC_API_KEY"),
        "codex" => Some("OPENAI_API_KEY"),
        _ => None,
    }
}

/// What an API-key connection on `runtime_id` has to say about readiness:
/// `None` when the agent uses the harness login (readiness must probe the
/// CLI as usual), otherwise the key var and whether the env carries a
/// non-empty value for it — an API-key agent never needs the CLI login.
pub(crate) fn api_key_state(
    env: &std::collections::BTreeMap<String, String>,
    runtime_id: &str,
) -> Option<ApiKeyState> {
    if !wants_api_key(env) {
        return None;
    }
    let key = api_key_env_var(runtime_id)?;
    let present = env.get(key).map(|v| !v.trim().is_empty()).unwrap_or(false);
    Some(ApiKeyState { key, present })
}

/// See [`api_key_state`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ApiKeyState {
    /// The env var the key lives in (e.g. `ANTHROPIC_API_KEY`).
    pub key: &'static str,
    /// Whether that var is set to a non-blank value.
    pub present: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_codex_needs_an_isolated_home_and_it_lives_under_the_nest() {
        let nest = Path::new("/nest");
        assert_eq!(
            api_key_home_for(Some("codex"), nest),
            Some(("CODEX_HOME", PathBuf::from("/nest/homes/codex-api")))
        );
        assert_eq!(api_key_home_for(Some("claude"), nest), None);
        assert_eq!(api_key_home_for(Some("goose"), nest), None);
        assert_eq!(api_key_home_for(None, nest), None);
    }

    #[test]
    fn api_key_state_is_none_for_subscription_and_for_runtimes_without_keys() {
        let mut env = std::collections::BTreeMap::new();
        env.insert("ANTHROPIC_API_KEY".to_string(), "sk-ant-test".to_string());
        assert_eq!(
            api_key_state(&env, "claude"),
            None,
            "no marker → login path"
        );
        env.insert(CONNECTION_ENV_KEY.to_string(), "api-key".to_string());
        assert_eq!(
            api_key_state(&env, "goose"),
            None,
            "goose has no API-key connection option"
        );
    }

    #[test]
    fn api_key_state_reports_whether_the_runtime_key_is_filled_in() {
        let mut env = std::collections::BTreeMap::new();
        env.insert(CONNECTION_ENV_KEY.to_string(), "api-key".to_string());
        assert_eq!(
            api_key_state(&env, "claude"),
            Some(ApiKeyState {
                key: "ANTHROPIC_API_KEY",
                present: false
            })
        );
        env.insert("ANTHROPIC_API_KEY".to_string(), "   ".to_string());
        assert_eq!(
            api_key_state(&env, "claude").map(|s| s.present),
            Some(false),
            "blank keys count as missing"
        );
        env.insert("OPENAI_API_KEY".to_string(), "sk-test".to_string());
        assert_eq!(
            api_key_state(&env, "codex"),
            Some(ApiKeyState {
                key: "OPENAI_API_KEY",
                present: true
            })
        );
    }

    #[test]
    fn wants_api_key_reads_the_marker_case_insensitively() {
        let mut env = std::collections::BTreeMap::new();
        assert!(!wants_api_key(&env));
        env.insert(CONNECTION_ENV_KEY.to_string(), " API-KEY ".to_string());
        assert!(wants_api_key(&env));
        env.insert(CONNECTION_ENV_KEY.to_string(), "subscription".to_string());
        assert!(!wants_api_key(&env));
    }
}
