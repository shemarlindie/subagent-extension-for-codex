import { Fragment, type ReactNode } from "react";

import { Button } from "../../../shared/components/button";
import {
  useController,
  useSnapshot,
} from "../../../shared/state/controller-context";
import { idle } from "../../../shared/state/selectors";
import type { ControlAction, Task } from "../../../shared/state/types";

export function TaskActions({ task }: { task: Task }) {
  const controller = useController(),
    state = useSnapshot(),
    capabilities = state.workers.find(
      (worker) => worker.provider === task.provider,
    )?.capabilities;

  // An idle task takes a follow-up; a busy one can be steered or interrupted.
  const actions = (
    idle(task)
      ? ["continue"]
      : ["steer", ...(capabilities?.interrupt ? ["interrupt"] : [])]
  ) as ControlAction[];

  const labels: Record<string, string> = {
    steer: "Steer",
    interrupt: "Interrupt",
    continue: "Continue",
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
