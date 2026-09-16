//! ACP URL elicitation: how an adapter asks the owner to finish a sign-in in
//! the browser — today, OAuth for an HTTP MCP connector. claude-agent-acp
//! and codex-acp only start the flow when the client advertises
//! `clientCapabilities.elicitation.url`; the adapter owns the localhost
//! callback, so the harness's whole job is to put the URL in front of the
//! owner and acknowledge the round trip:
//!
//! 1. `elicitation/create` (`mode: "url"`) → reply `{action: "accept"}` at
//!    once (the owner will open the link) and post the URL to the session's
//!    channel as the agent.
//! 2. `elicitation/complete` → reply `{}` and post a short confirmation.
//!
//! Posting goes through a process-wide [`RestClient`] installed at startup
//! so the read loop, which has no pool context, can reach the relay.

use std::collections::HashMap;
use std::sync::OnceLock;

use uuid::Uuid;

use crate::relay::RestClient;

static POSTER: OnceLock<RestClient> = OnceLock::new();

/// Install the relay client used to post sign-in notices. First call wins.
pub(crate) fn install(rest: RestClient) {
    let _ = POSTER.set(rest);
}

/// Per-client memory of elicitations in flight, keyed by `elicitationId`,
/// so the completion notice can name what was signed in to.
#[derive(Debug, Default)]
pub(crate) struct ElicitationLog {
    labels: HashMap<String, PendingElicitation>,
}

#[derive(Debug, Clone)]
pub(crate) struct PendingElicitation {
    pub channel_id: Option<Uuid>,
    pub message: String,
}

impl ElicitationLog {
    pub(crate) fn begin(&mut self, id: &str, pending: PendingElicitation) {
        self.labels.insert(id.to_string(), pending);
    }

    pub(crate) fn finish(&mut self, id: &str) -> Option<PendingElicitation> {
        self.labels.remove(id)
    }
}

/// The channel post for a new sign-in request. Markdown: the Desktop opens
/// the link in the system browser.
pub(crate) fn sign_in_notice(message: &str, url: &str) -> String {
    let what = message.trim();
    let what = if what.is_empty() {
        "Sign-in needed"
    } else {
        what
    };
    format!(
        "🔐 **{what}**\n\nOpen this link and finish signing in — I'll continue as soon as it completes:\n{url}"
    )
}

/// The channel post once the adapter reports the sign-in finished.
pub(crate) fn signed_in_notice(message: &str) -> String {
    let what = message.trim();
    if what.is_empty() {
        "✅ Signed in.".to_string()
    } else {
        format!("✅ Done: {what}")
    }
}

/// Post `content` to `channel_id` as the agent; a missing channel or poster
/// only logs, since the URL is also in the harness log.
pub(crate) async fn post(channel_id: Option<Uuid>, content: &str, label: &str) {
    match (POSTER.get(), channel_id) {
        (Some(rest), Some(channel_id)) => {
            crate::pool::post_agent_message(
                rest,
                channel_id,
                &crate::queue::ThreadTags::default(),
                content,
                label,
            )
            .await;
        }
        (None, _) => tracing::warn!("{label}: no relay client installed; not posted"),
        (_, None) => tracing::warn!("{label}: session has no channel; not posted"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notices_carry_the_adapter_message_and_the_url() {
        let text = sign_in_notice("Authenticate with MCP server linear", "https://x/auth?s=1");
        assert!(text.contains("**Authenticate with MCP server linear**"));
        assert!(text.ends_with("https://x/auth?s=1"));
        assert!(sign_in_notice("  ", "https://x").contains("**Sign-in needed**"));
        assert_eq!(signed_in_notice(""), "✅ Signed in.");
        assert_eq!(
            signed_in_notice("Authenticate with MCP server linear"),
            "✅ Done: Authenticate with MCP server linear"
        );
    }

    #[test]
    fn log_remembers_an_elicitation_until_it_completes() {
        let mut log = ElicitationLog::default();
        assert!(log.finish("x").is_none());
        log.begin(
            "x",
            PendingElicitation {
                channel_id: None,
                message: "m".into(),
            },
        );
        assert_eq!(log.finish("x").map(|p| p.message), Some("m".to_string()));
        assert!(log.finish("x").is_none());
    }
}
