import assert from "node:assert/strict";
import test from "node:test";

import {
  TOOL_POLICY_ENV_KEY,
  TOOL_POLICY_PRESETS,
  addToolRules,
  isValidToolRule,
  parseToolRules,
  readToolPolicy,
  withToolPolicy,
} from "./toolPolicy.ts";

test("isValidToolRule: Claude Code rule syntax only", () => {
  for (const ok of [
    "Write",
    "Bash(git push:*)",
    "Edit(src/**)",
    "mcp__github__push",
    "WebFetch(domain:example.com)",
  ]) {
    assert.ok(isValidToolRule(ok), ok);
  }
  for (const bad of [
    "",
    "rm -rf",
    "Bash(unclosed",
    "Bash(a)(b)",
    "Tool(x) extra",
  ]) {
    assert.equal(isValidToolRule(bad), false, JSON.stringify(bad));
  }
});

test("parseToolRules: one rule per line, deduped, invalid lines reported", () => {
  assert.deepEqual(
    parseToolRules("Write\n\n Bash(git push:*) \nWrite\nrm -rf\n"),
    {
      rules: ["Write", "Bash(git push:*)"],
      invalid: ["rm -rf"],
    },
  );
});

test("readToolPolicy / withToolPolicy round-trip through the env var; empty removes the key", () => {
  const env = withToolPolicy(
    { OTHER: "x" },
    { allow: ["Bash(pnpm test:*)"], deny: ["Write"] },
  );
  assert.equal(
    env[TOOL_POLICY_ENV_KEY],
    '{"allow":["Bash(pnpm test:*)"],"deny":["Write"]}',
  );
  assert.deepEqual(readToolPolicy(env), {
    allow: ["Bash(pnpm test:*)"],
    deny: ["Write"],
  });
  const cleared = withToolPolicy(env, { allow: [], deny: [] });
  assert.deepEqual(cleared, { OTHER: "x" });
  // Garbage in the env never throws; invalid rules are dropped.
  assert.deepEqual(readToolPolicy({ [TOOL_POLICY_ENV_KEY]: "not json" }), {
    allow: [],
    deny: [],
  });
  assert.deepEqual(
    readToolPolicy({ [TOOL_POLICY_ENV_KEY]: '{"deny":["Write","rm -rf",3]}' }),
    {
      allow: [],
      deny: ["Write"],
    },
  );
  assert.deepEqual(readToolPolicy(null), { allow: [], deny: [] });
});

test("presets are valid rules and addToolRules dedupes", () => {
  for (const preset of TOOL_POLICY_PRESETS) {
    for (const rule of preset.deny) assert.ok(isValidToolRule(rule), rule);
  }
  assert.deepEqual(addToolRules(["Write"], ["Write", "Edit"]), [
    "Write",
    "Edit",
  ]);
});
