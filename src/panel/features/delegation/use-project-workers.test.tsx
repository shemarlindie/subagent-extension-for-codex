// @vitest-environment jsdom
import assert from "node:assert/strict";

import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { onTestFinished, test } from "vitest";

import { ControllerContext } from "../../app/state/controller-context";
import {
  deferred,
  flush,
  setup,
} from "../../app/state/controller-test-harness";
import { useProjectWorkers } from "./use-project-workers";

test("global workers arriving during a folder's first read ask again", async () => {
  const { controller, transport } = setup();
  onTestFinished(() => controller.dispose());

  let ready = false;
  const firstRead = deferred<unknown>();

  const worker = () => ({
    provider: "claude",
    profiles: [],
    capabilities: {},
    readiness: ready
      ? { ready: true, details: {} }
      : { ready: false, message: "Claude Code not found", details: {} },
  });

  transport.handler = (name, args) => {
    if (name !== "list_workers") return undefined;
    if (args.repository && !ready) return firstRead.promise;

    return [worker()];
  };

  await controller.start();

  const { result } = renderHook(() => useProjectWorkers("/repo", []), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <ControllerContext.Provider value={controller}>
        {children}
      </ControllerContext.Provider>
    ),
  });

  // Claude becomes ready while the folder's record is still empty.
  ready = true;
  await controller.refresh();
  firstRead.resolve([]);
  await flush();

  await waitFor(() => assert.equal(result.current.pending, false));
  assert.equal(result.current.workers[0]?.readiness?.ready, true);
});
