import { expect, onTestFinished, test } from "vitest";

import {
  deferred,
  flush,
  setup,
} from "../../../app/state/controller-test-harness";
import { pendingUpdates } from "./pending-update-tracker";

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

test.for(["before", "after"] as const)(
  "updates marked seen stay cleared when a view built before the mark arrives %s the refresh",
  async (order) => {
    const { controller, transport } = setup();
    onTestFinished(() => controller.dispose());
    transport.context = { panel_scope: { conversation_id: "parent-chat" } };
    let pending = [update(1)];
    const held = deferred<unknown>();
    let holding = true;

    transport.handler = (name, args) => {
      if (name === "view.pending") return { tasks: pending };

      if (name === "app_mark_updates_seen") {
        return { event_ids: args.event_ids };
      }

      if (name === "app_wait_for_updates" && args.wait_ms && holding) {
        holding = false;

        return held.promise;
      }

      return undefined;
    };

    await controller.start();
    await flush();
    expect(pendingUpdates(controller.getSnapshot())).toEqual([update(1)]);

    // The held wait's view, built when update 2 arrived.
    const older = {
      revision: "boot:2",
      view: {
        built_at: Date.now(),
        projects: transport.projects,
        list: { tasks: [] },
        pending: { tasks: [update(1), update(2)] },
      },
    };

    if (order === "before") {
      held.resolve(older);
      await flush();

      expect(pendingUpdates(controller.getSnapshot())).toEqual([
        update(1),
        update(2),
      ]);
    }

    // Marking changes the revision, and the form's submit refreshes.
    controller.open({ kind: "pending-updates" });
    pending = [];
    transport.revision = "boot:3";
    await controller.submit(() => controller.pendingUpdates.markSeen([1, 2]));

    if (order === "after") {
      held.resolve(older);
      await flush();
    }

    expect(pendingUpdates(controller.getSnapshot())).toEqual([]);
  },
);
