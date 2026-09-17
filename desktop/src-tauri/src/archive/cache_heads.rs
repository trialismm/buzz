//! Prompt-cache heads: the most recent archived NIP-AM turn metric per
//! (channel, agent). The sidebar's cache timer starts from `reported_at` —
//! the end of the agent's last turn is when the provider's prompt cache was
//! last written or refreshed — and sizes what a miss would re-read from
//! `context_tokens`. Read straight from the decrypted payloads in
//! `archived_events` (the metric index has no channel column), bounded to a
//! recent window because a cache never outlives an hour or so.

use std::collections::HashMap;

use buzz_core_pkg::agent_turn_metric::AgentTurnMetricPayload;
use buzz_core_pkg::kind::KIND_AGENT_TURN_METRIC;
use rusqlite::{params, Connection};
use serde::Serialize;

/// Hard cap on rows scanned per call; the window keeps it far below this.
const MAX_ROWS: i64 = 2_000;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelCacheHead {
    pub channel_id: String,
    pub agent_pubkey: String,
    pub session_id: Option<String>,
    /// Unix seconds of the end of the turn (payload timestamp, else the
    /// event's `created_at`).
    pub reported_at: i64,
    pub harness: String,
    pub model: Option<String>,
    /// Context-window occupancy after the turn; `None` for harnesses that
    /// predate `contextTokens`.
    pub context_tokens: Option<u64>,
    pub turn_input_tokens: Option<u64>,
    pub turn_output_tokens: Option<u64>,
    pub turn_cache_read_tokens: Option<u64>,
    pub turn_cache_write_tokens: Option<u64>,
    pub turn_cost_usd: Option<f64>,
    pub pricing_authority: Option<String>,
    pub pricing_model: Option<String>,
}

/// Latest metric per (channel, agent) among events created at or after
/// `since_unix`. Unparseable payloads and turns without a channel are skipped.
pub(super) fn load_channel_cache_heads(
    conn: &Connection,
    identity_pk: &str,
    relay_url: &str,
    since_unix: i64,
) -> Result<Vec<ChannelCacheHead>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT pubkey, created_at, raw_json FROM archived_events
             WHERE identity_pubkey = ?1 AND relay_url = ?2 AND kind = ?3 AND created_at >= ?4
             ORDER BY created_at DESC LIMIT ?5",
        )
        .map_err(|e| format!("cache heads: prepare failed: {e}"))?;
    let rows = stmt
        .query_map(
            params![
                identity_pk,
                relay_url,
                KIND_AGENT_TURN_METRIC as i64,
                since_unix,
                MAX_ROWS
            ],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .map_err(|e| format!("cache heads: query failed: {e}"))?;

    let mut heads: HashMap<(String, String), ChannelCacheHead> = HashMap::new();
    for row in rows {
        let (agent_pubkey, created_at, raw_json) =
            row.map_err(|e| format!("cache heads: row failed: {e}"))?;
        let Ok(payload) = serde_json::from_str::<AgentTurnMetricPayload>(&raw_json) else {
            continue;
        };
        let Some(channel_id) = payload.channel_id.clone().filter(|c| !c.trim().is_empty()) else {
            continue;
        };
        let reported_at = chrono::DateTime::parse_from_rfc3339(&payload.timestamp)
            .map(|t| t.timestamp())
            .unwrap_or(created_at);
        let key = (channel_id.clone(), agent_pubkey.clone());
        if heads
            .get(&key)
            .is_some_and(|h| h.reported_at >= reported_at)
        {
            continue;
        }
        let turn = payload.turn.as_ref();
        heads.insert(
            key,
            ChannelCacheHead {
                channel_id,
                agent_pubkey,
                session_id: payload.session_id.clone(),
                reported_at,
                harness: payload.harness.clone(),
                model: payload.model.clone(),
                context_tokens: payload.context_tokens,
                turn_input_tokens: turn.and_then(|t| t.input_tokens),
                turn_output_tokens: turn.and_then(|t| t.output_tokens),
                turn_cache_read_tokens: turn.and_then(|t| t.cache_read_tokens),
                turn_cache_write_tokens: turn.and_then(|t| t.cache_write_tokens),
                turn_cost_usd: turn.and_then(|t| t.cost_usd),
                pricing_authority: payload
                    .pricing_identity
                    .as_ref()
                    .map(|p| p.authority.clone()),
                pricing_model: payload.pricing_identity.as_ref().map(|p| p.model.clone()),
            },
        );
    }
    let mut out: Vec<ChannelCacheHead> = heads.into_values().collect();
    out.sort_by(|a, b| {
        b.reported_at
            .cmp(&a.reported_at)
            .then_with(|| a.channel_id.cmp(&b.channel_id))
            .then_with(|| a.agent_pubkey.cmp(&b.agent_pubkey))
    });
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ME: &str = "me";
    const RELAY: &str = "wss://relay.example";

    fn insert(conn: &Connection, id: &str, agent: &str, created_at: i64, raw_json: &str) {
        conn.execute(
            "INSERT INTO archived_events
             (identity_pubkey, relay_url, id, kind, pubkey, created_at, raw_json, archived_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?6)",
            params![
                ME,
                RELAY,
                id,
                KIND_AGENT_TURN_METRIC as i64,
                agent,
                created_at,
                raw_json
            ],
        )
        .unwrap();
    }

    fn payload(channel: &str, timestamp: &str, context: Option<u64>) -> String {
        serde_json::json!({
            "harness": "claude-agent-acp", "model": null, "channelId": channel,
            "sessionId": "s", "turnId": "t", "turnSeq": 1, "timestamp": timestamp,
            "turn": { "inputTokens": 84606, "outputTokens": 79, "totalTokens": null,
                      "costUsd": 0.02, "cacheReadTokens": 83744, "cacheWriteTokens": 860 },
            "cumulative": null, "deltaReliable": true, "stopReason": "end_turn",
            "contextTokens": context
        })
        .to_string()
    }

    #[test]
    fn keeps_the_latest_turn_per_channel_and_agent_inside_the_window() {
        let dir = tempfile::tempdir().unwrap();
        let conn = crate::archive::store::open_archive_db(&dir.path().join("a.db")).unwrap();
        insert(
            &conn,
            "e1",
            "agent-a",
            1_000,
            &payload("chan-1", "2026-09-17T10:00:00Z", Some(50_000)),
        );
        insert(
            &conn,
            "e2",
            "agent-a",
            1_100,
            &payload("chan-1", "2026-09-17T10:05:00Z", Some(84_000)),
        );
        insert(
            &conn,
            "e3",
            "agent-b",
            1_050,
            &payload("chan-1", "2026-09-17T10:02:00Z", None),
        );
        insert(
            &conn,
            "e4",
            "agent-a",
            1_200,
            &payload("chan-2", "2026-09-17T10:06:00Z", Some(9_000)),
        );
        // Out of window, unparseable, and channel-less rows are ignored.
        insert(
            &conn,
            "old",
            "agent-a",
            10,
            &payload("chan-3", "2026-09-01T00:00:00Z", Some(1)),
        );
        insert(&conn, "bad", "agent-a", 1_300, "{not json");
        insert(
            &conn,
            "nochan",
            "agent-a",
            1_300,
            &payload("", "2026-09-17T10:07:00Z", Some(1)),
        );
        // Another identity's rows never leak in.
        conn.execute(
            "INSERT INTO archived_events VALUES ('someone', ?1, 'x', ?2, 'agent-z', 1300, ?3, 1300)",
            params![RELAY, KIND_AGENT_TURN_METRIC as i64, payload("chan-9", "2026-09-17T10:08:00Z", Some(1))],
        )
        .unwrap();

        let heads = load_channel_cache_heads(&conn, ME, RELAY, 500).unwrap();
        let summary: Vec<(&str, &str, Option<u64>)> = heads
            .iter()
            .map(|h| {
                (
                    h.channel_id.as_str(),
                    h.agent_pubkey.as_str(),
                    h.context_tokens,
                )
            })
            .collect();
        assert_eq!(
            summary,
            vec![
                ("chan-2", "agent-a", Some(9_000)),
                ("chan-1", "agent-a", Some(84_000)),
                ("chan-1", "agent-b", None),
            ]
        );
        assert_eq!(heads[1].turn_cache_read_tokens, Some(83_744));
        assert_eq!(heads[1].turn_cost_usd, Some(0.02));
    }
}
