import { describe, expect, test } from "vitest";

import { canNavigate, DEFAULT_PAGE, parsePage } from "./pages";

describe("page identity", () => {
  test("accepts registered pages and rejects unknown URL values", () => {
    expect(DEFAULT_PAGE).toBe("tasks");
    expect(parsePage("tasks")).toBe("tasks");
    expect(parsePage("projects")).toBe("projects");

    for (const value of [
      null,
      "",
      "settings",
      "Projects",
      "constructor",
      "__proto__",
    ])
      expect(parsePage(value)).toBeUndefined();
  });
});

describe("page availability", () => {
  const global = { connected: true, scopeKnown: true, busy: false };

  test("projects requires a connected, resolved global scope", () => {
    expect(canNavigate(global, "projects")).toBe(true);

    for (const patch of [
      { conversation: "chat-1" },
      { connected: false },
      { scopeKnown: false },
    ]) {
      const state = { ...global, ...patch };
      expect(canNavigate(state, "projects")).toBe(false);
      expect(canNavigate(state, "tasks")).toBe(true);
    }
  });

  test("pending mutations and dialogs block navigation in both directions", () => {
    for (const page of ["tasks", "projects"] as const) {
      expect(canNavigate({ ...global, busy: true }, page)).toBe(false);

      expect(
        canNavigate({ ...global, dialog: { type: "settings" } }, page),
      ).toBe(false);
    }
  });
});
