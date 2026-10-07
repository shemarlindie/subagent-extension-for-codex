import type { ListedTask } from "../../../src/features/tasks/task-list.js";

export type Task = ListedTask;
export type Tab = "chat" | "changes" | "activity" | "details";
export type Filter = "all" | "active" | "attention" | "completed" | "failed";

export type Question = {
  question: string;
  /** Short chip label (at most 12 characters in the Claude SDK schema). */
  header?: string;
  options?: { label: string; description?: string }[];
  multiSelect?: boolean;
};

/** Question form values, indexed by question position. */
export type QuestionAnswers = {
  answers: Record<string, string | string[]>;
  custom: Record<string, string>;
};

/** Unsent answers to one question request, restored when its task is shown again. */
export type QuestionDraft = {
  values: QuestionAnswers;
  skipped: number[];
  active: number;
};
