import { type CSSProperties, useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import {
  useController,
  useSnapshot,
} from "../../../app/state/controller-context";
import { pendingQuestions } from "../../../app/state/selectors";
import { useSessionState } from "../../../app/state/session/use-session-state";
import type {
  QuestionAnswers as Answers,
  QuestionDraft,
  Task,
} from "../../../app/state/types";
import { Button } from "../../../shared/components/button/button";
import { Icon } from "../../../shared/components/icons/icons";
import { Presence } from "../../../shared/components/motion/presence";
import { questionAnswers } from "./question-answers";
import { cardPosition, MAX_PEEK, QuestionCard } from "./question-card";

function submitLabel(busy: boolean, sending: boolean) {
  if (busy) return "Sending…";

  return sending ? "Respond" : "Next";
}

interface QuestionFormProps {
  task: Task;
}

export function QuestionForm({ task }: QuestionFormProps) {
  const controller = useController(),
    state = useSnapshot(),
    questions = pendingQuestions(task),
    stacked = questions.length > 1,
    request = task.pending_input!.id,
    // Answers left unsent when this request was last on screen.
    [draft, updateSession] = useSessionState(
      "question",
      request,
      (state) => state.draft,
    );

  const { register, control, setValue, getValues, handleSubmit } =
    useForm<Answers>({
      defaultValues: draft?.values ?? {
        answers: Object.fromEntries(
          questions.map((question, index) => [
            index,
            question.multiSelect ? [] : "",
          ]),
        ),
        custom: {},
      },
    });

  const [active, setActive] = useState(draft?.active ?? 0),
    [incomplete, setIncomplete] = useState(false),
    [error, setError] = useState<string>(),
    [skipped, setSkipped] = useState<ReadonlySet<number>>(
      () => new Set(draft?.skipped),
    ),
    view = useRef({ active, skipped }),
    sent = useRef(false),
    form = useRef<HTMLFormElement>(null),
    submit = useRef<HTMLButtonElement>(null),
    focusAfterMove = useRef<"card" | "submit">(undefined),
    presets = useWatch({ control, name: "answers" }),
    customs = useWatch({ control, name: "custom" }),
    answerEntries = questionAnswers(questions, skipped, {
      answers: presets,
      custom: customs,
    }),
    answers = answerEntries.map(([, answer]) => answer),
    unanswered = answers.findIndex((answer) => !answer),
    last = active === questions.length - 1,
    sending = last || unanswered < 0,
    incompleteMessage = stacked
      ? "Answer each question before sending."
      : "Answer the question before sending.",
    message = incomplete && unanswered >= 0 ? incompleteMessage : error;

  const show = (index: number) => {
    setIncomplete(false);
    setError(undefined);
    setActive(index);
  };

  // Moving cards can hide the focused control; restore focus once the new card is in front.
  useEffect(() => {
    const target = focusAfterMove.current;
    focusAfterMove.current = undefined;

    if (target === "submit") {
      submit.current?.focus();
    } else if (target === "card") {
      form.current
        ?.querySelector<HTMLElement>(
          ".question-card[data-position=active] :is(input, textarea)",
        )
        ?.focus();
    }
  }, [active]);

  // Leaving the task unmounts the form; keep its unsent answers as a draft to restore.
  useEffect(() => {
    view.current = { active, skipped };
  });

  useEffect(
    () => () => {
      if (sent.current) return;

      const draft: QuestionDraft = {
        values: structuredClone(getValues()),
        skipped: [...view.current.skipped],
        active: view.current.active,
      };

      updateSession({ draft });
    },
    [updateSession, getValues],
  );

  // A skipped card drops its partial answer and moves on to the next card.
  const skipOne = (index: number) => {
    setValue(`answers.${index}`, questions[index]?.multiSelect ? [] : "");
    setValue(`custom.${index}`, "");
    setSkipped(new Set(skipped).add(index));
    if (index < questions.length - 1) show(index + 1);
  };

  const unskip = (index: number) => {
    if (!skipped.has(index)) return;
    const next = new Set(skipped);
    next.delete(index);
    setSkipped(next);
  };

  // Back disappears on the first card, so focus moves on to Next.
  const goBack = () => {
    if (active === 1) focusAfterMove.current = "submit";
    show(active - 1);
  };

  const goNext = () => {
    // Typing continues in the next card rather than the hidden one.
    focusAfterMove.current = "card";
    show(active + 1);
  };

  // Next moves one card on. Sending first returns to any unanswered card;
  // it returns true only when every question has an answer or a skip.
  const advance = () => {
    if (sending) {
      if (unanswered < 0) return true;
      setActive(unanswered);
      setIncomplete(true);

      return false;
    }

    show(active + 1);

    return false;
  };

  const respond = async () => {
    if (!advance()) return;
    // Set before sending: a successful answer can unmount the form before
    // the call returns, and an answered request must not leave a draft.
    sent.current = true;

    const failure = await controller.answer(
      task,
      Object.fromEntries(answerEntries),
    );

    sent.current = !failure;
    setError(failure);
  };

  return (
    <form
      ref={form}
      className="question-form"
      onSubmit={controller.handle(handleSubmit(respond))}
    >
      {stacked && (
        <div className="question-progress">
          <span className="question-count" aria-live="polite">
            Question {active + 1} of {questions.length}
          </span>
          <div className="question-steps">
            {questions.map((question, index) => (
              <button
                key={index}
                type="button"
                className="question-step"
                aria-current={index === active ? "step" : undefined}
                data-answered={
                  (Boolean(answers[index]) && !skipped.has(index)) || undefined
                }
                data-skipped={skipped.has(index) || undefined}
                title={skipped.has(index) ? "Skipped" : undefined}
                onClick={() => show(index)}
              >
                {skipped.has(index) ? (
                  <Icon name="minus" size={8} />
                ) : (
                  answers[index] && <Icon name="check" size={8} />
                )}
                {question.header || `Question ${index + 1}`}
              </button>
            ))}
          </div>
        </div>
      )}
      <div
        className="question-deck"
        style={
          {
            // Fixed for the whole deck, so the last cards do not shrink it.
            "--peek": Math.min(questions.length - 1, MAX_PEEK),
          } as CSSProperties
        }
      >
        {questions.map((question, index) => (
          <QuestionCard
            key={index}
            question={question}
            index={index}
            position={cardPosition(index, active)}
            depth={Math.abs(index - active)}
            register={register}
            setValue={setValue}
            custom={customs[index] ?? ""}
            skipped={skipped.has(index)}
            onNext={sending ? undefined : goNext}
            onUnskip={() => unskip(index)}
          />
        ))}
      </div>
      {/* One action row for the front card, below the cards. */}
      <div className="question-actions">
        {skipped.has(active) && (
          <span role="status" title="Claude will use its best judgment">
            Skipped
          </span>
        )}
        {/* One button toggles between Skip and Undo, so keyboard focus stays on it. */}
        <Button
          variant="text"
          underline={skipped.has(active)}
          onClick={() =>
            skipped.has(active) ? unskip(active) : skipOne(active)
          }
        >
          {skipped.has(active) ? "Undo" : "Skip this question"}
        </Button>
        <div className="question-nav">
          {active > 0 && <Button onClick={goBack}>Back</Button>}
          <Button
            ref={submit}
            type="submit"
            variant="primary"
            disabled={state.busy}
          >
            {submitLabel(state.busy, sending)}
          </Button>
        </div>
      </div>
      {/* Below the buttons, errors fold in and out without moving the cards or the buttons. */}
      <Presence show={Boolean(message)}>
        <p className="form-error question-error" role="alert">
          {message}
        </p>
      </Presence>
    </form>
  );
}
