import { describe, expect, test } from "vitest";

import { canNavigate, DEFAULT_PAGE, parsePage } from "./pages";

describe("page identity", () => {
  test("accepts registered pages and rejects unknown URL values", () => {
    expect(DEFAULT_PAGE).toBe("tasks");
    expect(parsePage("tasks")).toBe("tasks");
    expect(parsePage("projects")).toBe("projects");
    expect(parsePage("settings")).toBe("settings");

    for (const value of [null, "", "Projects", "constructor", "__proto__"])
      expect(parsePage(value)).toBeUndefined();
  });
});

describe("page availability", () => {
  const global = {
    page: "tasks" as const,
    connected: true,
    scopeKnown: true,
    busy: false,
  };

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

  test("pending mutations and modal dialogs block navigation", () => {
    for (const page of ["tasks", "projects", "settings"] as const) {
      expect(canNavigate({ ...global, busy: true }, page)).toBe(false);

      expect(
        canNavigate({ ...global, dialog: { kind: "project" } }, page),
      ).toBe(false);
    }
  });

  test("settings page data does not block returning to tasks", () => {
    const settings = {
      ...global,
      page: "settings" as const,
      dialog: { kind: "settings" },
    };

    expect(canNavigate(settings, "tasks")).toBe(true);

    expect(
      canNavigate({ ...global, dialog: { kind: "settings" } }, "tasks"),
    ).toBe(false);
  });
});
