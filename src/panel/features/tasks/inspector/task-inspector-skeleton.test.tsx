// @vitest-environment jsdom
import { Tooltip } from "@base-ui/react/tooltip";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { expect, onTestFinished, test } from "vitest";

import { Controller } from "../../../app/state/controller";
import { ControllerContext } from "../../../app/state/controller-context";
import type { Transport } from "../../../app/state/types";
import { EvidenceTabs } from "../evidence/evidence-tabs";
import { TaskDetails } from "./task-details";
import { TaskHeaderSkeleton } from "./task-inspector-skeleton";

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

test("uses the same activity panel structure before and after task data loads", () => {
  const { view } = renderLoadingView();

  fireEvent.click(view.getByRole("tab", { name: "Activity" }));

  const panel = view.container.querySelector(
    '.evidence > [role="tabpanel"].activity-panel',
  );

  expect(
    panel?.querySelector(".activity-content .activity-skeleton"),
  ).not.toBeNull();

  expect(panel?.querySelector(".task-inspector-skeleton-panel")).toBeNull();
  expect(view.container.querySelector(".tabs .tab-indicator")).not.toBeNull();
});

test("shows a full Details-shaped skeleton until task data is available", () => {
  const header = render(<TaskHeaderSkeleton />);
  expect(header.container.querySelector(".task-topline")).not.toBeNull();
  expect(header.container.querySelector("h1.task-title")).not.toBeNull();
  cleanup();

  const details = render(<TaskDetails />);

  expect(
    details.container.querySelector(".task-details-skeleton .meta"),
  ).not.toBeNull();

  expect(
    details.container.querySelectorAll(
      ".task-details-skeleton .meta .skeleton-shape",
    ),
  ).toHaveLength(3);

  expect(
    details.container.querySelectorAll(
      ".task-details-skeleton .facts dt .skeleton-shape",
    ),
  ).toHaveLength(20);

  expect(
    details.container.querySelectorAll(
      ".task-details-skeleton .facts dd .skeleton-shape",
    ),
  ).toHaveLength(23);
});
