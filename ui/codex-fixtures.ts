import type { Task, Event, Artifact } from "../src/model";
const base = {
  owner: "preview",
  provider: "claude" as const,
  worker_profile: "reviewer" as const,
  repository: "current",
  revision: "HEAD",
  depends_on: [],
  context: [],
  workspace_strategy: "worktree" as const,
  budget: { max_runtime_minutes: 20, max_cost_usd: 5 },
  created_at: "2026-10-02T07:10:00Z",
  updated_at: "2026-10-02T07:12:00Z",
  instructions: [],
  attempt: 1,
  runtime_ms: 78000,
};
export const previewTasks: Task[] = [
  {
    ...base,
    id: "preview-review",
    task: "Review authentication boundaries",
    status: "completed",
    workspace: "/fixture/worktrees/preview-review",
    result: {
      summary:
        "The authentication boundary is consistent. One session expiry edge case needs attention before merging.",
      findings: [
        "An expired session can leave stale task details visible until the next request.",
      ],
      evidence: ["Inspected session validation and owner-scoped task lookup."],
      changes: [],
      tests: ["No tests run; read-only review."],
      recommendations: [
        "Clear sensitive UI state when authentication expires.",
      ],
    },
  },
  {
    ...base,
    id: "preview-input",
    task: "Investigate the session expiry regression",
    worker_profile: "debugger",
    status: "waiting",
    waiting_reason: "waiting_for_permission",
    pending_input: {
      id: "preview-request",
      tool: "Bash",
      input: {
        command: "npm run typecheck",
        description: "Check the session-state change in the isolated worktree.",
      },
    },
  },
  {
    ...base,
    id: "preview-running",
    task: "Trace task refresh behavior",
    worker_profile: "researcher",
    status: "running",
  },
  {
    ...base,
    id: "preview-interrupted",
    task: "Tighten the task inspector layout",
    worker_profile: "implementer",
    status: "interrupted",
  },
  {
    ...base,
    id: "preview-locked",
    task: "Inspect an uncertain shutdown",
    status: "waiting",
    waiting_reason: "termination_unconfirmed",
    error: "Worker termination is unconfirmed; controls remain locked.",
  },
];
export const previewEvents: Event[] = [
  {
    id: 1,
    task_id: "preview-review",
    type: "task.started",
    timestamp: base.created_at,
    data: { text: "Started Claude reviewer in an isolated worktree." },
  },
  {
    id: 2,
    task_id: "preview-review",
    type: "tool.completed",
    timestamp: base.updated_at,
    data: { text: "Read session validation and task ownership checks." },
  },
];
export const previewArtifacts: Artifact[] = [
  {
    id: "preview-report",
    task_id: "preview-review",
    type: "report",
    title: "Authentication review",
    content: JSON.stringify(previewTasks[0].result, null, 2),
    mime_type: "application/json",
    created_at: base.updated_at,
  },
];
