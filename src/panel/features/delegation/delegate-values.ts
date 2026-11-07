/** The New Task form's values, shared by its field components. */
export type DelegateValues = {
  permission_mode: string;
  approval_decider: string;
  /** Whether the task's Bash runs in the provider's sandbox. */
  sandbox: "on" | "off";
  repository: string;
  description: string;
  worker: string;
  model: string;
  reasoning_effort: string;
  revision: string;
  workspace_strategy: "" | "worktree" | "current_repo";
  context: string;
  runtimeMode: string;
  runtime: number | "";
  costMode: string;
  cost: number | "";
  deps: string[];
};

/** Placeholder for a select whose value is still waiting on settings or workers. */
export function pendingPlaceholder(loading: boolean) {
  return loading ? "Loading…" : "Unavailable";
}
