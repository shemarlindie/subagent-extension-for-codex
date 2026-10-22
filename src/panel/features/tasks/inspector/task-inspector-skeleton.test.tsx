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

test("disables the composer while task data is unavailable", () => {
  const { view } = renderLoadingView();

  expect(
    (view.container.querySelector("#chat-composer") as HTMLTextAreaElement)
      .disabled,
  ).toBe(true);
});
