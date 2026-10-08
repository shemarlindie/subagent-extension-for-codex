import { pendingInputKind } from "../../../../src/features/tasks/model.js";
import { Button } from "../../../shared/components/button";
import { Presence } from "../../../shared/components/motion";
import { Notice, NoticeText } from "../../../shared/components/notice";
import {
  useController,
  useSnapshot,
} from "../../../shared/state/controller-context";
import { pendingQuestions } from "../../../shared/state/selectors";
import type { Task } from "../../../shared/state/types";
import { QuestionForm } from "../controls/question-form";

type PendingInputProps = { task: Task };

/**
 * The worker's question or permission request, at the end of Chat: the
 * question cards in place, or a permission to review.
 */
export function PendingInput({ task }: PendingInputProps) {
  const controller = useController(),
    state = useSnapshot(),
    pending = task.pending_input,
    isQuestion = Boolean(pending && pendingInputKind(pending) === "question"),
    questions =
      isQuestion && pendingQuestions(task).length
        ? pendingQuestions(task)
        : undefined;

  // Pending requests fold in and out so the messages above don't jump.
  return (
    <>
      <Presence show={Boolean(questions)}>
        {/* Keyed so a new request starts with fresh answers. */}
        <QuestionForm key={pending?.id} task={task} />
      </Presence>
      <Presence show={Boolean(pending && !questions)}>
        <Notice>
          {/* A question without a questions list falls back to the generic review. */}
          <strong>{isQuestion ? "Input needed" : "Permission needed"}</strong>
          <NoticeText>
            {String(pending?.input.description ?? pending?.tool ?? "")}
          </NoticeText>
          <Button
            id="respond"
            variant="primary"
            disabled={state.busy}
            onClick={() => controller.open({ kind: "respond", task })}
          >
            Review request
          </Button>
        </Notice>
      </Presence>
    </>
  );
}
