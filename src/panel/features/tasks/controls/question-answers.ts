import type {
  Question,
  QuestionAnswers as Answers,
} from "../../../app/state/types";

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

/** Each question's text and its answer, in question order; empty when unanswered. */
export function questionAnswers(
  questions: Question[],
  skipped: ReadonlySet<number>,
  { answers, custom }: Answers,
) {
  return questions.map(
    (question, index) =>
      [
        question.question,
        skipped.has(index)
          ? SKIPPED_ANSWER
          : answerFor(question, answers[index], custom[index]),
      ] as const,
  );
}
