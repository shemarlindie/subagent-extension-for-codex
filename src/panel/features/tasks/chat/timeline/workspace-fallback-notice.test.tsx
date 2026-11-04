// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, test } from "vitest";

import type { Task } from "../../../../app/state/types";
import { WorkspaceFallbackNotice } from "./workspace-fallback-notice";

const task = (id: string, workspace_fallback?: Task["workspace_fallback"]) =>
  ({ id, workspace_fallback }) as Task;

beforeEach(() => localStorage.clear());
afterEach(cleanup);

test("a dismissed notice stays hidden after a reload and other tasks keep theirs", async () => {
  const user = userEvent.setup();
  const first = render(<WorkspaceFallbackNotice task={task("a", "no_git")} />);

  screen.getByText(/This folder has no Git/);
  await user.click(screen.getByRole("button", { name: "Dismiss" }));
  assert.equal(screen.queryByText(/Not isolated/), null);
  first.unmount();

  render(<WorkspaceFallbackNotice task={task("a", "no_git")} />);
  assert.equal(screen.queryByText(/Not isolated/), null);
  cleanup();

  render(<WorkspaceFallbackNotice task={task("b", "no_commits")} />);
  screen.getByText(/This repository has no commits/);
});

test("a task that kept its worktree or had none to lose shows no notice", () => {
  render(<WorkspaceFallbackNotice task={task("c")} />);
  assert.equal(screen.queryByText(/Not isolated/), null);
});
