import { Button } from "../../../shared/components/button";
import { Icon } from "../../../shared/components/icons";
import { TooltipWrapper } from "../../../shared/components/tooltip";
import {
  useController,
  useSnapshot,
} from "../../../shared/state/controller-context";
import type { Task } from "../../../shared/state/types";

type HandoffButtonProps = { task: Task };

/** Brings the task back to the Codex conversation, or copies it there. */
export function HandoffButton({ task }: HandoffButtonProps) {
  const controller = useController(),
    state = useSnapshot(),
    label = state.host.canSend
      ? "Bring to Codex"
      : !controller.transport.embedded
        ? "Copy for Codex"
        : "Prepare handoff";

  return (
    <TooltipWrapper label={label}>
      <Button
        variant="ghost"
        id="handoff"
        className="toolbar-icon-button"
        disabled={state.busy}
        onClick={() => controller.open({ kind: "handoff", task })}
      >
        <Icon name="handoff" size={14} />
      </Button>
    </TooltipWrapper>
  );
}
