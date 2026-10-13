import {
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  useForm,
  type UseFormRegister,
  type UseFormSetValue,
  useWatch,
} from "react-hook-form";

import {
  useController,
  useSnapshot,
} from "../../../app/state/controller-context";
import { pendingQuestions } from "../../../app/state/selectors";
import { useSessionState } from "../../../app/state/session/use-session-state";
import type {
  Question,
  QuestionAnswers as Answers,
  QuestionDraft,
  Task,
} from "../../../app/state/types";
import { Button } from "../../../shared/components/button/button";
import { Icon } from "../../../shared/components/icons/icons";
import { Presence } from "../../../shared/components/motion/motion";

// Cards further back than this stay hidden so the stack reads as a stack, not a pile.
const MAX_PEEK = 2;

// The SDK has no per-question skip; an explicit answer tells Claude what happened.
export const SKIPPED_ANSWER =
  "(Skipped: the user has no preference; use your best judgment.)";

// Presets come first; a typed answer replaces a single choice and joins a multiple one.
function answerFor(
  question: Question,
  preset: string | string[] | undefined,
  custom: string | undefined,
) {
  const typed = custom?.trim() ?? "";

  if (Array.isArray(preset)) {
    return [...preset, ...(typed ? [typed] : [])].join(", ");
  }

  return question.multiSelect ? typed : typed || (preset?.trim() ?? "");
}

interface QuestionCardProps {
  question: Question;
  index: number;
  position: "behind" | "active" | "ahead";
  depth: number;
  register: UseFormRegister<Answers>;
  setValue: UseFormSetValue<Answers>;
  custom: string;
  skipped: boolean;
  onNext?: () => void;
  onUnskip: () => void;
}

function cardPosition(
  index: number,
  active: number,
): QuestionCardProps["position"] {
  if (index < active) return "behind";
  if (index > active) return "ahead";

  return "active";
}

function submitLabel(busy: boolean, sending: boolean) {
  if (busy) return "Sending…";

  return sending ? "Respond" : "Next";
}

function QuestionCard({
  question,
  index,
  position,
  depth,
  register,
  setValue,
  custom,
  skipped,
  onNext,
  onUnskip,
}: QuestionCardProps) {
  const id = `question-${index}`,
    options = question.options ?? [],
    multiple = Boolean(question.multiSelect),
    active = position === "active",
    presetField = register(`answers.${index}`),
    customField = register(`custom.${index}`);

  // A single choice and a typed answer are alternatives. The fields have no
  // async validation, so RHF's change promise has nothing to report.
  const handlePresetChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (!multiple) setValue(`custom.${index}`, "");
    onUnskip();
    void presetField.onChange(event);
  };

  const handleOtherChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.value.trim()) {
      if (!multiple) setValue(`answers.${index}`, "");
      onUnskip();
    }

    void customField.onChange(event);
  };

  // Enter moves to the next card; on the last one it submits as usual.
  const handleOtherKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && onNext) {
      event.preventDefault();
      onNext();
    }
  };

  const handleTextChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    if (event.target.value.trim()) onUnskip();
    void customField.onChange(event);
  };

  return (
    <div
      className="question-card"
      data-position={position}
      data-hidden={depth > MAX_PEEK || undefined}
      data-skipped={skipped || undefined}
      style={{ "--depth": Math.min(depth, MAX_PEEK) } as CSSProperties}
      role="group"
      aria-labelledby={`${id}-text`}
      aria-hidden={!active || undefined}
      inert={!active}
    >
      <div className="question-heading">
        <p id={`${id}-text`} className="question-text">
          {question.question}
        </p>
        {options.length > 0 && (
          <span className="question-hint">
            {multiple ? "Choose any" : "Choose one"}
          </span>
        )}
      </div>
      {options.length ? (
        <div
          className="question-options"
          role={multiple ? undefined : "radiogroup"}
          aria-labelledby={`${id}-text`}
        >
          {options.map((option, choice) => (
            <label key={choice} className="question-option">
              <input
                type={multiple ? "checkbox" : "radio"}
                value={option.label}
                {...presetField}
                onChange={handlePresetChange}
              />
              <span className="question-option-text">
                <span className="question-option-label">{option.label}</span>
                {option.description && (
                  <span className="question-option-description">
                    {option.description}
                  </span>
                )}
              </span>
            </label>
          ))}
          <div
            className="question-option question-other"
            data-filled={Boolean(custom.trim()) || undefined}
          >
            <input
              type="text"
              aria-label="Write your own answer"
              placeholder="Other — write your own answer"
              {...customField}
              onChange={handleOtherChange}
              onKeyDown={handleOtherKeyDown}
            />
          </div>
        </div>
      ) : (
        <textarea
          aria-labelledby={`${id}-text`}
          placeholder="Write your answer"
          {...customField}
          onChange={handleTextChange}
        />
      )}
    </div>
  );
}

export function QuestionForm({ task }: { task: Task }) {
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
    answers = questions.map((question, index) =>
      skipped.has(index)
        ? SKIPPED_ANSWER
        : answerFor(question, presets[index], customs[index]),
    ),
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
    setValue(`answers.${index}`, questions[index].multiSelect ? [] : "");
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
      Object.fromEntries(
        questions.map((question, index) => [question.question, answers[index]]),
      ),
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
