import type { ConversationMessage } from "../../../../../shared/tasks/conversation/messages.js";
import {
  useController,
  useSnapshot,
} from "../../../../app/state/controller-context";
import { findTask } from "../../../../app/state/selectors";
import type { Task } from "../../../../app/state/types";
import { Button } from "../../../../shared/components/button/button";

type WrapUpBoxProps = {
  taskId?: string;
  message: ConversationMessage;
  /** The latest turn's, while the task waits for the user's next message. */
  answerable?: boolean;
};

/**
 * How the worker summed up its turn, for a reply that has a wrap-up: the
 * recap, then its question with buttons that answer it. Buttons show only
 * while the question is still the user's to answer.
 */
export function WrapUpBox({ taskId, message, answerable }: WrapUpBoxProps) {
  const controller = useController();

  const task = useSnapshot((state) =>
    taskId ? findTask(state, taskId) : undefined,
  );

  const wrapUp = message.wrap_up;
  if (!taskId || !wrapUp) return null;
  const actions = answerable ? (wrapUp.actions ?? []) : [];

  const reply = (label: string, current: Task) =>
    controller.run(async () => {
      const failure = await controller.taskActions.sendMessage(
        current,
        label,
        "steer",
      );

      if (failure) controller.reportActionFailure(failure);
    });

  return (
    <section className="wrap-up" aria-label="Wrap-up">
      <p className="wrap-up-recap">{wrapUp.recap}</p>
      {wrapUp.ask && <p className="wrap-up-ask">{wrapUp.ask}</p>}
      {task && actions.length > 0 && (
        <div className="wrap-up-actions">
          {actions.map(({ label }, index) => (
            <Button
              key={label}
              variant={index === 0 ? "primary" : "default"}
              onClick={() => reply(label, task)}
            >
              {label}
            </Button>
          ))}
        </div>
      )}
    </section>
  );
}
