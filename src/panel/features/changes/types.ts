import type {
  ChangeCounts,
  ChangedFile,
  ChangedFileContent,
  Changes,
  ChangeScope,
} from "../../../shared/changes/changes.js";

export type {
  ChangeCounts,
  ChangedFile,
  ChangedFileContent,
  Changes,
  ChangeScope,
};

/** app_remove_worktree's result: removed, or kept for its changes. */
export type WorktreeRemoval =
  { status: "removed" } | { status: "uncommitted"; files: string[] };

/** The selected task's changes, read while the Changes tab is open. */
export type ChangesState = {
  task: string;
  scope: ChangeScope;
  /** The task's status and turn when read; either changing reloads them. */
  key: string;
  loading: boolean;
  /** Every page, merged; kept during a same-scope reload and after failure. */
  data?: Changes;
  error?: string;
};

/** The selected task's change totals, for its tab count and Details. */
export type ChangeCountsState = {
  task: string;
  /** The task's status and turn when read; either changing reloads them. */
  key: string;
  loading: boolean;
  data?: ChangeCounts;
  error?: string;
};
