import { useController } from "../../../../app/state/controller-context";
import type { Task } from "../../../../app/state/types";
import { Button } from "../../../../shared/components/button/button";
import { Icon } from "../../../../shared/components/icons/icons";
import { TooltipWrapper } from "../../../../shared/components/tooltip";

type MarkUnreadButtonProps = {
  task: Task;
  /** The message's event; it and the events after it become unread. */
  eventId: number;
};

/** Marks the task unread from one of its messages, so that message and the ones after it are new. */
export function MarkUnreadButton({ task, eventId }: MarkUnreadButtonProps) {
  const controller = useController();
  const label = "Mark unread from here";

  return (
    <TooltipWrapper label={label}>
      <Button
        variant="ghost"
        className="file-action file-copy-inline"
        aria-label={label}
        onClick={() =>
          controller.run(() =>
            controller.taskActions.unread.markUnreadFrom(task, eventId),
          )
        }
      >
        <Icon name="eye-off" size={10} />
      </Button>
    </TooltipWrapper>
  );
}
