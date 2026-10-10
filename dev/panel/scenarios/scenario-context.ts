/** Registered projects. Thread "dev-thread" has tasks in both. */
export const previewProjects = [
  { repository: "/demo/project", name: "Demo project", kind: "repository" },
  { repository: "/demo/website", name: "Demo website", kind: "repository" },
];

/** The dev host's default Thread ID; most tasks belong to it. */
export const PREVIEW_THREAD = "dev-thread";
export const OTHER_THREAD = "other-thread";
export const WEBSITE = previewProjects[1]!.repository;

export const taskBase = {
  owner: "preview",
  provider: "claude" as const,
  worker_profile: "researcher" as const,
  provider_options: {
    claude: {
      permission_mode: "plan",
      permission_source: "task_profile",
      approval_decider: "user",
    },
  },
  conversation_id: PREVIEW_THREAD,
  repository: previewProjects[0]!.repository,
  revision: "HEAD",
  depends_on: [],
  context: [],
  workspace_strategy: "worktree" as const,
  budget: { max_runtime_minutes: null, max_cost_usd: null },
  created_by: "user" as const,
  instructions: [],
  instructions_sent: 0,
  pending_steers: [],
  queue: [],
  turn: 1,
  runtime_ms: 0,
};

export const at = (minutes: number) =>
  new Date(Date.parse("2026-10-02T08:00:00Z") + minutes * 60000).toISOString();

export const timestamps = (start: number, minutes: number) => ({
  created_at: at(start),
  updated_at: at(start + minutes),
});

// Stand-ins for the snapshot trees a reply records, with a turn suffix.
export const FAKE_TREE = "9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0";

// Stand-ins for a worktree task's Git fields. The fixture service replaces
// them with a real repository's (dev/panel/scenarios/change-fixtures.ts).
export const FAKE_COMMIT = "4f1c2d9e8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e";

export const worktree = (id: string) => ({
  workspace: `/demo/data/worktrees/${id}`,
  branch: `agent/${id}`,
  base_commit: FAKE_COMMIT,
});
