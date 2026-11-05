import { expect, test } from "vitest";

import { workspaceNote } from "./workspace-note";

test("a read-only task or a project with a commit gets no note", () => {
  expect(
    workspaceNote({ git: "none", savedStrategy: "worktree", readOnly: true }),
  ).toBeUndefined();

  expect(workspaceNote({ git: "ready", readOnly: false })).toBeUndefined();
  expect(workspaceNote({ readOnly: false })).toBeUndefined();
});

test("a repository with no commits warns only when it loses a worktree default", () => {
  expect(
    workspaceNote({
      git: "no_commits",
      savedStrategy: "worktree",
      readOnly: false,
    })?.warning,
  ).toBe(true);

  expect(
    workspaceNote({
      git: "no_commits",
      savedStrategy: "current_repo",
      readOnly: false,
    })?.warning,
  ).toBe(false);
});
