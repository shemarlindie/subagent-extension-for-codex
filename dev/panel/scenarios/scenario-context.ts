import {
  claudeOverrideDefaults,
  resolveClaudePolicy,
} from "../../../src/shared/providers/claude/permissions";

const demoProject = {
  repository: "/demo/project",
  name: "Demo project",
  kind: "repository",
};

const demoWebsite = {
  repository: "/demo/website",
  name: "Demo website",
  kind: "repository",
};

export const mobileApp = {
  repository: "/demo/mobile",
  name: "Mobile app",
  kind: "repository",
};

export const docsSite = {
  repository: "/demo/docs",
  name: "Docs site",
  kind: "repository",
};

export const notesFolder = {
  repository: "/demo/notes",
  name: "Field notes",
  kind: "repository",
  git: "none",
};

export const sketchFolder = {
  repository: "/demo/sketch",
  name: "Sketch",
  kind: "repository",
  git: "no_commits",
};

/** Registered projects. Thread "dev-thread" has tasks in the first two. */
export const previewProjects = [
  demoProject,
  demoWebsite,
  mobileApp,
  docsSite,
  notesFolder,
  sketchFolder,
];

/** The dev host's default Thread ID; most tasks belong to it. */
export const PREVIEW_THREAD = "dev-thread";
export const OTHER_THREAD = "other-thread";
export const WEBSITE = demoWebsite.repository;

export const taskBase = {
  owner: "preview",
  provider: "claude" as const,
  worker_profile: "researcher" as const,
  provider_options: {
    claude: {
      permission_mode: "plan",
      permission_source: "task",
      approval_decider: "user",
      claude_policy: resolveClaudePolicy(claudeOverrideDefaults),
    },
  },
  conversation_id: PREVIEW_THREAD,
  repository: demoProject.repository,
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

/** Claude options for a task that took its permissions from settings. */
export const settingOptions = () => ({
  claude: {
    permission_mode: "default",
    permission_source: "setting",
    approval_decider: "user",
    claude_policy: resolveClaudePolicy(claudeOverrideDefaults),
  },
});

export const at = (minutes: number) =>
  new Date(Date.parse("2026-10-02T08:00:00Z") + minutes * 60000).toISOString();

export const timestamps = (start: number, minutes: number) => ({
  created_at: at(start),
  updated_at: at(start + minutes),
});

// Stand-ins for a worktree task's Git fields. The fixture service replaces
// them with a real repository's (dev/panel/scenarios/change-fixtures.ts).
export const FAKE_COMMIT = "4f1c2d9e8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e";

export const worktree = (id: string) => ({
  workspace: `/demo/data/worktrees/${id}`,
  branch: `agent/${id}`,
  base_commit: FAKE_COMMIT,
});
