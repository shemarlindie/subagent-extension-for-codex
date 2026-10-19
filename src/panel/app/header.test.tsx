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

function setup(overrides: Partial<Snapshot> = {}) {
  onTestFinished(cleanup);

  const controller = new Controller(
    { embedded: true, dispose() {} } as Transport,
    { hidden: () => false, wide: () => false },
  );

  onTestFinished(() => controller.dispose());

  const state = {
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

  const delegate = vi.spyOn(controller, "delegate").mockResolvedValue();
  const settings = vi.spyOn(controller, "settings").mockResolvedValue();
  const newTask = vi.spyOn(controller.newTasks, "open").mockReturnValue();

  const view = render(
    <ControllerContext.Provider value={controller}>
      <Tooltip.Provider>
        <Header />
      </Tooltip.Provider>
    </ControllerContext.Provider>,
  );

  return {
    view,
    user: userEvent.setup(),
    addProject,
    delegate,
    settings,
    newTask,
  };
}

test("global header offers project scope and Manage without the thread title", () => {
  const { view } = setup();

  assert.ok(view.getByRole("combobox", { name: "Project scope" }));
  assert.ok(view.getByRole("button", { name: "Manage" }));
  expect(view.queryByText("Delegated Work")).toBeNull();
});

test("a healthy connection is announced without taking header space", () => {
  const { view } = setup();
  const status = view.getByRole("status");

  assert.equal(status.textContent, "Connected");
  assert.equal(status.className, "visually-hidden");
});

test.each([CONNECTION.reconnecting, CONNECTION.failed])(
  "the toolbar shows %s beside Refresh",
  (connection) => {
    const { view } = setup({ connection });
    const status = view.getByRole("status");

    assert.equal(status.textContent, connection);
    assert.equal(status.className, "connection");
    assert.ok(status.parentElement?.classList.contains("toolbar"));
  },
);

test("thread header shows settings and omits other global controls", async () => {
  const { view, user, settings } = setup({ conversation: "chat-1" });

  assert.ok(view.getByText("Delegated Work"));
  assert.equal(view.getByText("My project").tagName, "STRONG");
  expect(view.queryByRole("combobox", { name: "Project scope" })).toBeNull();
  expect(view.queryByRole("button", { name: "Manage" })).toBeNull();
  const settingsButton = view.getByRole("button", { name: "Settings" });
  expect(view.queryByRole("button", { name: "New task" })).toBeNull();

  await user.click(settingsButton);
  await waitFor(() => assert.equal(settings.mock.calls.length, 1));

  await user.click(view.getByRole("button", { name: "Panel actions" }));
  await view.findByRole("menuitem", { name: "Refresh" });
  const settingsItem = view.getByRole("menuitem", { name: "Settings" });
  expect(view.queryByRole("menuitem", { name: "New task" })).toBeNull();
  expect(view.queryByRole("menuitem", { name: "Advanced task…" })).toBeNull();

  await user.click(settingsItem);
  await waitFor(() => assert.equal(settings.mock.calls.length, 2));
});

test("thread header uses the repository basename for an unnamed project", () => {
  const { view } = setup({ conversation: "chat-1", projects: [] });

  assert.equal(view.getByText("repo").tagName, "STRONG");
});

test("Add chat project is the first menu action and invokes registration", async () => {
  const { view, user, addProject } = setup({
    conversation: "chat-1",
    projectCandidate: "/repo",
  });

  await user.click(view.getByRole("button", { name: "Panel actions" }));

  const action = await view.findByRole("menuitem", {
    name: "Add chat project",
  });

  expect(view.getAllByRole("menuitem")[0]).toBe(action);
  await user.click(action);
  assert.equal(addProject.mock.calls.length, 1);
});

test.each([{ connected: false }, { scopeKnown: false }, { busy: true }])(
  "Add chat project stays disabled with %j",
  async (blocked) => {
    const { view, user, addProject } = setup({
      conversation: "chat-1",
      projectCandidate: "/repo",
      ...blocked,
    });

    assert.equal(
      (
        view.getByRole("button", {
          name: "Add chat project",
        }) as HTMLButtonElement
      ).disabled,
      true,
    );

    await user.click(view.getByRole("button", { name: "Panel actions" }));

    const action = await view.findByRole("menuitem", {
      name: "Add chat project",
    });

    assert.equal(action.getAttribute("aria-disabled"), "true");
    await user.click(action);
    assert.equal(addProject.mock.calls.length, 0);
  },
);

test("New task opens the composer and its menu opens the Advanced task dialog", async () => {
  const { view, user, delegate, newTask } = setup();

  await user.click(view.getByRole("button", { name: "New task" }));
  assert.equal(newTask.mock.calls.length, 1);
  assert.equal(delegate.mock.calls.length, 0);

  await user.click(
    view.getByRole("button", { name: "More ways to start a task" }),
  );

  await user.click(
    await view.findByRole("menuitem", { name: /^Advanced task…/ }),
  );

  await waitFor(() => assert.equal(delegate.mock.calls.length, 1));
});

test.each(["Settings", "New task", "Advanced task…"] as const)(
  "global menu invokes %s without offering unsupported expansion",
  async (label) => {
    const { view, user, delegate, settings, newTask } = setup();
    const calls = { Settings: settings, "New task": newTask };

    expect(view.queryByRole("button", { name: "Expand" })).toBeNull();
    await user.click(view.getByRole("button", { name: "Panel actions" }));

    const action = await view.findByRole("menuitem", { name: label });

    expect(view.queryByRole("menuitem", { name: "Expand" })).toBeNull();

    expect(
      view.queryByRole("menuitem", { name: "Add chat project" }),
    ).toBeNull();

    await user.click(action);

    await waitFor(() =>
      assert.equal(
        (label === "Advanced task…" ? delegate : calls[label]).mock.calls
          .length,
        1,
      ),
    );
  },
);
