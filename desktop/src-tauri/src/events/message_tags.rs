use nostr::{EventId, Tag};

use super::check_pubkey;

const MAX_THREAD_ROOT_EXCERPT_CHARS: usize = 64;
const SENT_FROM_THREAD_TAG: &str = "buzz:sent-from-thread";
const AGENT_ADDRESS_MENTION_MARKER: &str = "agent-address";

/// ACP permission modes `buzz-acp` accepts on the `buzz:permission-mode` tag.
const PERMISSION_MODE_VALUES: &[&str] = &[
    "default",
    "auto",
    "acceptEdits",
    "bypassPermissions",
    "dontAsk",
    "plan",
];

/// Append the owner's per-message permission-mode tag
/// (`["buzz:permission-mode", "<mode>"]`, see
/// `buzz_core_pkg::observer::PERMISSION_MODE_TAG`). Exactly two parts and a
/// known ACP mode; anything else is rejected rather than forwarded.
pub(super) fn append_permission_mode_tag(
    mode_tag: Option<&[String]>,
    tags: &mut Vec<Tag>,
) -> Result<(), String> {
    let Some(mode_tag) = mode_tag else {
        return Ok(());
    };
    if mode_tag.len() != 2
        || mode_tag.first().map(String::as_str)
            != Some(buzz_core_pkg::observer::PERMISSION_MODE_TAG)
    {
        return Err("invalid permission-mode tag shape".into());
    }
    if !PERMISSION_MODE_VALUES.contains(&mode_tag[1].as_str()) {
        return Err(format!("unknown permission mode {:?}", mode_tag[1]));
    }
    let parts: Vec<&str> = mode_tag.iter().map(String::as_str).collect();
    tags.push(Tag::parse(parts).map_err(|e| format!("invalid permission-mode tag: {e}"))?);
    Ok(())
}

pub(super) fn mention_reference_tags(
    mentions: &[Vec<String>],
    tags: &mut Vec<Tag>,
) -> Result<(), String> {
    for mention in mentions {
        if mention.first().map(String::as_str) != Some("mention") {
            return Err(format!(
                "mention reference tags must use 'mention' prefix (got {:?})",
                mention.first()
            ));
        }
        let Some(pubkey) = mention.get(1) else {
            return Err("mention reference tag missing pubkey".into());
        };
        if mention.len() > 3
            || (mention.len() == 3
                && mention.get(2).map(String::as_str) != Some(AGENT_ADDRESS_MENTION_MARKER))
        {
            return Err("mention reference tag has invalid display metadata".into());
        }
        check_pubkey(pubkey)?;
        let normalized_pubkey = pubkey.to_ascii_lowercase();
        let mut parts = vec!["mention", normalized_pubkey.as_str()];
        if mention.len() == 3 {
            parts.push(AGENT_ADDRESS_MENTION_MARKER);
        }
        tags.push(
            Tag::parse(parts).map_err(|error| format!("invalid mention reference tag: {error}"))?,
        );
    }
    Ok(())
}

pub(super) fn append_sent_from_thread_tag(
    source_tag: Option<&[String]>,
    tags: &mut Vec<Tag>,
) -> Result<(), String> {
    let Some(source_tag) = source_tag else {
        return Ok(());
    };
    if !matches!(source_tag.len(), 2 | 3)
        || source_tag.first().map(String::as_str) != Some(SENT_FROM_THREAD_TAG)
    {
        return Err("invalid sent-from-thread tag shape".into());
    }

    EventId::from_hex(source_tag[1].trim())
        .map_err(|_| "sent-from-thread tag has invalid root event ID")?;

    if let Some(excerpt) = source_tag.get(2) {
        if excerpt.trim().is_empty()
            || excerpt.chars().count() > MAX_THREAD_ROOT_EXCERPT_CHARS
            || excerpt.chars().any(char::is_control)
        {
            return Err("sent-from-thread tag has invalid root excerpt".into());
        }
    }

    let parts: Vec<&str> = source_tag.iter().map(String::as_str).collect();
    tags.push(Tag::parse(parts).map_err(|e| format!("invalid sent-from-thread tag: {e}"))?);
    Ok(())
}

/// Validate and append imeta tags. Rejects any tag whose first element is not "imeta"
/// to prevent injection of arbitrary tags (e.g., forged "h", "e", or "p" tags).
pub(super) fn imeta_tags(media_tags: &[Vec<String>], tags: &mut Vec<Tag>) -> Result<(), String> {
    for media_tag in media_tags {
        if media_tag.first().map(String::as_str) != Some("imeta") {
            return Err(format!(
                "media tags must use 'imeta' prefix (got {:?})",
                media_tag.first()
            ));
        }
        let parts: Vec<&str> = media_tag.iter().map(String::as_str).collect();
        tags.push(Tag::parse(parts).map_err(|e| format!("invalid imeta tag: {e}"))?);
    }
    Ok(())
}

/// Validate and append NIP-30 custom-emoji tags. Mirrors `imeta_tags`: rejects
/// any tag whose first element is not "emoji" so this path can't be used to
/// smuggle forged "h"/"e"/"p" tags. Each tag is `["emoji", shortcode, url]`.
pub(super) fn emoji_tags(emoji_tags: &[Vec<String>], tags: &mut Vec<Tag>) -> Result<(), String> {
    for emoji_tag in emoji_tags {
        if emoji_tag.first().map(String::as_str) != Some("emoji") {
            return Err(format!(
                "emoji tags must use 'emoji' prefix (got {:?})",
                emoji_tag.first()
            ));
        }
        let parts: Vec<&str> = emoji_tag.iter().map(String::as_str).collect();
        tags.push(Tag::parse(parts).map_err(|e| format!("invalid emoji tag: {e}"))?);
    }
    Ok(())
}

pub(super) fn append_client_tags(
    client_tags: &[Vec<String>],
    tags: &mut Vec<Tag>,
) -> Result<(), String> {
    for client_tag in client_tags {
        if client_tag.first().map(String::as_str) != Some("client") {
            return Err(format!(
                "client tags must use 'client' prefix (got {:?})",
                client_tag.first()
            ));
        }
        if client_tag.len() < 2 {
            return Err("client tag missing marker".into());
        }
        let parts: Vec<&str> = client_tag.iter().map(String::as_str).collect();
        tags.push(Tag::parse(parts).map_err(|e| format!("invalid client tag: {e}"))?);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const PUBKEY: &str = "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
    const ROOT_HEX: &str = "d24da132115ca0a46233cf4c2ad8338fbf914250cbcaa9181a6dd59533cb5ac1";

    #[test]
    fn mention_reference_preserves_agent_address_display_metadata() {
        let mut tags = Vec::new();
        mention_reference_tags(
            &[vec![
                "mention".into(),
                PUBKEY.to_ascii_uppercase(),
                AGENT_ADDRESS_MENTION_MARKER.into(),
            ]],
            &mut tags,
        )
        .unwrap();

        assert_eq!(
            tags[0].as_slice(),
            &["mention", PUBKEY, AGENT_ADDRESS_MENTION_MARKER]
        );
    }

    #[test]
    fn mention_reference_rejects_unknown_display_metadata() {
        let mut tags = Vec::new();
        let result = mention_reference_tags(
            &[vec!["mention".into(), PUBKEY.into(), "unknown".into()]],
            &mut tags,
        );

        assert!(result.is_err());
    }

    #[test]
    fn permission_mode_tag_accepts_known_modes_and_rejects_everything_else() {
        let tag_name = buzz_core_pkg::observer::PERMISSION_MODE_TAG;
        let mut tags = Vec::new();
        append_permission_mode_tag(Some(&[tag_name.to_string(), "plan".to_string()]), &mut tags)
            .unwrap();
        assert_eq!(tags[0].as_slice(), &[tag_name, "plan"]);

        // Absent tag is a no-op.
        let mut none = Vec::new();
        append_permission_mode_tag(None, &mut none).unwrap();
        assert!(none.is_empty());

        for bad in [
            vec![tag_name.to_string()],
            vec![
                tag_name.to_string(),
                "plan".to_string(),
                "extra".to_string(),
            ],
            vec![tag_name.to_string(), "yolo".to_string()],
            vec!["permission-mode".to_string(), "plan".to_string()],
        ] {
            let mut tags = Vec::new();
            assert!(
                append_permission_mode_tag(Some(&bad), &mut tags).is_err(),
                "{bad:?} must be rejected"
            );
        }
    }

    #[test]
    fn message_accepts_only_valid_sent_from_thread_provenance() {
        let source_tag = vec![
            SENT_FROM_THREAD_TAG.to_string(),
            ROOT_HEX.to_string(),
            "Root message excerpt".to_string(),
        ];
        let mut tags = Vec::new();
        append_sent_from_thread_tag(Some(&source_tag), &mut tags).unwrap();
        assert_eq!(tags[0].as_slice(), source_tag);

        let forged_channel_tag = vec!["h".to_string(), "channel-id".to_string()];
        assert!(append_sent_from_thread_tag(Some(&forged_channel_tag), &mut Vec::new()).is_err());

        let invalid_root_tag = vec![
            SENT_FROM_THREAD_TAG.to_string(),
            "not-an-event-id".to_string(),
        ];
        assert!(append_sent_from_thread_tag(Some(&invalid_root_tag), &mut Vec::new()).is_err());
    }
}
