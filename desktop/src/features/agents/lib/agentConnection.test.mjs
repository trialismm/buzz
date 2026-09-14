import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_CONNECTION_ENV_KEY,
  connectionCatalogFor,
  connectionHiddenEnvKeys,
  parseAgentConnection,
  readAgentConnection,
  withAgentConnection,
} from "./agentConnection.ts";

test("catalog: claude and codex only, case-insensitive, codex needs an isolated home", () => {
  assert.equal(connectionCatalogFor("Claude").apiKeyEnv, "ANTHROPIC_API_KEY");
  assert.equal(connectionCatalogFor("codex").isolatedHome, true);
  assert.equal(connectionCatalogFor("claude").isolatedHome, false);
  assert.equal(connectionCatalogFor("goose"), null);
  assert.equal(connectionCatalogFor(""), null);
});

test("parseAgentConnection accepts the marker spellings and nothing else", () => {
  assert.equal(parseAgentConnection("api-key"), "api-key");
  assert.equal(parseAgentConnection("APIKEY"), "api-key");
  assert.equal(parseAgentConnection("subscription"), "subscription");
  assert.equal(parseAgentConnection("oauth"), null);
  assert.equal(parseAgentConnection(undefined), null);
});

test("read/with round-trip: subscription clears both keys, api-key stores marker + key", () => {
  const withKey = withAgentConnection(
    { OTHER: "x" },
    "claude",
    "api-key",
    " sk-ant-abc ",
  );
  assert.deepEqual(withKey, {
    OTHER: "x",
    [AGENT_CONNECTION_ENV_KEY]: "api-key",
    ANTHROPIC_API_KEY: "sk-ant-abc",
  });
  assert.deepEqual(readAgentConnection(withKey, "claude"), {
    mode: "api-key",
    apiKey: "sk-ant-abc",
    entry: connectionCatalogFor("claude"),
  });
  // An empty key keeps the marker (the field shows the requirement) but no key var.
  const pending = withAgentConnection(withKey, "claude", "api-key", "");
  assert.equal(pending[AGENT_CONNECTION_ENV_KEY], "api-key");
  assert.equal("ANTHROPIC_API_KEY" in pending, false);
  const back = withAgentConnection(
    withKey,
    "claude",
    "subscription",
    "ignored",
  );
  assert.deepEqual(back, { OTHER: "x" });
  assert.equal(readAgentConnection(back, "claude").mode, "subscription");
  // Unknown runtime: no key var is ever written.
  assert.deepEqual(withAgentConnection({}, "goose", "api-key", "k"), {});
});

test("hidden env keys cover the marker and the runtime's key var", () => {
  assert.deepEqual(connectionHiddenEnvKeys("codex"), [
    AGENT_CONNECTION_ENV_KEY,
    "OPENAI_API_KEY",
  ]);
  assert.deepEqual(connectionHiddenEnvKeys("goose"), [
    AGENT_CONNECTION_ENV_KEY,
  ]);
});
