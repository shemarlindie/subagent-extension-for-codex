import { type SubmitEvent, useState } from "react";

import {
  useController,
  useSnapshot,
} from "../../../app/state/controller-context";
import { Button } from "../../../shared/components/button/button";
import { Checkbox } from "../../../shared/components/checkbox/checkbox";
import { defineDialog } from "../../../shared/dialogs/dialog-definition";
import { FormFooter } from "../../../shared/forms/form-footer";
import { formatOutcomeTimestamp } from "../chat/timeline/outcome-timestamp";
import { pendingUpdates } from "./pending-update-tracker";
import {
  pendingUpdatesMessage,
  UPDATE_LABELS,
} from "./pending-updates-message";

/**
 * Lists the pending updates by task, all checked at first. Sending asks Codex
 * to read the checked ones, which keeps them counted until it does. Mark seen
 * stops counting them without telling Codex.
 */
function PendingUpdatesForm() {
  const controller = useController(),
    state = useSnapshot(),
    // Tracks unchecked updates, so updates arriving while open start checked.
    [unchecked, setUnchecked] = useState<ReadonlySet<number>>(new Set());

  const tasks = pendingUpdates(state),
    selected = tasks
      .map((task) => ({
        ...task,
        updates: task.updates.filter((u) => !unchecked.has(u.event_id)),
      }))
      .filter((task) => task.updates.length),
    ids = selected.flatMap((task) => task.updates.map((u) => u.event_id)),
    stale = state.dialog?.scope !== state.scopeVersion,
    disabled = state.busy || stale || !ids.length;

  const check = (eventIds: number[], checked: boolean) =>
    setUnchecked((previous) => {
      const next = new Set(previous);

      for (const id of eventIds) {
        if (checked) next.delete(id);
        else next.add(id);
      }

      return next;
    });

  const send = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();

    void controller.submit(async () => {
      await controller.transport.send?.(pendingUpdatesMessage(selected));
    });
  };

  const markSeen = () =>
    void controller.submit(() => controller.pendingUpdates.markSeen(ids));

  return (
    <form className="pending-updates-form" onSubmit={send}>
      <p className="form-note">
        Codex normally picks these up while it checks for updates. Send them if
        Codex has gone idle or stopped checking. If Codex is in the middle of a
        turn, the message waits until that turn ends.
      </p>
      {tasks.length ? (
        <ul className="pending-update-tasks" aria-label="Pending updates">
          {tasks.map((task) => {
            const taskIds = task.updates.map((u) => u.event_id),
              count = taskIds.filter((id) => !unchecked.has(id)).length,
              // The task checkbox alone selects a task's only update.
              single = taskIds.length === 1;

            return (
              <li key={task.task_id} data-task={task.task_id}>
                <label className="pending-update-task">
                  <Checkbox
                    checked={count === taskIds.length}
                    indeterminate={count > 0 && count < taskIds.length}
                    disabled={state.busy}
                    onCheckedChange={(value) => check(taskIds, value)}
                  />
                  <span className="pending-update-title">{task.title}</span>
                  <span className="pending-update-count">
                    {task.updates.length}
                  </span>
                </label>
                <ul className="pending-updates">
                  {task.updates.map((update) => (
                    <li key={update.event_id}>
                      <label className="pending-update">
                        {!single && (
                          <Checkbox
                            checked={!unchecked.has(update.event_id)}
                            disabled={state.busy}
                            onCheckedChange={(value) =>
                              check([update.event_id], value)
                            }
                          />
                        )}
                        <span
                          className="pending-update-tag"
                          data-kind={update.kind}
                        >
                          {UPDATE_LABELS[update.kind]}
                        </span>
                        <span className="pending-update-text">
                          {update.text}
                        </span>
                        <time dateTime={update.timestamp}>
                          {formatOutcomeTimestamp(update.timestamp, state.host)}
                        </time>
                      </label>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="help empty-state">Codex has seen every update.</p>
      )}
      <FormFooter
        label="Send to Codex"
        dismissLabel="Close"
        disabled={!ids.length || !state.host.canSend}
      >
        <Button id="mark-seen" disabled={disabled} onClick={markSeen}>
          Mark seen
        </Button>
      </FormFooter>
    </form>
  );
}

export const pendingUpdatesDialog = defineDialog<"pending-updates">({
  title: () => "Send pending worker updates",
  render: () => <PendingUpdatesForm />,
  restoreFocus: () => document.getElementById("pending-updates"),
});
