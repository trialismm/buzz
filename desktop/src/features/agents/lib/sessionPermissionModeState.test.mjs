import assert from "node:assert/strict";
import test from "node:test";

import { resolveSessionPermissionMode } from "./sessionPermissionModeState.ts";

const KEY = "BUZZ_ACP_PERMISSION_MODE";

test("resolveSessionPermissionMode: session override wins over every configured tier", () => {
  assert.deepEqual(
    resolveSessionPermissionMode({
      override: "plan",
      instanceEnv: { [KEY]: "dontAsk" },
      personaEnv: { [KEY]: "bypassPermissions" },
      live: "dontAsk",
    }),
    { mode: "plan", source: "session" },
  );
});

test("resolveSessionPermissionMode: instance env beats persona env, persona beats the live capture", () => {
  assert.deepEqual(
    resolveSessionPermissionMode({
      override: null,
      instanceEnv: { [KEY]: "dontAsk" },
      personaEnv: { [KEY]: "plan" },
      live: "plan",
    }),
    { mode: "dontAsk", source: "instance" },
  );
  assert.deepEqual(
    resolveSessionPermissionMode({
      override: null,
      instanceEnv: {},
      personaEnv: { [KEY]: "plan" },
      live: "dontAsk",
    }),
    { mode: "plan", source: "persona" },
  );
});

test("resolveSessionPermissionMode: live capture only speaks when nothing is configured; else harness default", () => {
  assert.deepEqual(
    resolveSessionPermissionMode({
      override: null,
      instanceEnv: null,
      personaEnv: undefined,
      live: "plan",
    }),
    { mode: "plan", source: "live" },
  );
  assert.deepEqual(
    resolveSessionPermissionMode({
      override: null,
      instanceEnv: { OTHER: "x" },
      personaEnv: null,
      live: null,
    }),
    { mode: "bypassPermissions", source: "default" },
  );
});
