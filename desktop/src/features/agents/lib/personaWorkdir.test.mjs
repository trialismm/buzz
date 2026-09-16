import assert from "node:assert/strict";
import test from "node:test";

import {
  PERSONA_WORKDIR_ENV_KEY,
  personaWorkdirHiddenEnvKeys,
  readPersonaWorkdir,
  withPersonaWorkdir,
} from "./personaWorkdir.ts";

test("the marker reads as own only when set to own", () => {
  assert.equal(readPersonaWorkdir({}), "shared");
  assert.equal(
    readPersonaWorkdir({ [PERSONA_WORKDIR_ENV_KEY]: " OWN " }),
    "own",
  );
  assert.equal(
    readPersonaWorkdir({ [PERSONA_WORKDIR_ENV_KEY]: "shared" }),
    "shared",
  );
});

test("writing own sets the marker and shared removes it, leaving other keys", () => {
  const own = withPersonaWorkdir({ A: "1" }, "own");
  assert.deepEqual(own, { A: "1", [PERSONA_WORKDIR_ENV_KEY]: "own" });
  const shared = withPersonaWorkdir(own, "shared");
  assert.deepEqual(shared, { A: "1" });
  assert.deepEqual(personaWorkdirHiddenEnvKeys(), [PERSONA_WORKDIR_ENV_KEY]);
});
