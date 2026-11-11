import { useController, useSnapshot } from "../../app/state/controller-context";
import type { Task } from "../../app/state/types";
import { Button } from "../../shared/components/button/button";
import { TooltipWrapper } from "../../shared/components/tooltip";

type AskFileButtonProps = {
  task: Task;
  path: string;
  contextText?: string;
  disabled?: boolean;
};

/** Prepares a message about the shown file for the user to review and send. */
export function AskFileButton({
  task,
  path,
  contextText,
  disabled,
}: AskFileButtonProps) {
  const controller = useController();
  const threadMode = useSnapshot((state) => Boolean(state.conversation));
  const label = "Ask Codex about this file";

  if (!threadMode) return null;

  return (
    <TooltipWrapper label={label}>
      <Button
        className="file-action"
        disabled={disabled}
        onClick={() =>
          controller.prepareHandoff(task, { kind: "file", path }, contextText)
        }
      >
        <span className="file-action-label">{label}</span>
      </Button>
    </TooltipWrapper>
  );
}
