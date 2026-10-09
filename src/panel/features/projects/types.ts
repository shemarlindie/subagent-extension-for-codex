export type Project = {
  repository: string;
  name?: string;
  kind: string;
  /** The chat's unregistered project, added when a task starts with it. */
  pending?: boolean;
};
