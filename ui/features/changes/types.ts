import type {
  ChangedFile,
  ChangedFileContent,
  Changes,
  ChangeScope,
} from "../../../src/features/workspaces/changes.js";

export type { ChangedFile, ChangedFileContent, Changes, ChangeScope };

/** remove_user_agent_worktree's result: removed, or kept for its changes. */
export type WorktreeRemoval =
  { status: "removed" } | { status: "uncommitted"; files: string[] };

/** The selected task's changes, as the Changes tab and Details read them. */
export type ChangesState = {
  task: string;
  scope: ChangeScope;
  /** The task's status and turn when read; either changing reloads them. */
  key: string;
  loading: boolean;
  /** Every page, merged; kept while a reload runs. */
  data?: Changes;
  error?: string;
};
