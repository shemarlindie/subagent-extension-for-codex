// @vitest-environment jsdom
import { cleanup, render, within } from "@testing-library/react";
import { expect, onTestFinished, test, vi } from "vitest";

import { Controller } from "../../../../app/state/controller";
import { ControllerContext } from "../../../../app/state/controller-context";
import { task } from "../../../../app/state/controller-test-harness";
import type { Transport } from "../../../../app/state/types";
import { shortPermissionLabel } from "../../../delegation/permission-label";
import { TaskRunSettings } from "./task-run-settings";

function items(value: ReturnType<typeof task>) {
  onTestFinished(cleanup);

  const controller = new Controller(
    { embedded: true, dispose() {} } as unknown as Transport,
    { hidden: () => false, wide: () => false },
  );

  onTestFinished(() => controller.dispose());

  vi.spyOn(controller, "getSnapshot").mockReturnValue({
    ...controller.getSnapshot(),
    workers: [
      {
        provider: "claude",
        profiles: [],
        capabilities: {},
        models: [{ value: "haiku", displayName: "Haiku 4.5", description: "" }],
      },
    ],
  });

  const view = render(
    <ControllerContext.Provider value={controller}>
      <TaskRunSettings task={value} />
    </ControllerContext.Provider>,
  );

  return within(view.getByRole("list", { name: "Task settings" })).getAllByRole(
    "listitem",
  );
}

/** What assistive tech reads, leaving out the narrow-panel abbreviations. */
function shown(value: ReturnType<typeof task>) {
  return items(value).map((item) => {
    const copy = item.cloneNode(true) as HTMLElement;
    copy.querySelectorAll("[aria-hidden]").forEach((hidden) => hidden.remove());

    return copy.textContent.trim();
  });
}

/** The abbreviations narrow panels show; null marks a setting they drop. */
function compact(value: ReturnType<typeof task>) {
  return items(value).map((item) =>
    item.dataset.compact === "hidden"
      ? null
      : (item.querySelector(".task-run-setting-compact")?.textContent ??
        item.textContent.trim()),
  );
}

test("narrow panels abbreviate reasoning and permission", () => {
  expect(
    compact({
      ...task("a"),
      worker_profile: "researcher",
      model: "haiku",
      reasoning_effort: "medium",
    }),
  ).toEqual(["Researcher", "Haiku 4.5", "M", "Read"]);

  cleanup();

  expect(
    compact({
      ...task("a"),
      worker_profile: "general",
      reasoning_effort: "default",
      provider_options: { claude: { permission_mode: "default" } },
    }),
  ).toEqual(["General", "Default model", null, "Ask"]);
});

test("a task shows the profile, model, effort and permission it started with", () => {
  expect(
    shown({
      ...task("a"),
      worker_profile: "general",
      model: "claude-sonnet-5-5",
      reasoning_effort: "high",
      provider_options: { claude: { permission_mode: "acceptEdits" } },
    }),
  ).toEqual(["General", "claude-sonnet-5-5", "High", "Accept edits"]);
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
