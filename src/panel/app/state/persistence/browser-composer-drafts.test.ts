import { afterEach, expect, test, vi } from "vitest";

import { browserComposerDrafts } from "./browser-composer-drafts";

function memoryStorage(): Storage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

afterEach(() => vi.useRealTimers());

test("unavailable storage never interrupts draft reads, edits or clearing", () => {
  vi.useFakeTimers();
  const storage = memoryStorage();

  const unavailable = () => {
    throw new Error("Storage unavailable");
  };

  vi.spyOn(storage, "getItem").mockImplementation(unavailable);
  vi.spyOn(storage, "setItem").mockImplementation(unavailable);
  vi.spyOn(storage, "removeItem").mockImplementation(unavailable);
  const drafts = browserComposerDrafts(storage);

  expect(drafts.read("task", "one")).toBe("");
  expect(() => drafts.write("task", "one", "Unsent message")).not.toThrow();
  expect(drafts.read("task", "one")).toBe("Unsent message");
  expect(() => drafts.flush()).not.toThrow();
  drafts.write("task", "one", "Another edit");
  expect(() => drafts.write("task", "one", "")).not.toThrow();
  expect(() => vi.runAllTimers()).not.toThrow();
});

test("the latest pending edit wins, including clearing an already saved draft", () => {
  vi.useFakeTimers();
  const storage = memoryStorage();
  const drafts = browserComposerDrafts(storage);
  drafts.write("task", "one", "First edit");
  drafts.write("task", "one", "Latest edit");
  expect(drafts.read("task", "one")).toBe("Latest edit");
  vi.runAllTimers();

  expect(browserComposerDrafts(storage).read("task", "one")).toBe(
    "Latest edit",
  );

  drafts.write("task", "one", "Pending edit");
  drafts.write("task", "one", "");
  expect(drafts.read("task", "one")).toBe("");
  drafts.flush();
  expect(browserComposerDrafts(storage).read("task", "one")).toBe("");
  expect(storage.length).toBe(0);
  vi.runAllTimers();
  expect(storage.length).toBe(0);
});

test("task identifiers and the new-task scope keep independent drafts", () => {
  vi.useFakeTimers();
  const storage = memoryStorage();
  const drafts = browserComposerDrafts(storage);
  drafts.write("task", "one", "First task reply");
  drafts.write("task", "two", "Second task reply");
  drafts.write("newTask", "one", "New task request");
  drafts.flush();
  drafts.write("task", "one", "");
  drafts.flush();

  const restored = browserComposerDrafts(storage);
  expect(restored.read("task", "one")).toBe("");
  expect(restored.read("task", "two")).toBe("Second task reply");
  expect(restored.read("newTask", "one")).toBe("New task request");
});
