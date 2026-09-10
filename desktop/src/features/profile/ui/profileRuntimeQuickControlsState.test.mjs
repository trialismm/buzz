import assert from "node:assert/strict";
import test from "node:test";
import {
  currentRuntimeEntry,
  modelWriteTarget,
  personaEnvVarsUpdateInput,
  personaModelUpdateInput,
  profileRuntimeQuickControlsState,
  restartNoticeFor,
} from "./profileRuntimeQuickControlsState.ts";

const runtimeLabel = (command) =>
  ({ "claude-agent-acp": "Claude Code", goose: "Goose" })[command] ?? command;

test("hides the quick controls for anyone but the owner of a local record", () => {
  const cases = [
    { isOwner: false, managedAgent: { agentCommand: "goose" } },
    { isOwner: undefined, managedAgent: { agentCommand: "goose" } },
    { isOwner: true, managedAgent: undefined },
  ];
  for (const input of cases) {
    const state = profileRuntimeQuickControlsState({
      ...input,
      canEditAgent: true,
      runtimeLabel,
    });
    assert.deepEqual(
      state,
      { visible: false, harness: null },
      JSON.stringify(input),
    );
  }
});

test("labels the harness pill from the reported command and edit permission", () => {
  const cases = [
    {
      agentCommand: "claude-agent-acp",
      canEditAgent: true,
      label: "Claude Code",
      editable: true,
    },
    {
      agentCommand: "goose",
      canEditAgent: false,
      label: "Goose",
      editable: false,
    },
    {
      agentCommand: "./bin/custom-harness",
      canEditAgent: true,
      label: "./bin/custom-harness",
      editable: true,
    },
  ];
  for (const { agentCommand, canEditAgent, label, editable } of cases) {
    const state = profileRuntimeQuickControlsState({
      managedAgent: { agentCommand },
      isOwner: true,
      canEditAgent,
      runtimeLabel,
    });
    assert.equal(state.visible, true);
    assert.deepEqual(state.harness, { label, editable }, agentCommand);
  }
});

test("omits the harness pill instead of inventing one when no command is reported", () => {
  for (const agentCommand of ["", "   "]) {
    const state = profileRuntimeQuickControlsState({
      managedAgent: { agentCommand },
      isOwner: true,
      canEditAgent: true,
      runtimeLabel,
    });
    assert.deepEqual(state, { visible: true, harness: null });
  }
});

test("currentRuntimeEntry matches by command first, then by id, never on blank", () => {
  const runtimes = [
    { id: "claude", command: "claude-agent-acp" },
    { id: "goose", command: "goose" },
    { id: "codex", command: null },
  ];
  assert.equal(
    currentRuntimeEntry(runtimes, "claude-agent-acp ")?.id,
    "claude",
  );
  assert.equal(currentRuntimeEntry(runtimes, "codex")?.id, "codex");
  assert.equal(currentRuntimeEntry(runtimes, "unknown-cmd"), undefined);
  assert.equal(currentRuntimeEntry(runtimes, "  "), undefined);
});

test("modelWriteTarget sends linked agents to the persona and others to the instance", () => {
  const persona = { id: "builtin:fizz" };
  assert.deepEqual(modelWriteTarget({ personaId: null }, undefined), {
    kind: "instance",
  });
  assert.deepEqual(modelWriteTarget({ personaId: "builtin:fizz" }, undefined), {
    kind: "unavailable",
    reason: "personaNotLoaded",
  });
  assert.deepEqual(modelWriteTarget({ personaId: "builtin:fizz" }, persona), {
    kind: "persona",
    persona,
  });
});

test("personaModelUpdateInput echoes every stored field and changes only the model", () => {
  const persona = {
    id: "builtin:fizz",
    displayName: "국산레이더",
    avatarUrl: "data:image/png;base64,AAA",
    description: null,
    systemPrompt: "You are Fizz.",
    runtime: "claude",
    model: "sonnet",
    provider: null,
    namePool: ["Birch", "Ridge"],
  };
  const input = personaModelUpdateInput(persona, "haiku");
  assert.deepEqual(input, {
    id: "builtin:fizz",
    displayName: "국산레이더",
    avatarUrl: "data:image/png;base64,AAA",
    description: null,
    systemPrompt: "You are Fizz.",
    runtime: "claude",
    model: "haiku",
    provider: undefined,
    namePool: ["Birch", "Ridge"],
  });
  assert.equal(
    "envVars" in input,
    false,
    "envVars must stay absent (don't touch)",
  );
  assert.equal(
    "behavior" in input,
    false,
    "behavior must stay absent (don't touch)",
  );
  assert.notEqual(
    input.namePool,
    persona.namePool,
    "namePool is copied, not aliased",
  );
  assert.equal(
    personaModelUpdateInput({ ...persona, avatarUrl: null }, null).avatarUrl,
    undefined,
  );
  assert.equal(personaModelUpdateInput(persona, null).model, undefined);
});

test("restartNoticeFor never claims an immediate restart", () => {
  assert.deepEqual(
    restartNoticeFor({ status: "stopped", autoRestartOnConfigChange: true }),
    {
      kind: "nextStart",
    },
  );
  assert.deepEqual(
    restartNoticeFor({
      status: "not_deployed",
      autoRestartOnConfigChange: false,
    }),
    {
      kind: "nextStart",
    },
  );
  for (const status of ["running", "deployed"]) {
    const auto = restartNoticeFor({ status, autoRestartOnConfigChange: true });
    assert.equal(auto.kind, "autoRestart");
    assert.match(auto.description, /3 minutes idle/);
    assert.doesNotMatch(auto.description, /restarting/i);
    const manual = restartNoticeFor({
      status,
      autoRestartOnConfigChange: false,
    });
    assert.equal(manual.kind, "manualRestart");
  }
});

test("personaEnvVarsUpdateInput keeps the model and replaces only envVars", () => {
  const persona = {
    id: "builtin:fizz",
    displayName: "국산레이더",
    avatarUrl: null,
    description: "d",
    systemPrompt: "p",
    runtime: null,
    model: "sonnet",
    provider: null,
    namePool: [],
    envVars: { OLD: "1" },
  };
  const next = { BUZZ_ACP_PERMISSION_MODE: "acceptEdits" };
  const input = personaEnvVarsUpdateInput(persona, next);
  assert.equal(input.model, "sonnet");
  assert.deepEqual(input.envVars, next);
  assert.notEqual(input.envVars, next, "map is copied, not aliased");
  assert.equal(
    "behavior" in input,
    false,
    "behavior must stay absent (don't touch)",
  );
});
