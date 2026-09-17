import assert from "node:assert/strict";
import test from "node:test";

import { buildProjectRenameTemplate } from "./renameProject.ts";

const OWNER = "a".repeat(64);
const head = (tags) => ({
  id: "e".repeat(64),
  pubkey: OWNER,
  kind: 30621,
  created_at: 1,
  content: "",
  sig: "f".repeat(128),
  tags,
});

test("only the name tag changes; slug, channel and unknown tags survive", () => {
  const live = head([
    ["d", "radar"],
    ["name", "Radar"],
    ["description", "desc"],
    ["x-custom", "keep-me"],
  ]);
  const template = buildProjectRenameTemplate({
    liveHead: live,
    name: "  Radar v2  ",
    ownerPubkey: OWNER.toUpperCase(),
  });
  assert.deepEqual(template.tags, [
    ["d", "radar"],
    ["name", "Radar v2"],
    ["description", "desc"],
    ["x-custom", "keep-me"],
  ]);
  assert.equal(template.kind, 30621);
});

test("a head without a name tag gains one; blank names and non-owners are refused", () => {
  const live = head([["d", "radar"]]);
  assert.deepEqual(
    buildProjectRenameTemplate({
      liveHead: live,
      name: "Radar",
      ownerPubkey: OWNER,
    }).tags,
    [
      ["d", "radar"],
      ["name", "Radar"],
    ],
  );
  assert.throws(
    () =>
      buildProjectRenameTemplate({
        liveHead: live,
        name: "  ",
        ownerPubkey: OWNER,
      }),
    /required/,
  );
  assert.throws(
    () =>
      buildProjectRenameTemplate({
        liveHead: live,
        name: "X",
        ownerPubkey: "b".repeat(64),
      }),
    /owner/,
  );
});
