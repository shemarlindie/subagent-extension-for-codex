import type { ConversationMessage } from "../../../../../shared/tasks/conversation/messages.js";
import type { WrapUpAction } from "../../../../../shared/tasks/wrap-up-contract.js";
import {
  useController,
  useSnapshot,
} from "../../../../app/state/controller-context";
import { findTask } from "../../../../app/state/selectors";
import type { Task } from "../../../../app/state/types";
import { Button } from "../../../../shared/components/button/button";
import { canToggleArchive } from "../../archive/archive-actions";

type WrapUpBoxProps = {
  taskId?: string;
  message: ConversationMessage;
  /** The latest turn's, while the task waits for the user's next message. */
  answerable?: boolean;
};

const ACTION_LABELS = { archive: "Archive", ask_codex: "Ask Codex" };

/**
 * How the worker summed up its turn, for a reply that has a wrap-up: the
 * recap, then its question with buttons that answer it. Buttons show only
 * while the question is still the user's to answer, and actions the panel
 * can't offer drop out.
 */
export function WrapUpBox({ taskId, message, answerable }: WrapUpBoxProps) {
  const controller = useController();
  const threadMode = useSnapshot((state) => Boolean(state.conversation));

  const task = useSnapshot((state) =>
    taskId ? findTask(state, taskId) : undefined,
  );

  const wrapUp = message.wrap_up;
  if (!taskId || !wrapUp) return null;

  const offered = (action: WrapUpAction) =>
    "label" in action ||
    (action.action === "archive"
      ? Boolean(task && !task.archived_at && canToggleArchive(task))
      : threadMode);

  const actions = answerable ? (wrapUp.actions?.filter(offered) ?? []) : [];

  const run = (action: WrapUpAction, current: Task) => {
    if ("label" in action) {
      controller.run(async () => {
        const failure = await controller.taskActions.sendMessage(
          current,
          action.label,
          "steer",
        );

        if (failure) controller.reportActionFailure(failure);
      });
    } else if (action.action === "archive") {
      controller.run(() =>
        controller.taskActions.archive.setArchived([current], true),
      );
    } else {
      controller.prepareHandoff(
        current,
        { kind: "reply", id: message.id },
        message.text,
      );
    }
  };

  return (
    <section className="wrap-up" aria-label="Wrap-up">
      <p className="wrap-up-recap">{wrapUp.recap}</p>
      {wrapUp.ask && <p className="wrap-up-ask">{wrapUp.ask}</p>}
      {task && actions.length > 0 && (
        <div className="wrap-up-actions">
          {actions.map((action, index) => (
            <Button
              key={"label" in action ? action.label : action.action}
              variant={index === 0 ? "primary" : "default"}
              onClick={() => run(action, task)}
            >
              {"label" in action ? action.label : ACTION_LABELS[action.action]}
            </Button>
          ))}
        </div>
      )}
    </section>
  );
}
