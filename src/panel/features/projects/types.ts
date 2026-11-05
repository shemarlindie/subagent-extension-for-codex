import type { GitState } from "../../../shared/tasks/model";

export type Project = {
  repository: string;
  name?: string;
  kind: string;
  /** Absent when the service couldn't read the folder. */
  git?: GitState;
  /** The chat's unregistered project, added when a task starts with it. */
  pending?: boolean;
};
