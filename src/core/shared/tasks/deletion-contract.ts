import type { PathSymlink } from "../filesystem/path-contract.js";
import type {
  SessionDeletionResource,
  SessionDeletionStatus,
} from "../providers/session-deletion-contract.js";

/** @strict */
export type TaskSessionDeletionTarget = {
  provider: string;
  id: string;
  resources: SessionDeletionResource[];
};

/** A worktree outside the managed folder. It and its local branch stay. @strict */
export type RetainedWorktree = {
  worktree?: string;
  branch?: string;
};

/** @strict */
export type TaskDeletionTarget = {
  id: string;
  title: string;
  repository: string;
  repositorySymlinks?: PathSymlink[];
  worktree?: string;
  worktreeSymlinks?: PathSymlink[];
  branch?: string;
  retainedWorktree?: RetainedWorktree;
  /** False when the task has no provider session to keep or remove. */
  sessionRecorded?: false;
  session?: TaskSessionDeletionTarget;
};

/** The resources shown for confirmation before the service removes a task. @strict */
export type TaskDeletionPreview = {
  tasks: TaskDeletionTarget[];
  project?: string;
  includeSession: boolean;
  sessionDeletion: SessionDeletionStatus;
  confirmation?: string;
};
