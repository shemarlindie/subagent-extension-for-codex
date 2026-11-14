import { memo } from "react";

import { pendingInputKind } from "../../../../../shared/tasks/model.js";
import { scalarText } from "../../../../../shared/text.js";
import {
  useController,
  useSnapshot,
} from "../../../../app/state/controller-context";
import { pendingQuestions } from "../../../../app/state/selectors";
import type { Task } from "../../../../app/state/types";
import { Button } from "../../../../shared/components/button/button";
import { Presence } from "../../../../shared/components/motion/presence";
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
export const PendingInput = memo(function PendingInput({
  task,
}: PendingInputProps) {
  const controller = useController();
  const busy = useSnapshot((state) => state.busy);
  const pending = task.pending_input;

  const isQuestion = Boolean(
    pending && pendingInputKind(pending) === "question",
  );

  const isPermission = Boolean(
    pending && pendingInputKind(pending) === "permission",
  );

  const questions =
    isQuestion && pendingQuestions(task).length
      ? pendingQuestions(task)
      : undefined;

  // Pending requests fold in and out so the messages above don't jump.
  return (
    <>
      <Presence show={Boolean(questions)}>
        {/* Keyed so a new request starts with fresh answers. */}
        {pending && (
          <QuestionForm key={pending.id} task={task} request={pending} />
        )}
      </Presence>
      <Presence show={Boolean(pending && !questions && isPermission)}>
        {pending && (
          <InlinePermissionRequest
            key={pending.id}
            task={task}
            request={pending}
          />
        )}
      </Presence>
      <Presence show={Boolean(pending && !questions && !isPermission)}>
        <Notice>
          {/* A question without a questions list falls back to the generic review. */}
          <strong>{isQuestion ? "Input needed" : "Permission needed"}</strong>
          <NoticeText>
            {scalarText(pending?.input.description, pending?.tool)}
          </NoticeText>
          <Button
            id="respond"
            variant="primary"
            disabled={busy}
            onClick={() => controller.open({ kind: "respond", task })}
          >
            Review request
          </Button>
        </Notice>
      </Presence>
    </>
  );
});
