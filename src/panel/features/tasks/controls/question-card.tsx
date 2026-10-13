import type { ChangeEvent, CSSProperties, KeyboardEvent } from "react";
import type { UseFormRegister, UseFormSetValue } from "react-hook-form";

import type {
  Question,
  QuestionAnswers as Answers,
} from "../../../app/state/types";

// Cards further back than this stay hidden so the stack reads as a stack, not a pile.
export const MAX_PEEK = 2;

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

/** Where a card sits relative to the one in front. */
export function cardPosition(
  index: number,
  active: number,
): QuestionCardProps["position"] {
  if (index < active) return "behind";
  if (index > active) return "ahead";

  return "active";
}

export function QuestionCard({
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
