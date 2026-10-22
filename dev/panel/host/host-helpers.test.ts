import { expect, test } from "vitest";

import type { Task } from "../../../src/shared/tasks/model";
import { PREVIEW_THREAD } from "../scenarios/fixtures";
import {
  fixtureCall,
  normalizeCwd,
  removeFixtureProject,
  type Settings,
  settingsFrom,
  threadsOf,
} from "./host-helpers";

const defaults: Settings = {
  source: "fixtures",
  launch: "thread",
  theme: "light",
  displayMode: "inline",
  width: "480",
  canSend: true,
  canShare: true,
  showInspector: false,
  threadId: PREVIEW_THREAD,
  cwd: "file:///repo",
  autoRegister: true,
  claudeUnavailable: false,
  successfulBudgetUpdates: false,
  slowAsyncReads: false,
  addedProjects: [],
  styles: "",
};

test("a typed cwd becomes the file URI Codex sends", () => {
  expect(normalizeCwd("  /repo/src ")).toBe("file:///repo/src");
  // Spaces, "#" and "?" are escaped so the path survives the round trip.
  const uri = normalizeCwd("/a b/#x?y");
  expect(uri).toBe("file:///a%20b/%23x%3Fy");
  expect(decodeURIComponent(new URL(uri).pathname)).toBe("/a b/#x?y");

  for (const kept of ["file:///repo", "", "relative/path"]) {
    expect(normalizeCwd(kept)).toBe(kept);
  }
});

test("saved current settings override defaults", () => {
  expect(
    settingsFrom(
      defaults,
      JSON.stringify({ cwd: "file:///saved", width: "fill" }),
    ),
  ).toEqual({ ...defaults, cwd: "file:///saved", width: "fill" });

  expect(settingsFrom(defaults, null)).toEqual(defaults);
  expect(settingsFrom(defaults, "not json")).toEqual(defaults);
});

test("slow fixture reads leave launch task rows to the delayed list read", () => {
  const opened = fixtureCall(
    "open_codex_subagent_extension",
    { conversation_id: PREVIEW_THREAD },
    { deferTaskList: true },
  );

  expect(opened.structuredContent).toHaveProperty("panel_scope");
  expect(opened.structuredContent).not.toHaveProperty("tasks");
});

test("threads are grouped by conversation, newest first", () => {
  const task = (
    conversation_id: string | undefined,
    title: string,
    at: number,
  ) =>
    ({
      conversation_id,
      title,
      created_at: new Date(Date.UTC(2026, 0, 1, 0, at)).toISOString(),
    }) as Task;

  expect(
    threadsOf([
      task("a", "First in a", 1),
      task("b", "Only in b", 2),
      task(undefined, "Console task", 9),
      task("a", "Latest in a", 3),
    ]),
  ).toEqual([
    { id: "a", latest: "Latest in a", tasks: 2 },
    { id: "b", latest: "Only in b", tasks: 1 },
  ]);
});

test("fixture removal drops the old name so re-registration uses its default", () => {
  const edits = {
    removed: ["/repo"],
    names: { "/repo": "Old name", "/other": "Other" },
  };

  expect(removeFixtureProject(edits, "/repo")).toEqual({
    removed: ["/repo"],
    names: { "/other": "Other" },
  });

  expect(edits.names["/repo"]).toBe("Old name");
});
