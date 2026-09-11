import assert from "node:assert/strict";
import test from "node:test";

import {
  attachmentKind,
  collectAttachments,
  formatBytes,
  groupBySender,
} from "./channelAttachmentArchive.ts";

const A = "a".repeat(64);
const B = "b".repeat(64);

function event(id, pubkey, createdAt, tags) {
  return {
    id,
    pubkey,
    created_at: createdAt,
    kind: 9,
    tags,
    content: "",
    sig: "",
  };
}
const imeta = (url, extra = []) => ["imeta", `url ${url}`, ...extra];

test("collectAttachments: one item per imeta url, newest message first, thread root kept", () => {
  const items = collectAttachments([
    event("e1", A, 100, [
      ["h", "ch"],
      imeta("https://r/media/one.png", [
        "m image/png",
        "size 2048",
        "thumb https://r/t/one.png",
      ]),
    ]),
    event("e2", B, 300, [
      ["h", "ch"],
      ["e", "root1", "", "root"],
      imeta("https://r/media/doc.pdf", [
        "m application/pdf",
        "filename report.pdf",
      ]),
      imeta("https://r/media/clip.mp4", ["m video/mp4"]),
    ]),
    event("e3", A, 200, [["h", "ch"]]),
  ]);
  assert.deepEqual(
    items.map((i) => [i.eventId, i.name, i.kind, i.threadRootId]),
    [
      ["e2", "report.pdf", "file", "root1"],
      ["e2", "clip.mp4", "video", "root1"],
      ["e1", "one.png", "image", null],
    ],
  );
  assert.equal(items[2].size, 2048);
  assert.equal(items[2].thumb, "https://r/t/one.png");
  assert.equal(items[0].size, null);
});

test("collectAttachments: duplicate events and urls are deduped; missing mime falls back to a file", () => {
  const dup = event("e1", A, 100, [imeta("https://r/media/x.bin")]);
  const items = collectAttachments([dup, dup]);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "file");
  assert.equal(items[0].mime, "application/octet-stream");
});

test("groupBySender: newest group first, items newest first inside, pubkeys case-folded", () => {
  const items = collectAttachments([
    event("e1", A, 100, [imeta("https://r/1.png", ["m image/png"])]),
    event("e2", B, 150, [imeta("https://r/2.png", ["m image/png"])]),
    event("e3", A.toUpperCase(), 300, [
      imeta("https://r/3.png", ["m image/png"]),
    ]),
  ]);
  const groups = groupBySender(items);
  assert.deepEqual(
    groups.map((g) => [g.pubkey, g.items.length, g.latestAt]),
    [
      [A, 2, 300],
      [B, 1, 150],
    ],
  );
  assert.deepEqual(
    groups[0].items.map((i) => i.eventId),
    ["e3", "e1"],
  );
});

test("attachmentKind and formatBytes", () => {
  assert.equal(attachmentKind("image/webp"), "image");
  assert.equal(attachmentKind("AUDIO/ogg"), "audio");
  assert.equal(attachmentKind("text/plain"), "file");
  assert.equal(formatBytes(null), null);
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB");
  assert.equal(formatBytes(120 * 1024 * 1024), "120 MB");
});
