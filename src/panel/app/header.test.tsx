// @vitest-environment jsdom
import assert from "node:assert/strict";

import { Tooltip } from "@base-ui/react/tooltip";
import { cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";

import { Header } from "./header";
import { CONNECTION } from "./state/connection";
import { Controller } from "./state/controller";
import { ControllerContext } from "./state/controller-context";
import type { Snapshot, Transport } from "./state/types";

function setup(overrides: Partial<Snapshot> = {}, railCollapsed = false) {
  onTestFinished(cleanup);

  const controller = new Controller(
    { embedded: true, dispose() {} } as Transport,
    { hidden: () => false, wide: () => false },
  );

  onTestFinished(() => controller.dispose());

  const state: Snapshot = {
    ...controller.getSnapshot(),
    connected: true,
    scopeKnown: true,
    connection: "Connected",
    repository: "/repo",
    projects: [{ repository: "/repo", name: "My project", kind: "repository" }],
    ...overrides,
  };

  vi.spyOn(controller, "getSnapshot").mockReturnValue(state);

  const addProject = vi
    .spyOn(controller, "addProject")
    .mockImplementation(() => {});

  const settings = vi.spyOn(controller, "settings").mockResolvedValue();

  const toggleRail = vi.fn();

  const view = render(
    <ControllerContext.Provider value={controller}>
      <Tooltip.Provider>
        <Header
          taskRail={{
            collapsed: railCollapsed,
            toggle: toggleRail,
            narrow: false,
          }}
        />
      </Tooltip.Provider>
    </ControllerContext.Provider>,
  );

  return {
    view,
    user: userEvent.setup(),
    addProject,
    settings,
    toggleRail,
  };
}

test("the task list toggle names the action it takes and reports whether the list is open", async () => {
  const open = setup();
  const hide = open.view.getByRole("button", { name: "Hide task list" });

  expect(hide.getAttribute("aria-expanded")).toBe("true");
  await open.user.click(hide);
  expect(open.toggleRail).toHaveBeenCalledTimes(1);
  cleanup();

  const collapsed = setup({}, true);
  const show = collapsed.view.getByRole("button", { name: "Show task list" });

  expect(show.getAttribute("aria-expanded")).toBe("false");
});

test("connection changes announce the new status", () => {
  const { view } = setup({ connection: CONNECTION.reconnecting });
  assert.equal(view.getByRole("status").textContent, CONNECTION.reconnecting);
});

test("thread header offers settings and new tasks without the project scope", async () => {
  const { view, user, settings } = setup({ conversation: "chat-1" });

  assert.ok(view.getByText("Delegated Work"));
  expect(view.queryByRole("combobox", { name: "Project scope" })).toBeNull();
  const settingsButton = view.getByRole("button", { name: "Settings" });
  assert.ok(view.getByRole("button", { name: "New task" }));

  await user.click(settingsButton);
  await waitFor(() => assert.equal(settings.mock.calls.length, 1));

  await user.click(view.getByRole("button", { name: "Panel actions" }));
  const settingsItem = await view.findByRole("menuitem", { name: "Settings" });
  assert.ok(view.getByRole("menuitem", { name: "New task" }));

  await user.click(settingsItem);
  await waitFor(() => assert.equal(settings.mock.calls.length, 2));
});

test("Allow tasks here invokes registration from the menu", async () => {
  const { view, user, addProject } = setup({
    conversation: "chat-1",
    projectCandidate: "/repo",
  });

  await user.click(view.getByRole("button", { name: "Panel actions" }));

  const action = await view.findByRole("menuitem", {
    name: "Allow tasks here",
  });

  await user.click(action);
  assert.equal(addProject.mock.calls.length, 1);
});

test("Allow tasks here stays disabled until the scope is known", async () => {
  const { view, user, addProject } = setup({
    conversation: "chat-1",
    projectCandidate: "/repo",
    scopeKnown: false,
  });

  assert.equal(
    (
      view.getByRole("button", {
        name: "Allow tasks here",
      }) as HTMLButtonElement
    ).disabled,
    true,
  );

  await user.click(view.getByRole("button", { name: "Panel actions" }));

  const action = await view.findByRole("menuitem", {
    name: "Allow tasks here",
  });

  assert.equal(action.getAttribute("aria-disabled"), "true");
  await user.click(action);
  assert.equal(addProject.mock.calls.length, 0);
});

test("the plan usage meter shows the most-used window that has not reset", () => {
  const now = Math.floor(Date.now() / 1000);

  const usage = (session: number, weekly: number) => ({
    plan: "pro",
    windows: [
      {
        id: "five_hour",
        label: "5-hour window",
        utilization: session,
        resetsAt: now + 3600,
      },
      {
        id: "seven_day",
        label: "7-day window",
        utilization: weekly,
        resetsAt: now - 60,
      },
    ],
    read_at: Date.now(),
  });

  const meter = (planUsage?: Snapshot["planUsage"]) => {
    cleanup();

    return setup({ planUsage }).view.container.querySelector<HTMLElement>(
      "#plan-usage",
    );
  };

  expect(meter()).toBeNull();

  const normal = meter(usage(0.42, 0.9));
  expect(normal?.textContent).toBe("42%");
  expect(normal?.dataset.warning).toBeUndefined();

  expect(meter(usage(0.86, 0))?.dataset.warning).toBe("true");

  const limited = meter(usage(1, 0));
  expect(limited?.textContent).toMatch(/^Resets /);

  expect(limited?.getAttribute("aria-label")).toMatch(
    /^Plan usage: Limit reached for the 5-hour window\. Resets /,
  );
});
