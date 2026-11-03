import { expect, onTestFinished, test } from "vitest";

import {
  deferred,
  flush,
  setup,
} from "../../../app/state/controller-test-harness";
import { pendingUpdates } from "./pending-update-loader";

const update = (event_id: number) => ({
  task_id: "task-one",
  title: "Limit upload sizes",
  updates: [
    {
      event_id,
      kind: "reply",
      text: "Done.",
      timestamp: "2026-10-02T03:00:00Z",
    },
  ],
});

test("an older pending update read finishing late keeps the newer result", async () => {
  const { controller, transport } = setup();
  onTestFinished(() => controller.dispose());
  transport.context = { panel_scope: { conversation_id: "parent-chat" } };
  await controller.start();
  await flush();

  const older = deferred<unknown>(),
    newer = deferred<unknown>(),
    reads = [older.promise, newer.promise];

  transport.handler = (name) =>
    name === "app_list_pending_updates" ? reads.shift() : undefined;

  const first = controller.pendingUpdates.load(),
    second = controller.pendingUpdates.load();

  newer.resolve({ tasks: [update(2)] });
  await second;
  older.resolve({ tasks: [update(1)] });
  await first;

  expect(pendingUpdates(controller.getSnapshot())).toEqual([update(2)]);
});
