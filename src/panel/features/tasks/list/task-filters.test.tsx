// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import { test } from "vitest";

import { Controller } from "../../../app/state/controller";
import { ControllerContext } from "../../../app/state/controller-context";
import type { Transport } from "../../../app/state/types";
import { TaskFilters } from "./task-filters";

test("filter counts stay unresolved until the first task list read", (t) => {
  const controller = new Controller(
    { embedded: true, dispose() {} } as unknown as Transport,
    { hidden: () => false, wide: () => true },
  );

  t.onTestFinished(() => {
    cleanup();
    controller.dispose();
  });

  const view = render(
    <ControllerContext.Provider value={controller}>
      <TaskFilters />
    </ControllerContext.Provider>,
  );

  const all = screen.getByRole("radio", { name: "All, loading" });

  assert.equal(
    view.container.querySelector(".filters")?.getAttribute("aria-busy"),
    "true",
  );

  assert.equal(all.getAttribute("aria-label"), "All, loading");
  assert.equal(screen.queryByRole("radio", { name: "All, 0" }), null);
});
