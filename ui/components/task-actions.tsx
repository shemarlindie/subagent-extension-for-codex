import { Fragment, type ReactNode } from "react";

import { locked, terminal } from "../core/selectors";
import type { Task } from "../core/types";
import { Button } from "./button";
import { useController, useSnapshot } from "./controller-context";

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

  if (state.mode === "console") {
    buttons.push([
      "workspace",
      <Button
        variant="text"
        underline
        id="workspace"
        onClick={() => controller.open({ kind: "workspace", task })}
      >
        Workspace path
      </Button>,
    ]);
  }

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
        : state.mode === "console" && !controller.transport.embedded
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
