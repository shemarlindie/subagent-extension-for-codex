import { useCallback, useLayoutEffect, useRef, useState } from "react";

import { archivable } from "../../../../shared/tasks/archive.js";
import {
  useController,
  useSnapshot,
} from "../../../app/state/controller-context";
import type { Task } from "../../../app/state/types";
import { errorMessage } from "../../../shared/utils/error-message";
import {
  taskBatchWarning,
  type TaskBatchFailure,
} from "../controls/task-batches";
import { listedTask, visibleTasks } from "./selectors";

export type TaskRowClick = "open" | "toggle" | "range";

export type SelectionAction = "archive" | "read" | "unread";

type Selection = {
  ids: ReadonlySet<string>;
  anchor?: string;
  /** Tasks added by the current Shift range, excluding earlier selections. */
  range?: string[];
  notice?: string;
};

const eligible = {
  archive: archivable,
  read: (task: Task) => Boolean(task.unread),
  unread: (task: Task) => !task.unread,
};

function extendSelection(
  selection: Selection | undefined,
  shown: Task[],
  from: string | undefined,
  to: string,
): Selection {
  const ids = new Set(selection?.ids);
  const order = shown.map((task) => task.id);
  const anchor = from === undefined ? -1 : order.indexOf(from);
  const target = order.indexOf(to);

  if (anchor < 0 || target < 0) {
    ids.add(to);

    return { ids, anchor: to };
  }

  // Moving the range endpoint preserves independent picks and rows now hidden.
  const shownIds = new Set(order);

  for (const id of selection?.range ?? []) {
    if (shownIds.has(id)) ids.delete(id);
  }

  const range = order
    .slice(Math.min(anchor, target), Math.max(anchor, target) + 1)
    .filter((id) => !ids.has(id));

  for (const id of range) ids.add(id);

  return { ids, anchor: from, range };
}

/** Keeps bulk selection local to this list view and independent of the inspector. */
export function useTaskSelection(view: string, tasks: Task[], shown: Task[]) {
  const controller = useController();
  const [previousView, setPreviousView] = useState(view);
  const [selection, setSelection] = useState<Selection>();
  const [working, setWorking] = useState(false);
  // Selection waits while any change saves or an undo step runs.
  const blocked = Boolean(useSnapshot((state) => state.undoPending));
  const shownRows = useRef(shown);
  const lastOpenedRow = useRef<string>(undefined);

  // A stable row handler keeps memoized rows from rendering on every toggle.
  useLayoutEffect(() => {
    shownRows.current = shown;
  }, [shown]);

  useLayoutEffect(() => {
    lastOpenedRow.current = undefined;
  }, [view]);

  const selected = selection
    ? tasks.filter((task) => selection.ids.has(task.id))
    : [];

  if (view !== previousView) {
    setPreviousView(view);
    setSelection(undefined);
  } else if (
    !working &&
    selection &&
    (selected.length < selection.ids.size || !selected.length)
  ) {
    // Tasks that left the list drop out, and an empty selection ends.
    setSelection(
      selected.length
        ? { ...selection, ids: new Set(selected.map((task) => task.id)) }
        : undefined,
    );
  }

  const clickRow = useCallback(
    (id: string, action: TaskRowClick) => {
      if (action === "open") {
        lastOpenedRow.current = id;
        controller.run(() => controller.selection.select(id));

        return;
      }

      if (controller.getSnapshot().undoPending) return;

      const shown = shownRows.current;
      const opened = lastOpenedRow.current;
      lastOpenedRow.current = undefined;

      // A plain row click can start a range. A task opened elsewhere cannot.
      const anchor =
        opened === listedTask(controller.getSnapshot()) ? opened : undefined;

      setSelection((current) => {
        if (action === "range") {
          return extendSelection(
            current,
            shown,
            current ? current.anchor : anchor,
            id,
          );
        }

        const ids = new Set(current?.ids);
        if (ids.has(id)) ids.delete(id);
        else ids.add(id);

        return { ids, anchor: id };
      });
    },
    [controller],
  );

  const toggleShown = (checked: boolean) => {
    if (blocked) return;

    setSelection((current) => {
      if (!current) return current;
      const ids = new Set(current.ids);

      for (const { id } of shown) {
        if (checked) ids.add(id);
        else ids.delete(id);
      }

      return { ids, anchor: current.anchor };
    });
  };

  const apply = async (action: SelectionAction) => {
    if (!selection || controller.getSnapshot().undoPending) return;

    const current = visibleTasks(controller.getSnapshot());

    const targets = current.filter(
      (task) => selection.ids.has(task.id) && eligible[action](task),
    );

    if (!targets.length) return;

    setWorking(true);
    const pending = { ids: selection.ids, anchor: selection.anchor };
    setSelection(pending);
    const skipped = selection.ids.size - targets.length;

    const finish = (
      ids: ReadonlySet<string>,
      skipped: number,
      failure?: TaskBatchFailure,
    ) => {
      if (failure) {
        const count = failure.count === 1 ? "1 task" : `${failure.count} tasks`;

        const attempt =
          action === "archive" ? `archive ${count}` : `mark ${count} ${action}`;

        controller.reportActionFailure(
          `Could not ${attempt}. ${errorMessage(failure.error)}`,
        );
      }

      const notice = taskBatchWarning(skipped);

      setSelection((current) =>
        current === pending ? { ...pending, ids, notice } : current,
      );
    };

    try {
      if (action === "archive") {
        const result = await controller.taskActions.archive.setArchived(
          targets,
          true,
        );

        const ids = new Set(pending.ids);
        for (const id of result.task_ids) ids.delete(id);

        finish(ids, skipped + result.skipped.length, result.failure);
      } else {
        const result = await controller.taskActions.unread.setMany(
          targets,
          action === "read",
        );

        finish(pending.ids, skipped, result.failure);
      }
    } catch (error) {
      finish(pending.ids, skipped, { count: targets.length, error });
    } finally {
      setWorking(false);
    }
  };

  const exit = useCallback(() => setSelection(undefined), []);
  const shownCount = shown.filter((task) => selection?.ids.has(task.id)).length;
  const readCount = selected.filter(eligible.read).length;

  return {
    ids: selection?.ids,
    anchor: selection?.anchor,
    notice: selection?.notice,
    working,
    blocked,
    shownCount,
    hiddenCount: selected.length - shownCount,
    archiveCount: selected.filter(eligible.archive).length,
    readCount,
    unreadCount: selected.length - readCount,
    exit,
    clickRow,
    toggleShown,
    apply,
  };
}
