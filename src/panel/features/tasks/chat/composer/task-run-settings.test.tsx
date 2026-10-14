// @vitest-environment jsdom
import { cleanup, render, within } from "@testing-library/react";
import { expect, onTestFinished, test } from "vitest";

import { task } from "../../../../app/state/controller-test-harness";
import { shortPermissionLabel } from "../../../delegation/permission-label";
import { TaskRunSettings } from "./task-run-settings";

function shown(value: ReturnType<typeof task>) {
  onTestFinished(cleanup);
  const view = render(<TaskRunSettings task={value} />);

  return within(view.getByRole("list", { name: "Task settings" }))
    .getAllByRole("listitem")
    .map((item) => item.textContent.trim());
}

test("a task shows the profile, model, effort and permission it started with", () => {
  expect(
    shown({
      ...task("a"),
      worker_profile: "general",
      model: "claude-sonnet-5-5",
      reasoning_effort: "high",
      provider_options: { claude: { permission_mode: "acceptEdits" } },
    }),
  ).toEqual(["General", "claude-sonnet-5-5", "High effort", "Accept edits"]);
});

test("defaults and read-only profiles read plainly", () => {
  expect(
    shown({
      ...task("a"),
      worker_profile: "reviewer",
      reasoning_effort: "default",
    }),
  ).toEqual(["Reviewer", "Default model", "Default effort", "Read only"]);
});

test.each([
  ["Default — ask for approval", "Ask for approval"],
  ["Plan — read only", "Plan"],
  ["Use extension setting", "Extension setting"],
  ["Accept edits", "Accept edits"],
])("permission label %s reads %s", (label, short) => {
  expect(shortPermissionLabel(label)).toBe(short);
});
