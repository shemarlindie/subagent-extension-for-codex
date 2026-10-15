// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { expect, onTestFinished, test, vi } from "vitest";

import { Controller } from "../../../app/state/controller";
import { ControllerContext } from "../../../app/state/controller-context";
import { task } from "../../../app/state/controller-test-harness";
import type { Task, Transport } from "../../../app/state/types";
import { useUnreadTitle } from "./use-unread-title";

function Title() {
  useUnreadTitle();

  return null;
}

function setup(embedded: boolean) {
  onTestFinished(cleanup);
  document.title = "Delegated Work";

  const controller = new Controller(
    { embedded, dispose() {} } as unknown as Transport,
    { hidden: () => false, wide: () => false },
  );

  onTestFinished(() => controller.dispose());
  const snapshot = controller.getSnapshot();
  let current = snapshot;

  vi.spyOn(controller, "getSnapshot").mockImplementation(() => current);

  const app = () => (
    <ControllerContext.Provider value={controller}>
      <Title />
    </ControllerContext.Provider>
  );

  const view = render(app());

  const show = (tasks: Task[]) => {
    current = { ...snapshot, tasks };
    view.rerender(app());
  };

  return { show, view };
}

const unread = (id: string): Task => ({ ...task(id), unread: true });

test("the console's tab title leads with its unread task count", () => {
  const { show, view } = setup(false);
  expect(document.title).toBe("Delegated Work");

  show([unread("a"), unread("b"), task("c")]);
  expect(document.title).toBe("(2) Delegated Work");

  show([task("a")]);
  expect(document.title).toBe("Delegated Work");

  show([unread("a")]);
  view.unmount();
  expect(document.title).toBe("Delegated Work");
});

test("the embedded panel leaves its title to the host", () => {
  const { show } = setup(true);
  show([unread("a")]);
  expect(document.title).toBe("Delegated Work");
});
