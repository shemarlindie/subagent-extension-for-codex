import { memo, useRef } from "react";

import type { ChatAnswers } from "../../../../../core/shared/tasks/conversation/chat.js";
import { useAnimatedHeight } from "../../../../shared/components/motion/use-animated-height";
import { SKIPPED_ANSWER } from "../../controls/question-answers";

type QuestionAnswersRowProps = {
  item: ChatAnswers;
  /** Expands a new row into a conversation that is already showing. */
  arriving?: boolean;
};

/** Answers to the worker's questions, as a message from whoever answered. */
export const QuestionAnswersRow = memo(function QuestionAnswersRow({
  item,
  arriving,
}: QuestionAnswersRowProps) {
  const ref = useRef<HTMLElement>(null);
  useAnimatedHeight(ref, item.id, arriving);
  const parent = item.from === "parent";

  return (
    <article
      ref={ref}
      className="chat-message"
      data-from={item.from}
      data-kind="answers"
      data-chat-item={item.id}
      aria-label={parent ? "Parent agent's answers" : "Your answers"}
    >
      {parent && <div className="chat-sender">Parent agent</div>}
      <dl className="chat-bubble chat-answers">
        {item.answers.map(({ question, answer }) => (
          <div key={question}>
            <dt>{question}</dt>
            <dd data-skipped={answer === SKIPPED_ANSWER || undefined}>
              {answer === SKIPPED_ANSWER ? "Skipped" : answer}
            </dd>
          </div>
        ))}
      </dl>
    </article>
  );
});
