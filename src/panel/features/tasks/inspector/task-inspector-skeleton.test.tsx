// @vitest-environment jsdom
import { Tooltip } from "@base-ui/react/tooltip";
import { cleanup, render } from "@testing-library/react";
import { expect, onTestFinished, test } from "vitest";

import { Controller } from "../../../app/state/controller";
import { ControllerContext } from "../../../app/state/controller-context";
import type { Transport } from "../../../app/state/types";
import { EvidenceTabs } from "../evidence/evidence-tabs";

function renderLoadingView() {
  const controller = new Controller(
    { embedded: true, dispose() {} } as unknown as Transport,
    { hidden: () => false, wide: () => false },
  );

  onTestFinished(cleanup);
  onTestFinished(() => controller.dispose());

  return {
    controller,
    view: render(
      <ControllerContext.Provider value={controller}>
        <Tooltip.Provider>
          <EvidenceTabs taskId="task-1" />
        </Tooltip.Provider>
      </ControllerContext.Provider>,
    ),
  };
}

test("keeps the loaded tab structure while task data is unavailable", () => {
  const { view } = renderLoadingView();

  expect(view.getByRole("tablist", { name: "Task evidence" })).not.toBeNull();
  expect(view.getByRole("tab", { name: "Chat" })).not.toBeNull();
  expect(view.getByRole("tab", { name: "Changes" })).not.toBeNull();
  expect(view.getByRole("tab", { name: "Activity" })).not.toBeNull();
  expect(view.getByRole("tab", { name: "Details" })).not.toBeNull();
  expect(view.container.querySelector(".chat-skeleton")).not.toBeNull();

  expect(
    (view.container.querySelector("#chat-composer") as HTMLTextAreaElement)
      .disabled,
  ).toBe(true);
});
