import assert from "node:assert/strict";
import test from "node:test";

import {
  channelMemoKey,
  getChannelMemo,
  resetChannelMemoCache,
  setChannelMemo,
} from "./channelMemoStore.ts";

// Minimal localStorage double so the store's persistence path is exercised.
const backing = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (backing.has(k) ? backing.get(k) : null),
    setItem: (k, v) => backing.set(k, String(v)),
    removeItem: (k) => backing.delete(k),
  },
};

test("channelMemoKey scopes by relay origin and channel", () => {
  assert.equal(channelMemoKey("https://a", "ch"), "https://a::ch");
  assert.equal(channelMemoKey(null, "ch"), "unknown::ch");
  assert.notEqual(
    channelMemoKey("https://a", "ch"),
    channelMemoKey("https://b", "ch"),
  );
});

test("set/get round-trips through storage, blank content removes the key, and the cache reset re-reads", () => {
  const key = channelMemoKey("https://a", "ch1");
  assert.deepEqual(getChannelMemo(key), { content: "", updatedAt: 0 });
  const saved = setChannelMemo(key, "- ask about tests");
  assert.equal(saved.content, "- ask about tests");
  assert.ok(saved.updatedAt > 0);
  assert.ok(backing.has("buzz:channel-memo:https://a::ch1"));
  resetChannelMemoCache();
  assert.equal(getChannelMemo(key).content, "- ask about tests");
  setChannelMemo(key, "   ");
  assert.equal(backing.has("buzz:channel-memo:https://a::ch1"), false);
  resetChannelMemoCache();
  assert.deepEqual(getChannelMemo(key), { content: "", updatedAt: 0 });
});

test("corrupt storage never throws", () => {
  backing.set("buzz:channel-memo:https://a::bad", "{not json");
  resetChannelMemoCache();
  assert.deepEqual(getChannelMemo(channelMemoKey("https://a", "bad")), {
    content: "",
    updatedAt: 0,
  });
});
