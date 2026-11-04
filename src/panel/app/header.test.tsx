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
    settings,
  };
}

test("connection changes announce the new status", () => {
  const { view } = setup({ connection: CONNECTION.reconnecting });
  assert.equal(view.getByRole("status").textContent, CONNECTION.reconnecting);
});

test("thread header shows settings and omits other global controls", async () => {
  const { view, user, settings } = setup({ conversation: "chat-1" });

  assert.ok(view.getByText("Delegated Work"));
  expect(view.queryByRole("combobox", { name: "Project scope" })).toBeNull();
  const settingsButton = view.getByRole("button", { name: "Settings" });
  expect(view.queryByRole("button", { name: "New task" })).toBeNull();

  await user.click(settingsButton);
  await waitFor(() => assert.equal(settings.mock.calls.length, 1));

  await user.click(view.getByRole("button", { name: "Panel actions" }));
  const settingsItem = await view.findByRole("menuitem", { name: "Settings" });
  expect(view.queryByRole("menuitem", { name: "New task" })).toBeNull();
  expect(view.queryByRole("menuitem", { name: "Advanced task…" })).toBeNull();

  await user.click(settingsItem);
  await waitFor(() => assert.equal(settings.mock.calls.length, 2));
});

test("Allow tasks here names the path in its tooltip", async () => {
  const { view, user } = setup({
    conversation: "chat-1",
    projectCandidate: "/repo",
  });

  const action = view.getByRole("button", { name: "Allow tasks here" });

  assert.equal(action.getAttribute("title"), null);
  await user.hover(action);

  assert.match(
    (await view.findByRole("tooltip")).textContent ?? "",
    /Let tasks run and edit files in \/repo\. Stays allowed until you remove it in Manage projects\./,
  );
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

test.each([{ connected: false }, { scopeKnown: false }, { busy: true }])(
  "Allow tasks here stays disabled with %j",
  async (blocked) => {
    const { view, user, addProject } = setup({
      conversation: "chat-1",
      projectCandidate: "/repo",
      ...blocked,
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
  },
);
