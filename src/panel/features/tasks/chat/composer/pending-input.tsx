import { pendingInputKind } from "../../../../../shared/tasks/model.js";
import {
  useController,
  useSnapshot,
} from "../../../../app/state/controller-context";
import { pendingQuestions } from "../../../../app/state/selectors";
import type { Task } from "../../../../app/state/types";
import { Button } from "../../../../shared/components/button/button";
import { Presence } from "../../../../shared/components/motion/motion";
import {
  Notice,
  NoticeText,
} from "../../../../shared/components/notice/notice";
import { InlinePermissionRequest } from "../../controls/inline-permission-request";
import { QuestionForm } from "../../controls/question-form";

type PendingInputProps = { task: Task };

/**
 * The worker's question or permission request at the end of Chat. Questions
 * render as cards and permissions include their review details and actions.
 */
export function PendingInput({ task }: PendingInputProps) {
  const controller = useController(),
    state = useSnapshot(),
    pending = task.pending_input,
    isQuestion = Boolean(pending && pendingInputKind(pending) === "question"),
    isPermission = Boolean(
      pending && pendingInputKind(pending) === "permission",
    ),
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
      <Presence show={Boolean(pending && !questions && isPermission)}>
        <InlinePermissionRequest key={pending?.id} task={task} />
      </Presence>
      <Presence show={Boolean(pending && !questions && !isPermission)}>
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
