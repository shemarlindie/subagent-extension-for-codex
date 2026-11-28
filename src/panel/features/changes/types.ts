import type {
  ChangeCounts,
  ChangedFileContent,
  ChangeList,
  ChangeScope,
  FileChange,
  ListedChange,
} from "../../../core/shared/changes/changes.js";
import type { ParsedDiffFile } from "../file-preview/diff/diff-format";

export type {
  ChangeCounts,
  ChangedFileContent,
  ChangeList,
  ChangeScope,
  FileChange,
  ListedChange,
};

/** app_remove_worktree's result: removed, or kept for its changes. */
export type WorktreeRemoval =
  { status: "removed" } | { status: "uncommitted"; files: string[] };

/** The selected task's change list, read while the Changes tab is open. */
export type ChangesState = {
  task: string;
  scope: ChangeScope;
  /** The task's status and turn when read; either changing reloads them. */
  key: string;
  loading: boolean;
  /** Kept during a same-scope reload and after failure. */
  data?: ChangeList;
  error?: string;
};

/**
 * A file's diff, read when it first opens. A ready file without a diff is
 * incomplete, or its diff couldn't be parsed.
 */
export type FileDiff =
  /** A retry keeps the failed read's error, so Retry stays put while it runs. */
  | { status: "loading"; error?: string }
  | { status: "ready"; diff?: ParsedDiffFile }
  | { status: "error"; error: string };

/** The diffs read for one change list, which a list with another revision replaces. */
export type FileDiffsState = {
  task: string;
  scope: ChangeScope;
  revision: string;
  /** A Map, so a path such as `constructor` finds no inherited entry. */
  files: Map<string, FileDiff>;
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
