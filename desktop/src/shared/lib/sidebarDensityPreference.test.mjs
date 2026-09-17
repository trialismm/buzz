import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SIDEBAR_DENSITY,
  getSidebarDensity,
  parseSidebarDensity,
  setSidebarDensity,
  SIDEBAR_DENSITY_STORAGE_KEY,
} from "./sidebarDensityPreference.ts";

test("unknown values fall back to the compact default", () => {
  assert.equal(DEFAULT_SIDEBAR_DENSITY, "compact");
  assert.equal(parseSidebarDensity("comfortable"), "comfortable");
  assert.equal(parseSidebarDensity("compact"), "compact");
  assert.equal(parseSidebarDensity("spacious"), "compact");
  assert.equal(parseSidebarDensity(null), "compact");
});

test("setting the density updates the live value and persists it", () => {
  const store = new Map();
  const previous = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
  };
  try {
    setSidebarDensity("comfortable");
    assert.equal(getSidebarDensity(), "comfortable");
    assert.equal(store.get(SIDEBAR_DENSITY_STORAGE_KEY), "comfortable");
    setSidebarDensity("compact");
    assert.equal(store.get(SIDEBAR_DENSITY_STORAGE_KEY), "compact");
  } finally {
    globalThis.localStorage = previous;
  }
});
