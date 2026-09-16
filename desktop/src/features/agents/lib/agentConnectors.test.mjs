import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_CONNECTORS_ENV_KEY,
  connectorErrors,
  connectorHiddenEnvKeys,
  connectorNameError,
  connectorTarget,
  formatArgs,
  formatKeyValueLines,
  parseArgs,
  parseKeyValueLines,
  readAgentConnectors,
  withAgentConnectors,
} from "./agentConnectors.ts";

const github = {
  kind: "stdio",
  name: "github",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-github"],
  env: { GITHUB_TOKEN: "t" },
};
const linear = {
  kind: "http",
  name: "linear",
  url: "https://mcp.linear.app/mcp?key=secret",
  headers: { Authorization: "Bearer x" },
};

test("connectors round-trip through the env key and an empty list removes it", () => {
  const env = withAgentConnectors({ OTHER: "1" }, [github, linear]);
  assert.equal(env.OTHER, "1");
  assert.deepEqual(readAgentConnectors(env), [github, linear]);
  const cleared = withAgentConnectors(env, []);
  assert.equal(AGENT_CONNECTORS_ENV_KEY in cleared, false);
  assert.deepEqual(connectorHiddenEnvKeys(), [AGENT_CONNECTORS_ENV_KEY]);
});

test("malformed or foreign entries read as none, not as a crash", () => {
  assert.deepEqual(readAgentConnectors({}), []);
  assert.deepEqual(
    readAgentConnectors({ [AGENT_CONNECTORS_ENV_KEY]: "{oops" }),
    [],
  );
  assert.deepEqual(
    readAgentConnectors({ [AGENT_CONNECTORS_ENV_KEY]: "{}" }),
    [],
  );
  const mixed = JSON.stringify([
    { kind: "sse", name: "x", url: "https://x" },
    { kind: "stdio", name: "  ", command: "x" },
    {
      kind: "stdio",
      name: "ok",
      command: " x ",
      args: [1, "a"],
      env: { A: "1", B: 2 },
    },
  ]);
  assert.deepEqual(readAgentConnectors({ [AGENT_CONNECTORS_ENV_KEY]: mixed }), [
    { kind: "stdio", name: "ok", command: "x", args: ["a"], env: { A: "1" } },
  ]);
});

test("names follow the harness rules", () => {
  assert.equal(connectorNameError("github", []), null);
  assert.equal(connectorNameError("my.server-2", []), null);
  assert.match(connectorNameError("", []), /required/);
  assert.match(connectorNameError("-bad", []), /letter or digit/);
  assert.match(connectorNameError("a b", []), /letters, digits/);
  assert.match(connectorNameError("a__b", []), /__/);
  assert.match(connectorNameError("buzz-dev-mcp", []), /built-in/);
  assert.match(connectorNameError("github", ["github"]), /already/);
  assert.equal(connectorNameError("x".repeat(64), []), null);
  assert.match(connectorNameError("x".repeat(65), []), /max 64/);
});

test("connector drafts report every problem", () => {
  assert.deepEqual(connectorErrors(github, []), []);
  assert.deepEqual(connectorErrors(linear, []), []);
  assert.deepEqual(connectorErrors({ ...github, name: "", command: " " }, []), [
    "Name is required.",
    "Command is required.",
  ]);
  assert.deepEqual(connectorErrors({ ...linear, url: "ftp://x" }, []), [
    "URL must start with http:// or https://.",
  ]);
});

test("argument text honours quotes both ways", () => {
  assert.deepEqual(parseArgs(`-y "My Dir" 'single q' plain`), [
    "-y",
    "My Dir",
    "single q",
    "plain",
  ]);
  assert.deepEqual(parseArgs("   "), []);
  assert.equal(formatArgs(["-y", "My Dir", ""]), `-y "My Dir" ""`);
  assert.deepEqual(parseArgs(formatArgs(["a b", "c"])), ["a b", "c"]);
});

test("key/value lines parse for env and headers", () => {
  const env = parseKeyValueLines("A=1\n\nB = two=2\nbroken\n", "=");
  assert.deepEqual(env.map, { A: "1", B: "two=2" });
  assert.deepEqual(env.invalid, ["broken"]);
  const headers = parseKeyValueLines("Authorization: Bearer x\nX-Id:1", ":");
  assert.deepEqual(headers.map, { Authorization: "Bearer x", "X-Id": "1" });
  assert.equal(formatKeyValueLines({ A: "1" }, "="), "A=1");
  assert.equal(formatKeyValueLines({ A: "1" }, ":"), "A: 1");
});

test("targets never include a query string or secret", () => {
  assert.equal(
    connectorTarget(github),
    "npx -y @modelcontextprotocol/server-github",
  );
  assert.equal(connectorTarget(linear), "https://mcp.linear.app/mcp");
  assert.equal(connectorTarget({ ...linear, url: "not a url" }), "not a url");
});
