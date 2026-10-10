// @vitest-environment jsdom
import assert from "node:assert/strict";

import { Tooltip } from "@base-ui/react/tooltip";
import { cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { onTestFinished, test, vi } from "vitest";

import { Header } from "./header";
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

  const view = render(
    <ControllerContext.Provider value={controller}>
      <Tooltip.Provider>
        <Header />
      </Tooltip.Provider>
    </ControllerContext.Provider>,
  );

  return { view, user: userEvent.setup(), addProject, delegate, settings };
}

test("global header offers project scope and Browse without the thread title", () => {
  const { view } = setup();

  assert.equal(view.getByRole("status").textContent, "Connected");
  assert.ok(view.getByRole("combobox", { name: "Project scope" }));
  assert.ok(view.getByRole("button", { name: "Browse" }));
  assert.equal(view.queryByText("Delegated Work"), null);
});

test("thread header shows settings and omits other global controls", async () => {
  const { view, user, settings } = setup({ conversation: "chat-1" });

  assert.ok(view.getByText("Delegated Work"));
  assert.equal(view.getByText("My project").tagName, "STRONG");
  assert.equal(view.queryByRole("combobox", { name: "Project scope" }), null);
  assert.equal(view.queryByRole("button", { name: "Browse" }), null);
  const settingsButton = view.getByRole("button", { name: "Settings" });
  assert.equal(view.queryByRole("button", { name: "New Task" }), null);

  await user.click(settingsButton);
  await waitFor(() => assert.equal(settings.mock.calls.length, 1));

  await user.click(view.getByRole("button", { name: "Panel actions" }));
  await view.findByRole("menuitem", { name: "Refresh" });
  const settingsItem = view.getByRole("menuitem", { name: "Settings" });
  assert.equal(view.queryByRole("menuitem", { name: "New Task" }), null);

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

  assert.equal(view.getAllByRole("menuitem")[0], action);
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

test.each(["Settings", "New Task"] as const)(
  "global menu invokes %s without offering unsupported expansion",
  async (label) => {
    const { view, user, delegate, settings } = setup();

    assert.equal(view.queryByRole("button", { name: "Expand" }), null);
    await user.click(view.getByRole("button", { name: "Panel actions" }));

    const action = await view.findByRole("menuitem", { name: label });

    assert.equal(view.queryByRole("menuitem", { name: "Expand" }), null);

    assert.equal(
      view.queryByRole("menuitem", { name: "Add chat project" }),
      null,
    );

    await user.click(action);

    await waitFor(() =>
      assert.equal(
        (label === "Settings" ? settings : delegate).mock.calls.length,
        1,
      ),
    );
  },
);
