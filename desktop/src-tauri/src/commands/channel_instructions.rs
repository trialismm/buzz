//! Channel instructions — the owner's standing rules for a channel, stored
//! as kind 48106 (`KIND_HUDDLE_GUIDELINES`, originally huddle guidelines) with
//! the channel's `h` tag. buzz-acp reads the newest event signed by the
//! agent's owner and injects it as `<channel-instructions>` into every new
//! session for that channel, so this is the "project instructions" surface.

use tauri::State;

use crate::{
    app_state::AppState,
    events,
    relay::{query_relay, submit_event},
};

/// Read the caller's most recent instructions for a channel. Only the
/// caller's own event counts — the harness only honors its owner's signature.
#[tauri::command]
pub async fn get_channel_instructions(
    channel_id: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let author = state.signing_keys()?.public_key().to_hex();
    let events = query_relay(
        &state,
        &[serde_json::json!({
            "kinds": [buzz_core_pkg::kind::KIND_HUDDLE_GUIDELINES],
            "authors": [author],
            "#h": [channel_id],
            "limit": 1
        })],
    )
    .await?;
    let Some(event) = events.first() else {
        return Ok(serde_json::json!({
            "content": "",
            "event_id": null,
            "updated_at": null,
        }));
    };
    Ok(serde_json::json!({
        "content": event.content,
        "event_id": event.id.to_hex(),
        "updated_at": event.created_at.as_secs(),
    }))
}

/// Publish new instructions (an empty body clears them for new sessions).
#[tauri::command]
pub async fn set_channel_instructions(
    channel_id: String,
    content: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let uuid = uuid::Uuid::parse_str(&channel_id)
        .map_err(|_| format!("invalid channel UUID: {channel_id}"))?;
    let builder = events::build_channel_instructions(uuid, &content)?;
    let result = submit_event(builder, &state).await?;
    Ok(serde_json::json!({
        "ok": true,
        "event_id": result.event_id,
    }))
}
