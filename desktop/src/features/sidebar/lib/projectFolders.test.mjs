import assert from "node:assert/strict";
import test from "node:test";

import {
  addProjectFolder,
  assignProjectToFolder,
  EMPTY_PROJECT_FOLDER_STORE,
  groupProjectsByFolder,
  parseProjectFolderStore,
  readProjectFolderStore,
  removeProjectFolder,
  renameProjectFolder,
  reorderProjectFolders,
  setProjectFolderCollapsed,
  writeProjectFolderStore,
} from "./projectFolders.ts";

const p = (projectAddress) => ({ projectAddress });

test("folders are added in order and blank names are ignored", () => {
  let store = addProjectFolder(EMPTY_PROJECT_FOLDER_STORE, "a", " Ongoing ");
  store = addProjectFolder(store, "b", "Pending", "⏳");
  assert.deepEqual(
    store.folders.map((f) => [f.id, f.name, f.order, f.icon]),
    [
      ["a", "Ongoing", 0, undefined],
      ["b", "Pending", 1, "⏳"],
    ],
  );
  assert.equal(addProjectFolder(store, "c", "   "), store);
  assert.equal(addProjectFolder(store, "a", "Dup"), store);
  assert.equal(renameProjectFolder(store, "a", "  "), store);
  assert.equal(
    renameProjectFolder(store, "a", "Active").folders[0].name,
    "Active",
  );
});

test("projects move between folders and fall out when a folder is removed", () => {
  let store = addProjectFolder(EMPTY_PROJECT_FOLDER_STORE, "a", "Ongoing");
  store = addProjectFolder(store, "b", "Killed");
  store = assignProjectToFolder(store, "p1", "a");
  store = assignProjectToFolder(store, "p2", "b");
  store = assignProjectToFolder(store, "p1", "b");
  assert.deepEqual(store.assignments, { p1: "b", p2: "b" });
  // Unknown folder behaves like "remove from folder".
  assert.deepEqual(assignProjectToFolder(store, "p2", "nope").assignments, {
    p1: "b",
  });
  assert.deepEqual(assignProjectToFolder(store, "p2", null).assignments, {
    p1: "b",
  });

  store = setProjectFolderCollapsed(store, "b", true);
  const removed = removeProjectFolder(store, "b");
  assert.deepEqual(
    removed.folders.map((f) => f.id),
    ["a"],
  );
  assert.deepEqual(removed.assignments, {});
  assert.deepEqual(removed.collapsed, {});
});

test("grouping keeps list order and puts unknown assignments in ungrouped", () => {
  let store = addProjectFolder(EMPTY_PROJECT_FOLDER_STORE, "a", "Ongoing");
  store = addProjectFolder(store, "b", "Pending");
  store = assignProjectToFolder(store, "p3", "a");
  store = assignProjectToFolder(store, "p1", "a");
  const grouped = groupProjectsByFolder([p("p1"), p("p2"), p("p3")], store);
  assert.deepEqual(grouped.ungrouped, [p("p2")]);
  assert.deepEqual(grouped.folders[0].projects, [p("p1"), p("p3")]);
  assert.deepEqual(grouped.folders[1].projects, []);
});

test("stored data is sanitised on read", () => {
  const parsed = parseProjectFolderStore({
    folders: [
      { id: "a", name: " Ongoing ", order: 2 },
      { id: "a", name: "dup" },
      { id: "", name: "no id" },
      { id: "b", name: "First", order: 1 },
      "junk",
    ],
    assignments: { p1: "a", p2: "gone", p3: 7 },
    collapsed: { a: true, gone: true, b: false },
  });
  assert.deepEqual(
    parsed.folders.map((f) => f.id),
    ["b", "a"],
  );
  assert.deepEqual(parsed.assignments, { p1: "a" });
  assert.deepEqual(parsed.collapsed, { a: true });
  assert.deepEqual(parseProjectFolderStore("nope"), EMPTY_PROJECT_FOLDER_STORE);
});

test("folders persist per relay and viewer", () => {
  const values = new Map();
  const previous = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  });
  try {
    const store = assignProjectToFolder(
      addProjectFolder(EMPTY_PROJECT_FOLDER_STORE, "a", "Ongoing"),
      "p1",
      "a",
    );
    writeProjectFolderStore(store, "https://relay.example", "viewer");
    assert.deepEqual(
      readProjectFolderStore("https://relay.example", "viewer").assignments,
      { p1: "a" },
    );
    assert.deepEqual(
      readProjectFolderStore("https://other.example", "viewer"),
      EMPTY_PROJECT_FOLDER_STORE,
    );
    assert.deepEqual(
      readProjectFolderStore("https://relay.example", "someone-else"),
      EMPTY_PROJECT_FOLDER_STORE,
    );
  } finally {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: previous,
    });
  }
});

test("reordering rewrites order, ignores unknown ids and keeps unlisted folders", () => {
  let store = addProjectFolder(EMPTY_PROJECT_FOLDER_STORE, "a", "Ongoing");
  store = addProjectFolder(store, "b", "Pending");
  store = addProjectFolder(store, "c", "Killed");
  const moved = reorderProjectFolders(store, ["c", "ghost", "a"]);
  assert.deepEqual(
    moved.folders.map((f) => [f.id, f.order]),
    [
      ["c", 0],
      ["a", 1],
      ["b", 2],
    ],
  );
});
