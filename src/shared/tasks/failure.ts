import type { Task } from "./model.js";

const FAILURE_MESSAGES = new Map<string, string>([
  ["cost_budget_exhausted", "Cost limit reached."],
  ["runtime_budget_exhausted", "Runtime limit reached."],
  ["error_max_turns", "Claude stopped at its turn limit."],
  [
    "error_max_structured_output_retries",
    "Claude couldn't produce the structured reply it was asked for.",
  ],
  ["error_during_execution", "Claude stopped because of an error."],
]);

/** Whether a failure code means the task used up its cost or runtime limit. */
export function isBudgetFailure(code: unknown) {
  return (
    code === "cost_budget_exhausted" || code === "runtime_budget_exhausted"
  );
}

/** Formats a saved failure code and optional provider details for display. */
export function failureMessage({
  error_code,
  error,
}: Pick<Task, "error_code" | "error">): string | undefined {
  const summary = error_code
    ? (FAILURE_MESSAGES.get(error_code) ?? `Unexpected error: ${error_code}.`)
    : undefined;

  return [summary, error].filter(Boolean).join(" ") || undefined;
}
