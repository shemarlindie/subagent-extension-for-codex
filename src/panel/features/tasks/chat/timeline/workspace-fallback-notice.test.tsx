// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test } from "vitest";

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
  expect(screen.queryByText(/Not isolated/)).toBeNull();
  first.unmount();

  render(<WorkspaceFallbackNotice task={task("a", "no_git")} />);
  expect(screen.queryByText(/Not isolated/)).toBeNull();
  cleanup();

  render(<WorkspaceFallbackNotice task={task("b", "no_commits")} />);
  screen.getByText(/This repository has no commits/);
});

test("a task with no fallback shows no notice", () => {
  render(<WorkspaceFallbackNotice task={task("c")} />);
  expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
});
