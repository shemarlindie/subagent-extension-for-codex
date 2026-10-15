import { useController } from "../../../../app/state/controller-context";
import type { Task } from "../../../../app/state/types";
import { Button } from "../../../../shared/components/button/button";
import { Icon } from "../../../../shared/components/icons/icons";
import { TooltipWrapper } from "../../../../shared/components/tooltip";

type MarkUnseenButtonProps = {
  task: Task;
  /** The message's event; it and the events after it become unseen. */
  eventId: number;
};

/** Marks the task unseen from one of its messages, so that message and the ones after it are new. */
export function MarkUnseenButton({ task, eventId }: MarkUnseenButtonProps) {
  const controller = useController();
  const label = "Mark as unseen from here";

  return (
    <TooltipWrapper label={label}>
      <Button
        variant="ghost"
        className="file-action file-copy-inline"
        aria-label={label}
        onClick={() =>
          controller.run(() =>
            controller.taskActions.seen.markUnseenFrom(task, eventId),
          )
        }
      >
        <Icon name="eye-off" size={10} />
      </Button>
    </TooltipWrapper>
  );
}
