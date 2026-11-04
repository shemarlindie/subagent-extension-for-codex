/** What Git can do for a project. Absent when the service couldn't read it. */
export type ProjectGit = "ready" | "no_commits" | "none";

export type Project = {
  repository: string;
  name?: string;
  kind: string;
  git?: ProjectGit;
  /** The chat's unregistered project, added when a task starts with it. */
  pending?: boolean;
};
