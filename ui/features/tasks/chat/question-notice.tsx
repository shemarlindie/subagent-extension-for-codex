import { providerMetadata } from "../../../../src/features/providers/metadata.js";
import { CollapsibleNotice } from "../../../shared/components/notice";
import {
  useController,
  useSnapshot,
} from "../../../shared/state/controller-context";
import { pendingQuestions } from "../../../shared/state/selectors";
import type { Task } from "../../../shared/state/types";
import { QuestionForm } from "../controls/question-form";

type QuestionNoticeProps = { task: Task };

// Worker questions expand in place; the whole summary row toggles the stacked cards.
// Keyed by request, so the initial open state is read once per question request.
export function QuestionNotice({ task }: QuestionNoticeProps) {
  const controller = useController(),
    state = useSnapshot(),
    worker = state.workers.find((worker) => worker.provider === task.provider),
    providerName =
      providerMetadata(task.provider, worker?.metadata)?.displayName ??
      task.provider,
    questions = pendingQuestions(task),
    request = task.pending_input?.id;

  return (
    <CollapsibleNotice
      title={
        questions.length > 1
          ? `${providerName} has ${questions.length} questions`
          : `${providerName} has a question`
      }
      // Folds away once the cards show the questions in full.
      summary={
        questions.length > 1 && questions.every((q) => q.header)
          ? questions.map((q) => q.header).join(" · ")
          : questions[0].question
      }
      defaultOpen={!(request && controller.collapsedQuestions.has(request))}
      onOpenChange={(open) => {
        if (!request) return;
        if (open) controller.collapsedQuestions.delete(request);
        else controller.collapsedQuestions.add(request);
      }}
    >
      <QuestionForm task={task} />
    </CollapsibleNotice>
  );
}
