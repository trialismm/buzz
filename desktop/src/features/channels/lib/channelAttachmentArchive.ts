import { parseImetaTags } from "@/shared/ui/markdown/parseImeta";
import type { RelayEvent } from "@/shared/api/types";

/** One attachment in a channel's history, with enough to show and jump to it. */
export type ArchiveAttachment = {
  /** `${eventId}:${url}` — an event can carry several attachments. */
  key: string;
  eventId: string;
  /** NIP-10 root of the message when it is a thread reply, else null. */
  threadRootId: string | null;
  pubkey: string;
  createdAt: number;
  url: string;
  mime: string;
  kind: "image" | "video" | "audio" | "file";
  /** `filename` from imeta, else the URL's basename. */
  name: string;
  size: number | null;
  thumb: string | null;
  alt: string | null;
};

export type SenderGroup = {
  pubkey: string;
  items: ArchiveAttachment[];
  /** Newest attachment in the group; groups are ordered by it. */
  latestAt: number;
};

export function attachmentKind(mime: string): ArchiveAttachment["kind"] {
  const lower = mime.toLowerCase();
  if (lower.startsWith("image/")) return "image";
  if (lower.startsWith("video/")) return "video";
  if (lower.startsWith("audio/")) return "audio";
  return "file";
}

function urlBasename(url: string): string {
  try {
    const path = new URL(url).pathname;
    const last = path.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : url;
  } catch {
    return url;
  }
}

function nip10RootId(tags: readonly (readonly string[])[]): string | null {
  let root: string | null = null;
  let reply: string | null = null;
  for (const tag of tags) {
    if (tag[0] !== "e" || !tag[1]) continue;
    if (tag[3] === "root") root = tag[1];
    else if (tag[3] === "reply") reply = tag[1];
  }
  // A lone reply marker still identifies the thread the message lives in.
  return root ?? reply;
}

/** Every imeta attachment across `events`, newest message first. */
export function collectAttachments(
  events: readonly RelayEvent[],
): ArchiveAttachment[] {
  const out: ArchiveAttachment[] = [];
  const seen = new Set<string>();
  const ordered = [...events].sort((a, b) => b.created_at - a.created_at);
  for (const event of ordered) {
    const entries = parseImetaTags(event.tags);
    if (entries.size === 0) continue;
    const threadRootId = nip10RootId(event.tags);
    for (const entry of entries.values()) {
      if (!entry.url) continue;
      const key = `${event.id}:${entry.url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const mime = entry.m ?? "application/octet-stream";
      out.push({
        key,
        eventId: event.id,
        threadRootId,
        pubkey: event.pubkey,
        createdAt: event.created_at,
        url: entry.url,
        mime,
        kind: attachmentKind(mime),
        name: entry.filename ?? urlBasename(entry.url),
        size: Number.isFinite(entry.size) && entry.size > 0 ? entry.size : null,
        thumb: entry.thumb ?? null,
        alt: entry.alt ?? null,
      });
    }
  }
  return out;
}

/** Group by sender; groups newest-first by their latest attachment. */
export function groupBySender(
  items: readonly ArchiveAttachment[],
): SenderGroup[] {
  const groups = new Map<string, SenderGroup>();
  for (const item of items) {
    const pubkey = item.pubkey.toLowerCase();
    const group = groups.get(pubkey);
    if (group) {
      group.items.push(item);
      group.latestAt = Math.max(group.latestAt, item.createdAt);
    } else {
      groups.set(pubkey, { pubkey, items: [item], latestAt: item.createdAt });
    }
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      items: [...group.items].sort((a, b) => b.createdAt - a.createdAt),
    }))
    .sort((a, b) => b.latestAt - a.latestAt);
}

export function formatBytes(size: number | null): string | null {
  if (size === null) return null;
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB"];
  let value = size / 1024;
  let unit = units[0];
  for (let i = 1; i < units.length && value >= 1024; i += 1) {
    value /= 1024;
    unit = units[i];
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${unit}`;
}
