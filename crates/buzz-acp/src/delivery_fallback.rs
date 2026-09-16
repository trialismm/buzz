//! Delivery fallback for silent human-facing turns.
//!
//! The harness never publishes the agent's prose on its own: an agent replies
//! by running `buzz messages send`, and the base prompt tells it that a human
//! who asked something MUST get a reply. Models do not always comply — a turn
//! can end with a perfectly good answer streamed as `agent_message_chunk`s and
//! nothing posted to the channel. The desktop's session panel still shows that
//! text, so to the human it looks like the agent answered while the channel
//! stays empty.
//!
//! This module closes that gap: when a turn that a human triggered (or that
//! mentions a human) ends with `end_turn`, the agent posted nothing in that
//! channel during the turn, and the streamed prose is non-empty, the harness
//! publishes the prose itself, to the same reply destination the prompt told
//! the agent to use. Agent↔agent turns and turns with no prose stay silent —
//! silence there is the prompt's stated default.
//!
//! "The agent posted nothing" must be *proven*, never assumed — a duplicate
//! reply is worse than the silent turn this module exists to fix. Three
//! signals, any one of which counts as the agent having replied:
//!
//! 1. A `tool_call` in the turn ran `buzz messages send` (the adapter puts the
//!    shell command in the tool-call title / `rawInput.command`).
//! 2. The harness saw its own event on the subscription ([`SelfPostLog`]). This
//!    is only populated when the subscription delivers self-authored events
//!    (not under mention-only subscriptions), so it is a bonus, not the basis.
//! 3. After [`DELIVERY_GRACE`], a relay query for kind-9 events by this agent in
//!    the channel since the turn started. This is the ground truth. If the
//!    query fails, the evidence is *unknown* and the fallback stays silent.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use uuid::Uuid;

use crate::queue::{
    parse_thread_tags, resolve_reply_anchor, turn_is_human_facing, FlushBatch, PromptChannelInfo,
    PromptProfileLookup, ThreadTags,
};

/// How long to wait after `end_turn` for the agent's own post to echo back
/// from the relay before treating the turn as silent.
pub const DELIVERY_GRACE: Duration = Duration::from_secs(5);
/// Upper bound on a fallback message; longer prose is cut at a char boundary.
pub const MAX_FALLBACK_CHARS: usize = 16_000;
/// Tolerance for the agent's post carrying a `created_at` slightly before the
/// harness stamped the turn start (same host, but two clocks read at two times).
const CLOCK_SKEW_SECS: u64 = 5;
const SELF_POST_LOG_CAP: usize = 512;
/// Bound on the post-turn relay check; a slow relay must not hold the loop.
const RELAY_CHECK_TIMEOUT: Duration = Duration::from_secs(3);
const TRUNCATION_NOTE: &str = "\n\n[… reply truncated]";

/// Where a human-facing reply for one turn must land, captured when the prompt
/// is rendered so the fallback uses exactly the destination the agent was told.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DeliveryProbe {
    pub channel_id: Uuid,
    /// DM replies stay flat (no thread tags), mirroring `format_prompt`.
    pub is_dm: bool,
    /// Sender is a human or a human is mentioned — the only turns where the
    /// prompt says a reply is mandatory.
    pub human_facing: bool,
    /// Pre-resolved `--reply-to` anchor for channel turns (thread root, or the
    /// triggering event that becomes the new root). `None` for DMs and
    /// agent↔agent turns.
    pub reply_anchor: Option<String>,
    /// Unix seconds when the turn was dispatched; self-posts at or after this
    /// (minus skew) count as the agent having replied.
    pub started_unix: u64,
}

/// Build the probe for the batch a prompt is being rendered from. Uses the same
/// helpers `format_prompt` uses for the `<context>` reply destination.
pub fn probe_for_batch(
    batch: &FlushBatch,
    channel_info: Option<&PromptChannelInfo>,
    profile_lookup: Option<&PromptProfileLookup>,
    started_unix: u64,
) -> Option<DeliveryProbe> {
    let last = batch.events.last()?;
    let thread_tags = parse_thread_tags(&last.event);
    let sender = last.event.pubkey.to_hex();
    let is_dm = channel_info.is_some_and(|ci| ci.channel_type == "dm");
    let human_facing = turn_is_human_facing(&sender, &thread_tags, profile_lookup);
    let reply_anchor = if is_dm {
        None
    } else {
        resolve_reply_anchor(
            &sender,
            &thread_tags,
            &last.event.id.to_hex(),
            profile_lookup,
        )
    };
    Some(DeliveryProbe {
        channel_id: batch.channel_id,
        is_dm,
        human_facing,
        reply_anchor,
        started_unix,
    })
}

/// Whether the agent itself got a message into the channel during the turn.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AgentPostEvidence {
    /// Proven: a `buzz messages send` tool call, a self-authored event on the
    /// subscription, or a relay query hit.
    Posted,
    /// Proven absent: the relay query ran and found nothing.
    NotPosted,
    /// Could not verify (relay query failed or timed out).
    Unknown,
}

/// Maintain the per-turn prose buffer from the ACP stream: `agent_message_chunk`
/// text is appended, and a `tool_call` discards everything before it — text
/// streamed ahead of a tool call is narration ("I'll respond…", "Now I'll
/// send…"), never the answer. What remains after the turn is the prose that
/// followed the last tool call, the closest thing to the reply the agent would
/// have sent.
pub fn track_turn_prose(turn_text: &mut String, update_type: &str, text: Option<&str>) {
    match update_type {
        "agent_message_chunk" => {
            if let Some(text) = text {
                turn_text.push_str(text);
            }
        }
        "tool_call" => turn_text.clear(),
        _ => {}
    }
}

/// Does this tool call deliver a message on the agent's behalf? The adapter
/// titles Bash calls with the command and mirrors it in `rawInput.command`.
pub fn tool_call_sends_message(title: &str, raw_input: Option<&serde_json::Value>) -> bool {
    let command = raw_input
        .and_then(|v| v.get("command"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    [title, command]
        .iter()
        .any(|text| text.contains("buzz messages send"))
}

/// The plan a Claude Code plan-mode turn wrote: the `content` of a Write
/// tool call targeting the plans directory (`~/.claude/plans/*.md`). Plan
/// mode never streams the plan as prose, so this is the only copy the
/// harness sees when `ExitPlanMode` is refused.
pub fn plan_file_content(raw_input: Option<&serde_json::Value>) -> Option<String> {
    let raw = raw_input?;
    let path = raw.get("file_path").and_then(|v| v.as_str())?;
    if !path.contains("/.claude/plans/") {
        return None;
    }
    let content = raw.get("content").and_then(|v| v.as_str())?;
    if content.trim().is_empty() {
        return None;
    }
    Some(content.to_string())
}

/// Text the fallback should publish for a silent turn: the streamed prose,
/// else the captured plan framed as such — a plan-mode turn that ends with a
/// refused `ExitPlanMode` has nothing else to say.
pub fn fallback_body(turn_text: &str, plan: Option<&str>) -> String {
    if !turn_text.trim().is_empty() {
        return turn_text.to_string();
    }
    match plan {
        Some(plan) if !plan.trim().is_empty() => format!(
            "**Plan** (plan mode — nothing was changed; re-send with another permission mode to execute it)\n\n{}",
            plan.trim()
        ),
        _ => String::new(),
    }
}

/// What to do once a turn has ended with `end_turn`.
#[derive(Debug, PartialEq, Eq)]
pub enum FallbackDecision {
    /// Publish this content to the probe's destination.
    Publish(String),
    /// Stay silent; the reason is for logs only.
    Skip(&'static str),
}

/// Pure decision: publish only for an enabled, human-facing turn whose prose is
/// non-blank and where nothing from the agent reached the channel.
pub fn decide(
    enabled: bool,
    probe: Option<&DeliveryProbe>,
    turn_text: &str,
    evidence: AgentPostEvidence,
) -> FallbackDecision {
    if !enabled {
        return FallbackDecision::Skip("disabled");
    }
    let Some(probe) = probe else {
        return FallbackDecision::Skip("no probe (heartbeat or missing batch)");
    };
    if !probe.human_facing {
        return FallbackDecision::Skip("agent-to-agent turn");
    }
    match evidence {
        AgentPostEvidence::Posted => {
            return FallbackDecision::Skip("agent already posted in channel");
        }
        AgentPostEvidence::Unknown => {
            return FallbackDecision::Skip("could not verify whether the agent posted");
        }
        AgentPostEvidence::NotPosted => {}
    }
    let trimmed = turn_text.trim();
    if trimmed.is_empty() {
        return FallbackDecision::Skip("no prose");
    }
    FallbackDecision::Publish(truncate_chars(trimmed, MAX_FALLBACK_CHARS))
}

/// Thread tags for the fallback message: flat in DMs, anchored to the resolved
/// reply root in channels (same place `--reply-to` would have put it).
pub fn fallback_thread_tags(probe: &DeliveryProbe) -> ThreadTags {
    match (probe.is_dm, probe.reply_anchor.as_ref()) {
        (false, Some(anchor)) => ThreadTags {
            root_event_id: Some(anchor.clone()),
            parent_event_id: Some(anchor.clone()),
            mentioned_pubkeys: Vec::new(),
        },
        _ => ThreadTags::default(),
    }
}

fn truncate_chars(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let mut out: String = text.chars().take(max_chars).collect();
    out.push_str(TRUNCATION_NOTE);
    out
}

/// Ground truth from the relay: did this agent publish a kind-9 message in
/// Tag the harness puts on notices it posts under the agent's key (sign-in
/// links, failure notices). Those are not the agent answering, so neither
/// self-post evidence source may count them — otherwise a notice posted
/// mid-turn silences the fallback and the real reply never reaches the
/// channel.
pub const HARNESS_NOTICE_TAG: &str = "buzz-harness-notice";

/// Whether an event is a harness notice rather than the agent's own post.
pub fn is_harness_notice(event: &nostr::Event) -> bool {
    event.tags.iter().any(|tag| {
        tag.as_slice()
            .first()
            .is_some_and(|name| name == HARNESS_NOTICE_TAG)
    })
}

fn json_is_harness_notice(event: &serde_json::Value) -> bool {
    event["tags"].as_array().is_some_and(|tags| {
        tags.iter()
            .any(|tag| tag[0].as_str() == Some(HARNESS_NOTICE_TAG))
    })
}

/// `channel_id` at or after `since_unix` (minus skew)? `None` when the query
/// failed or timed out — callers must treat that as unverified, not as absent.
/// Harness notices are skipped (see [`HARNESS_NOTICE_TAG`]).
pub async fn relay_has_agent_post(
    rest: &crate::relay::RestClient,
    channel_id: Uuid,
    since_unix: u64,
) -> Option<bool> {
    use nostr::{Alphabet, SingleLetterTag};
    let filter = nostr::Filter::new()
        .kind(nostr::Kind::Custom(9))
        .author(rest.keys.public_key())
        .custom_tags(
            SingleLetterTag::lowercase(Alphabet::H),
            [channel_id.to_string()],
        )
        .since(nostr::Timestamp::from(
            since_unix.saturating_sub(CLOCK_SKEW_SECS),
        ))
        // A few, not one: the newest post may be a harness notice.
        .limit(8);
    match tokio::time::timeout(
        RELAY_CHECK_TIMEOUT,
        rest.query(std::slice::from_ref(&filter)),
    )
    .await
    {
        Ok(Ok(json)) => json
            .as_array()
            .map(|events| events.iter().any(|event| !json_is_harness_notice(event))),
        Ok(Err(error)) => {
            tracing::warn!(channel_id = %channel_id, "delivery fallback: relay check failed: {error}");
            None
        }
        Err(_) => {
            tracing::warn!(channel_id = %channel_id, "delivery fallback: relay check timed out");
            None
        }
    }
}

#[derive(Clone, Copy, Debug)]
struct SelfPost {
    channel_id: Uuid,
    created_at: u64,
}

/// Bounded record of the agent's own events as seen from the relay, shared
/// between the main loop (writer) and the fallback task (reader).
#[derive(Clone, Default)]
pub struct SelfPostLog(Arc<Mutex<VecDeque<SelfPost>>>);

impl SelfPostLog {
    pub fn record(&self, channel_id: Uuid, created_at: u64) {
        let mut log = self.0.lock().unwrap_or_else(|e| e.into_inner());
        log.push_back(SelfPost {
            channel_id,
            created_at,
        });
        while log.len() > SELF_POST_LOG_CAP {
            log.pop_front();
        }
    }

    /// True when the agent posted in `channel_id` at or after `since_unix`
    /// (allowing [`CLOCK_SKEW_SECS`] of slack).
    pub fn posted_since(&self, channel_id: Uuid, since_unix: u64) -> bool {
        let log = self.0.lock().unwrap_or_else(|e| e.into_inner());
        log.iter().any(|post| {
            post.channel_id == channel_id
                && post.created_at.saturating_add(CLOCK_SKEW_SECS) >= since_unix
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::queue::{BatchEvent, PromptProfile};
    use crate::scope::SessionScope;
    use nostr::{EventBuilder, Keys, Kind};
    use std::collections::HashMap;

    fn kind9(keys: &Keys, tags: &[&[&str]]) -> nostr::Event {
        let nostr_tags: Vec<nostr::Tag> = tags
            .iter()
            .map(|t| nostr::Tag::parse(t.to_vec()).unwrap())
            .collect();
        EventBuilder::new(Kind::Custom(9), "@agent hello")
            .tags(nostr_tags)
            .sign_with_keys(keys)
            .unwrap()
    }

    fn batch(channel_id: Uuid, event: nostr::Event) -> FlushBatch {
        FlushBatch {
            channel_id,
            scope: SessionScope::Conversation { channel_id },
            events: vec![BatchEvent {
                event,
                prompt_tag: "@mention".into(),
                received_at: std::time::Instant::now(),
            }],
            cancelled_events: Vec::new(),
            cancel_reason: None,
        }
    }

    fn channel_info(channel_type: &str) -> PromptChannelInfo {
        PromptChannelInfo {
            name: "general".into(),
            channel_type: channel_type.into(),
            description: None,
            project: None,
        }
    }

    fn profiles(entries: &[(&Keys, bool)]) -> PromptProfileLookup {
        entries
            .iter()
            .map(|(keys, is_agent)| {
                (
                    keys.public_key().to_hex(),
                    PromptProfile {
                        display_name: None,
                        nip05_handle: None,
                        is_agent: *is_agent,
                    },
                )
            })
            .collect::<HashMap<_, _>>()
    }

    #[test]
    fn probe_for_dm_is_flat_and_human_facing() {
        let human = Keys::generate();
        let ch = Uuid::from_u128(11);
        let b = batch(ch, kind9(&human, &[&["h", &ch.to_string()]]));
        let probe = probe_for_batch(
            &b,
            Some(&channel_info("dm")),
            Some(&profiles(&[(&human, false)])),
            42,
        )
        .expect("probe");
        assert_eq!(
            probe,
            DeliveryProbe {
                channel_id: ch,
                is_dm: true,
                human_facing: true,
                reply_anchor: None,
                started_unix: 42,
            }
        );
    }

    #[test]
    fn probe_for_channel_anchors_to_the_trigger_or_the_thread_root() {
        let human = Keys::generate();
        let ch = Uuid::from_u128(12);
        let lookup = profiles(&[(&human, false)]);
        // Top-level trigger: the triggering event becomes the reply root.
        let top = kind9(&human, &[&["h", &ch.to_string()]]);
        let top_id = top.id.to_hex();
        let probe = probe_for_batch(
            &batch(ch, top),
            Some(&channel_info("public")),
            Some(&lookup),
            1,
        )
        .unwrap();
        assert!(!probe.is_dm && probe.human_facing);
        assert_eq!(probe.reply_anchor.as_deref(), Some(top_id.as_str()));
        // In a thread: the reply anchors to the existing root, not the reply.
        // NIP-10 markers: a reply carries both `root` and `reply`; a lone
        // `root` marker does not resolve (see `buzz_core::nip10`).
        let root = "c".repeat(64);
        let parent = "d".repeat(64);
        let reply = kind9(
            &human,
            &[
                &["h", &ch.to_string()],
                &["e", &root, "", "root"],
                &["e", &parent, "", "reply"],
            ],
        );
        let probe = probe_for_batch(
            &batch(ch, reply),
            Some(&channel_info("public")),
            Some(&lookup),
            1,
        )
        .unwrap();
        assert_eq!(probe.reply_anchor.as_deref(), Some(root.as_str()));
    }

    #[test]
    fn probe_marks_agent_only_turns_as_not_human_facing_but_human_mentions_as_human() {
        let agent = Keys::generate();
        let other_agent = Keys::generate();
        let human = Keys::generate();
        let ch = Uuid::from_u128(13);
        let lookup = profiles(&[(&agent, true), (&other_agent, true), (&human, false)]);
        let chs = ch.to_string();
        let agent_only = kind9(
            &agent,
            &[&["h", &chs], &["p", &other_agent.public_key().to_hex()]],
        );
        let probe = probe_for_batch(
            &batch(ch, agent_only),
            Some(&channel_info("public")),
            Some(&lookup),
            1,
        )
        .unwrap();
        assert!(!probe.human_facing);
        assert!(probe.reply_anchor.is_none(), "agent turns get no anchor");
        let agent_tagging_human = kind9(
            &agent,
            &[&["h", &chs], &["p", &human.public_key().to_hex()]],
        );
        let probe = probe_for_batch(
            &batch(ch, agent_tagging_human),
            Some(&channel_info("public")),
            Some(&lookup),
            1,
        )
        .unwrap();
        assert!(probe.human_facing);
    }

    #[test]
    fn probe_is_none_for_an_empty_batch() {
        let ch = Uuid::from_u128(14);
        let mut b = batch(ch, kind9(&Keys::generate(), &[]));
        b.events.clear();
        assert_eq!(probe_for_batch(&b, None, None, 1), None);
    }

    fn probe(human_facing: bool, is_dm: bool, anchor: Option<&str>) -> DeliveryProbe {
        DeliveryProbe {
            channel_id: Uuid::from_u128(1),
            is_dm,
            human_facing,
            reply_anchor: anchor.map(str::to_string),
            started_unix: 1_000,
        }
    }

    #[test]
    fn decide_publishes_only_for_silent_human_facing_turns_with_prose() {
        let p = probe(true, true, None);
        assert_eq!(
            decide(
                true,
                Some(&p),
                "  I'm Sonnet.  ",
                AgentPostEvidence::NotPosted
            ),
            FallbackDecision::Publish("I'm Sonnet.".into())
        );
        assert_eq!(
            decide(false, Some(&p), "text", AgentPostEvidence::NotPosted),
            FallbackDecision::Skip("disabled")
        );
        assert!(matches!(
            decide(true, None, "text", AgentPostEvidence::NotPosted),
            FallbackDecision::Skip(_)
        ));
        assert_eq!(
            decide(
                true,
                Some(&probe(false, false, None)),
                "text",
                AgentPostEvidence::NotPosted
            ),
            FallbackDecision::Skip("agent-to-agent turn")
        );
        assert_eq!(
            decide(true, Some(&p), "text", AgentPostEvidence::Posted),
            FallbackDecision::Skip("agent already posted in channel")
        );
        // Unverifiable evidence must fail closed: a duplicate is worse than silence.
        assert_eq!(
            decide(true, Some(&p), "text", AgentPostEvidence::Unknown),
            FallbackDecision::Skip("could not verify whether the agent posted")
        );
        assert_eq!(
            decide(true, Some(&p), " \n\t", AgentPostEvidence::NotPosted),
            FallbackDecision::Skip("no prose")
        );
    }

    #[test]
    fn decide_truncates_at_a_char_boundary_and_says_so() {
        let p = probe(true, true, None);
        let long: String = "가".repeat(MAX_FALLBACK_CHARS + 10);
        match decide(true, Some(&p), &long, AgentPostEvidence::NotPosted) {
            FallbackDecision::Publish(out) => {
                assert!(out.ends_with(TRUNCATION_NOTE));
                let body = &out[..out.len() - TRUNCATION_NOTE.len()];
                assert_eq!(body.chars().count(), MAX_FALLBACK_CHARS);
                assert!(body.chars().all(|c| c == '가'));
            }
            other => panic!("expected Publish, got {other:?}"),
        }
    }

    #[test]
    fn turn_prose_keeps_only_text_after_the_last_tool_call() {
        let mut buf = String::new();
        track_turn_prose(
            &mut buf,
            "agent_message_chunk",
            Some("I'll respond to your question. "),
        );
        track_turn_prose(&mut buf, "tool_call", None);
        track_turn_prose(
            &mut buf,
            "agent_message_chunk",
            Some("Now I'll send a reply."),
        );
        track_turn_prose(&mut buf, "tool_call_update", Some("ignored"));
        track_turn_prose(&mut buf, "tool_call", None);
        track_turn_prose(&mut buf, "agent_message_chunk", Some("I'm "));
        track_turn_prose(&mut buf, "agent_message_chunk", Some("Sonnet 5."));
        assert_eq!(buf, "I'm Sonnet 5.");
        track_turn_prose(&mut buf, "agent_thought_chunk", Some("(thinking)"));
        assert_eq!(
            buf, "I'm Sonnet 5.",
            "thoughts and other updates are ignored"
        );
    }

    #[test]
    fn tool_call_detector_matches_the_send_command_in_title_or_raw_input() {
        let raw = serde_json::json!({ "command": "buzz messages send --channel x --content -" });
        assert!(tool_call_sends_message("Terminal", Some(&raw)));
        assert!(tool_call_sends_message(
            "buzz messages send --channel 817b --content \"hi\"",
            None
        ));
        assert!(!tool_call_sends_message(
            "buzz messages get --channel x",
            None
        ));
        assert!(!tool_call_sends_message(
            "Read /tmp/notes.md",
            Some(&serde_json::json!({ "command": "ls" }))
        ));
        assert!(!tool_call_sends_message("Terminal", None));
    }

    #[test]
    fn thread_tags_are_flat_in_dms_and_anchored_in_channels() {
        let dm = fallback_thread_tags(&probe(true, true, Some("a".repeat(64).as_str())));
        assert!(dm.root_event_id.is_none() && dm.parent_event_id.is_none());
        let root = "b".repeat(64);
        let ch = fallback_thread_tags(&probe(true, false, Some(&root)));
        assert_eq!(ch.root_event_id.as_deref(), Some(root.as_str()));
        assert_eq!(ch.parent_event_id.as_deref(), Some(root.as_str()));
        let unanchored = fallback_thread_tags(&probe(true, false, None));
        assert!(unanchored.root_event_id.is_none());
    }

    #[test]
    fn harness_notices_are_not_agent_posts() {
        let keys = Keys::generate();
        let plain = kind9(&keys, &[&["h", "chan"]]);
        assert!(!is_harness_notice(&plain));
        let notice = kind9(
            &keys,
            &[&["h", "chan"], &[HARNESS_NOTICE_TAG, "sign-in notice"]],
        );
        assert!(is_harness_notice(&notice));
        assert!(json_is_harness_notice(
            &serde_json::to_value(&notice).unwrap()
        ));
        assert!(!json_is_harness_notice(
            &serde_json::to_value(&plain).unwrap()
        ));
    }

    #[test]
    fn self_post_log_matches_channel_and_time_with_skew_and_stays_bounded() {
        let log = SelfPostLog::default();
        let ch = Uuid::from_u128(7);
        assert!(!log.posted_since(ch, 100));
        log.record(ch, 98); // 2s before turn start: within skew
        assert!(log.posted_since(ch, 100));
        assert!(!log.posted_since(Uuid::from_u128(8), 100), "other channel");
        assert!(!log.posted_since(ch, 100 + CLOCK_SKEW_SECS + 1), "too old");
        for i in 0..(SELF_POST_LOG_CAP as u64 + 50) {
            log.record(Uuid::from_u128(9), 10_000 + i);
        }
        assert!(log.0.lock().unwrap().len() <= SELF_POST_LOG_CAP);
        assert!(!log.posted_since(ch, 100), "the early entry was evicted");
    }

    #[test]
    fn plan_file_content_reads_only_writes_into_the_plans_directory() {
        let plan = serde_json::json!({
            "file_path": "/Users/me/.claude/plans/buzz-thing.md",
            "content": "# Plan\n1. do x",
        });
        assert_eq!(
            plan_file_content(Some(&plan)).as_deref(),
            Some("# Plan\n1. do x")
        );
        let elsewhere =
            serde_json::json!({"file_path": "/Users/me/Desktop/plan.md", "content": "x"});
        assert_eq!(plan_file_content(Some(&elsewhere)), None);
        let blank = serde_json::json!({"file_path": "/u/.claude/plans/p.md", "content": "  "});
        assert_eq!(plan_file_content(Some(&blank)), None);
        assert_eq!(plan_file_content(None), None);
    }

    #[test]
    fn fallback_body_prefers_prose_and_frames_a_lone_plan() {
        assert_eq!(fallback_body("answer", Some("plan")), "answer");
        let framed = fallback_body("  ", Some("1. step"));
        assert!(framed.starts_with("**Plan** (plan mode"));
        assert!(framed.ends_with("1. step"));
        assert_eq!(fallback_body("", None), "");
        assert_eq!(fallback_body("", Some("   ")), "");
    }
}
