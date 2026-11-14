import assert from "node:assert/strict";

import { expect, test, vi } from "vitest";

import type { Project } from "../../app/state/types";
import { projectUndoSteps } from "./project-undo";

function setup() {
  const tool = vi.fn(async (name: string, args: Record<string, unknown>) =>
    name === "list_projects" ? [] : { repository: args.repository },
  );

  const patch = vi.fn();

  return {
    tool,
    patch,
    steps: projectUndoSteps({ tool: tool as never, patch }),
  };
}

const project = (patch: Partial<Project> = {}): Project => ({
  repository: "/work/parser",
  name: "Parser tools",
  kind: "repository",
  ...patch,
});

test("a project with its folder's name needs no rename, and renames undo to the old name", async () => {
  const { tool, steps } = setup();

  const unchanged = steps.change(project({ name: "parser" }), undefined);
  assert.ok(unchanged);
  await unchanged.undo();

  expect(tool.mock.calls.map(([name]) => name)).toEqual([
    "app_register_project",
    "list_projects",
  ]);

  const rename = steps.change(project(), " Parser ");
  assert.ok(rename);
  expect(rename.label).toBe("Renamed project “Parser tools” to “Parser”");
  expect(rename.toast).toBeUndefined();
  await rename.undo();

  expect(tool).toHaveBeenCalledWith("app_rename_project", {
    repository: "/work/parser",
    name: "Parser tools",
  });
});

test("removing tasks, removing a parent folder grant and an unchanged name leave nothing to undo", () => {
  const { steps } = setup();

  expect(steps.change(project(), undefined, true)).toBeUndefined();
  expect(steps.change(project({ kind: "parent" }), undefined)).toBeUndefined();
  expect(steps.change(project(), "Parser tools")).toBeUndefined();
  expect(steps.change(undefined, undefined)).toBeUndefined();
});

test("undoing an added project removes its approval", async () => {
  const { tool, steps } = setup();
  const entry = steps.addition(project());

  expect(entry.label).toBe("Added project “Parser tools”");
  await entry.undo();

  expect(tool).toHaveBeenCalledWith("app_remove_project", {
    repository: "/work/parser",
    delete_tasks: false,
  });
});
