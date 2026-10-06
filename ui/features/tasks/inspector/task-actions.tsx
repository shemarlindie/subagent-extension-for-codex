import { Fragment, type ReactNode } from "react";

import { Button } from "../../../shared/components/button";
import {
  useController,
  useSnapshot,
} from "../../../shared/state/controller-context";
import { locked, terminal } from "../../../shared/state/selectors";
import type { Task } from "../../../shared/state/types";

export function TaskActions({ task }: { task: Task }) {
  const controller = useController(),
    state = useSnapshot(),
    capabilities = state.workers.find(
      (worker) => worker.provider === task.provider,
    )?.capabilities;

  const controls = !terminal(task) && !locked(task);

  const actions = [
    ...(controls
      ? [
          "steer",
          ...(capabilities?.interrupt && task.status !== "interrupted"
            ? ["interrupt"]
            : []),
          ...(task.status === "interrupted" && capabilities?.session_continue
            ? ["continue"]
            : []),
          "cancel",
        ]
      : []),
    ...(["failed", "cancelled"].includes(task.status) && !locked(task)
      ? ["retry"]
      : []),
  ];

  const labels: Record<string, string> = {
    steer: "Steer",
    interrupt: "Interrupt",
    continue: "Continue",
    cancel: "Cancel task",
    retry: "New attempt",
  };

  // Keyed so the dot separators can be interleaved between buttons below.
  const buttons: [key: string, button: ReactNode][] = actions.map((action) => [
    action,
    <Button
      variant="text"
      underline
      data-action={action}
      disabled={state.busy}
      onClick={() => controller.open({ kind: "control", action, task })}
    >
      {labels[action]}
    </Button>,
  ]);

  buttons.push([
    "handoff",
    <Button
      variant="text"
      underline
      id="handoff"
      disabled={state.busy}
      onClick={() => controller.open({ kind: "handoff", task })}
    >
      {state.host.canSend
        ? "Bring to Codex"
        : !controller.transport.embedded
          ? "Copy for Codex"
          : "Prepare handoff"}
    </Button>,
  ]);

  return (
    <div className="actions">
      {buttons.map(([key, button], index) => (
        <Fragment key={key}>
          {index > 0 && (
            <span className="actions-separator" aria-hidden="true">
              ·
            </span>
          )}
          {button}
        </Fragment>
      ))}
    </div>
  );
}
