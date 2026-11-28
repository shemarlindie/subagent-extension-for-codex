import type { Task } from "../../../../shared/tasks/model.js";
import { MAX_VISUAL_CODE } from "../../../../shared/tasks/visual.js";
import type { Store } from "../storage/store.js";

/**
 * Records a visual the worker showed, numbering it after the task's earlier
 * ones. A replacement keeps the number of the visual it replaces.
 */
export const visualRecorder =
  (store: Store, t: Task) =>
  (title: string, code: string, replaces?: number) => {
    if (code.length > MAX_VISUAL_CODE) {
      throw new Error(
        `The code has ${code.length} characters, over the limit of ${MAX_VISUAL_CODE}.`,
      );
    }

    const shown = t.visuals ?? 0;

    if (
      replaces !== undefined &&
      (!Number.isInteger(replaces) || replaces < 1 || replaces > shown)
    ) {
      throw new Error(
        shown
          ? `There is no visual ${replaces}. This task has shown visuals 1 to ${shown}.`
          : `There is no visual ${replaces}. This task hasn't shown any visuals yet.`,
      );
    }

    const visual = replaces ?? shown + 1;

    store.transaction(() => {
      if (replaces === undefined) {
        t.visuals = visual;
        store.save(t);
      }

      store.event(t, "agent.visual", { visual, title, code });
    });

    return visual;
  };
