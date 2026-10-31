// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";

import { Controller } from "./state/controller";
import { ControllerContext } from "./state/controller-context";
import type { Transport } from "./state/types";
import { UndoToast } from "./undo-toast";

test("a failed undo warns and offers no step", async () => {
  onTestFinished(cleanup);

  const controller = new Controller(
    { embedded: true, dispose() {} } as unknown as Transport,
    { hidden: () => false, wide: () => false },
  );

  onTestFinished(() => controller.dispose());

  const view = render(
    <ControllerContext.Provider value={controller}>
      <UndoToast />
    </ControllerContext.Provider>,
  );

  act(() =>
    controller.undo.record({
      label: "Removed “Later” from the queue",
      toast: true,
      undo: () =>
        Promise.reject(new Error("That message is no longer queued.")),
      redo: vi.fn(async () => {}),
    }),
  );

  await userEvent.click(view.getByRole("button", { name: "Undo" }));

  const warning = await view.findByText(
    "Couldn't undo: That message is no longer queued.",
  );

  expect(warning.closest("[data-failed]")).toBeTruthy();
  expect(view.queryByRole("button", { name: /^(Undo|Redo)$/ })).toBeNull();
});
