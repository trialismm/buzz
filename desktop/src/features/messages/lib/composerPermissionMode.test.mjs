import assert from "node:assert/strict";
import test from "node:test";

import { withComposerPermissionModeTag } from "./composerPermissionMode.ts";
import { splitOutgoingTags } from "./imetaMediaMarkdown.ts";

const IMETA = ["imeta", "url https://example.com/a.png", "m image/png"];

test("withComposerPermissionModeTag: no choice leaves the outgoing tags untouched", () => {
  assert.equal(withComposerPermissionModeTag(undefined, null), undefined);
  assert.deepEqual(withComposerPermissionModeTag([IMETA], null), [IMETA]);
});

test("withComposerPermissionModeTag: a choice appends exactly one buzz:permission-mode tag that the send path routes on its own", () => {
  const tags = withComposerPermissionModeTag([IMETA], "plan");
  assert.deepEqual(tags, [IMETA, ["buzz:permission-mode", "plan"]]);
  const split = splitOutgoingTags(tags);
  // Never rides the imeta-only media channel (its guard would reject it).
  assert.deepEqual(split.mediaTags, [IMETA]);
  assert.deepEqual(split.permissionModeTag, ["buzz:permission-mode", "plan"]);
});

test("splitOutgoingTags: the last permission-mode tag wins and none yields undefined", () => {
  assert.equal(splitOutgoingTags([IMETA]).permissionModeTag, undefined);
  assert.deepEqual(
    splitOutgoingTags([
      ["buzz:permission-mode", "plan"],
      ["buzz:permission-mode", "dontAsk"],
    ]).permissionModeTag,
    ["buzz:permission-mode", "dontAsk"],
  );
});
