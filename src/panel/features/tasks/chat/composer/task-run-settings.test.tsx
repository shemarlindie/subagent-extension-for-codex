// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { expect, onTestFinished, test, vi } from "vitest";

import { ControllerContext } from "../../../../app/state/controller-context";
import { setup, task } from "../../../../app/state/controller-test-harness";
import type { Task } from "../../../../app/state/types";
import { TaskRunSettings } from "./task-run-settings";

function settingsOf(overrides: Partial<Task>, effective: object) {
  const { controller } = setup();

  vi.spyOn(controller, "getSnapshot").mockReturnValue({
    ...controller.getSnapshot(),
    workers: [
      {
        provider: "claude",
        profiles: [],
        capabilities: {},
        models: [
          {
            value: "opus",
            resolvedModel: "claude-opus-5-5",
            displayName: "Opus 5.5",
            description: "",
          },
        ],
      },
    ],
  });

  onTestFinished(cleanup);
  onTestFinished(() => controller.dispose());

  const current: Task = {
    ...task("task-1"),
    ...overrides,
    provider_options: {
      claude: {
        permission_mode: "default",
        approval_decider: "user",
        permission_source: "setting",
        claude_policy: {
          sandbox: false,
          subagents: true,
          settings_files: true,
          user_mcp: true,
        },
        effective,
      },
    },
  };

  const view = render(
    <ControllerContext.Provider value={controller}>
      <TaskRunSettings task={current} />
    </ControllerContext.Provider>,
  );

  return {
    list: view.getByRole("list", { name: "Task settings" }),
    // The summary item names what the task started with, and its tooltip shows it.
    summary: view.getByRole("listitem", { name: /^Set when the task started/ }),
  };
}

test("a Default task names what it ran, without a requested line", () => {
  const { list, summary } = settingsOf(
    { model: "default", reasoning_effort: "default" },
    { model: "claude-opus-5-5", effort: "medium" },
  );

  expect(list.textContent).toContain("Opus 5.5");
  expect(list.textContent).toContain("Medium");
  expect(summary.getAttribute("aria-label")).not.toContain("Requested");
});

test("an explicit choice Claude Code changed lists what was requested", () => {
  const { summary } = settingsOf(
    { model: "sonnet", reasoning_effort: "xhigh" },
    { model: "claude-opus-5-5", effort: "high" },
  );

  expect(summary.getAttribute("aria-label")).toContain(
    "Requested: sonnet, Xhigh reasoning",
  );
});
