// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render } from "@testing-library/react";
import { afterEach, test, vi } from "vitest";

import { Controller } from "../../app/state/controller";
import { ControllerContext } from "../../app/state/controller-context";
import type { Transport } from "../../app/state/types";
import type { Worker } from "./types";
import { WorkerReadinessNotice } from "./worker-readiness-notice";

afterEach(cleanup);

function renderWith(workers: Worker[]) {
  const controller = new Controller(
    { embedded: true, dispose() {} } as Transport,
    { hidden: () => false, wide: () => false },
  );

  const snapshot = { ...controller.getSnapshot(), workers };
  vi.spyOn(controller, "getSnapshot").mockReturnValue(snapshot);

  return render(
    <ControllerContext.Provider value={controller}>
      <WorkerReadinessNotice />
    </ControllerContext.Provider>,
  );
}

test("a worker that can't start tasks shows its readiness message", () => {
  const message = "Claude Code 2.0.0 at /bin/claude is older than supported.";

  const view = renderWith([
    {
      provider: "claude",
      metadata: { displayName: "Claude" },
      profiles: ["reviewer"],
      capabilities: {},
      readiness: { ready: false, message, details: {} },
    },
  ]);

  const alert = view.getByRole("alert");
  assert.match(alert.textContent ?? "", /Claude can't start tasks/);
  assert.match(alert.textContent ?? "", new RegExp(message));
});

test("ready workers, and workers that don't report readiness, show nothing", () => {
  const view = renderWith([
    {
      provider: "claude",
      profiles: ["reviewer"],
      capabilities: {},
      readiness: { ready: true, details: {} },
    },
    { provider: "other", profiles: ["reviewer"], capabilities: {} },
  ]);

  assert.equal(view.queryByRole("alert"), null);
});
