import assert from "node:assert/strict";
import test from "node:test";
import {
  HARNESS_DEFAULT_PERMISSION_MODE,
  PERMISSION_MODE_ENV_KEY,
  PERMISSION_MODES,
  SELECTABLE_PERMISSION_MODES,
  isLegacyPermissionMode,
  parsePermissionMode,
  permissionModeLabel,
  readPermissionMode,
  withPermissionMode,
} from "./permissionMode.ts";

test("the vocabulary matches buzz-acp's PermissionMode variants and default", () => {
  assert.deepEqual(PERMISSION_MODES.map((m) => m.value).sort(), [
    "acceptEdits",
    "auto",
    "bypassPermissions",
    "default",
    "dontAsk",
    "plan",
  ]);
  assert.equal(HARNESS_DEFAULT_PERMISSION_MODE, "bypassPermissions");
  assert.equal(PERMISSION_MODE_ENV_KEY, "BUZZ_ACP_PERMISSION_MODE");
});

test("parsePermissionMode accepts ACP spelling and kebab aliases, rejects junk", () => {
  assert.equal(parsePermissionMode("acceptEdits"), "acceptEdits");
  assert.equal(parsePermissionMode("accept-edits"), "acceptEdits");
  assert.equal(parsePermissionMode("bypass-permissions"), "bypassPermissions");
  assert.equal(parsePermissionMode(" plan "), "plan");
  for (const junk of ["", "   ", null, undefined, "yolo", "ACCEPTEDITS"]) {
    assert.equal(parsePermissionMode(junk), null, String(junk));
  }
});

test("readPermissionMode reads only the well-known key", () => {
  assert.equal(
    readPermissionMode({ BUZZ_ACP_PERMISSION_MODE: "plan" }),
    "plan",
  );
  assert.equal(readPermissionMode({ OTHER: "plan" }), null);
  assert.equal(readPermissionMode(undefined), null);
});

test("withPermissionMode sets or removes the key without mutating the input", () => {
  const original = { KEEP: "1", BUZZ_ACP_PERMISSION_MODE: "plan" };
  const set = withPermissionMode(original, "acceptEdits");
  assert.deepEqual(set, { KEEP: "1", BUZZ_ACP_PERMISSION_MODE: "acceptEdits" });
  const cleared = withPermissionMode(original, null);
  assert.deepEqual(cleared, { KEEP: "1" });
  assert.deepEqual(
    original,
    { KEEP: "1", BUZZ_ACP_PERMISSION_MODE: "plan" },
    "input untouched",
  );
  assert.deepEqual(withPermissionMode(undefined, "plan"), {
    BUZZ_ACP_PERMISSION_MODE: "plan",
  });
});

test("permissionModeLabel names the harness default for null", () => {
  assert.equal(permissionModeLabel(null), "Harness default");
  assert.equal(permissionModeLabel("bypassPermissions"), "Run everything");
  assert.equal(permissionModeLabel("dontAsk"), "Read-only");
});

test("only dontAsk and plan are described as restricting; asking modes say they are auto-approved", () => {
  const byValue = Object.fromEntries(
    PERMISSION_MODES.map((m) => [m.value, m.description]),
  );
  assert.match(byValue.dontAsk, /refused/);
  assert.match(byValue.plan, /without executing/);
  for (const asking of ["default", "acceptEdits", "auto"]) {
    assert.match(byValue[asking], /auto-approve/i, asking);
  }
});

test("pickers offer exactly the three modes that differ under buzz-acp", () => {
  assert.deepEqual(
    SELECTABLE_PERMISSION_MODES.map((m) => m.value),
    ["bypassPermissions", "dontAsk", "plan"],
  );
  const byValue = Object.fromEntries(PERMISSION_MODES.map((m) => [m.value, m]));
  for (const asking of ["default", "acceptEdits", "auto"]) {
    assert.equal(byValue[asking].selectable, false, asking);
    assert.match(byValue[asking].label, /legacy/, asking);
    assert.equal(isLegacyPermissionMode(asking), true, asking);
  }
  assert.equal(isLegacyPermissionMode("dontAsk"), false);
  assert.equal(isLegacyPermissionMode(null), false);
});
