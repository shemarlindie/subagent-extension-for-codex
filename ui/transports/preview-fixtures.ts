import type { Task, Event, Artifact } from "../../src/core/model";
const base = {
  owner: "preview",
  provider: "claude" as const,
  worker_profile: "reviewer" as const,
  repository: "/demo/project",
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
    title: "Review authentication boundaries",
    description:
      "Review the authentication boundary. Identify risky paths, cite evidence with file paths, and recommend concrete next steps.",
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
    title: "Investigate session expiry regression",
    description:
      "Trace the session expiry regression and identify the first incorrect state transition.",
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
    title: "Trace task refresh behavior",
    description:
      "Follow task refresh from the event stream to the inspector and identify stale-state risks.",
    worker_profile: "researcher",
    status: "running",
  },
  {
    ...base,
    id: "preview-interrupted",
    title: "Tighten the task inspector layout",
    description:
      "Improve the task inspector layout while preserving keyboard navigation and narrow-panel behavior.",
    worker_profile: "implementer",
    status: "interrupted",
  },
  {
    ...base,
    id: "preview-locked",
    title: "Inspect an uncertain shutdown",
    description:
      "Determine whether the interrupted worker has stopped before allowing another attempt.",
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
// Synthetic wire responses exercise the same activity views as a live connection.
previewEvents.push(
  ...[
    {
      type: "system",
      subtype: "api_retry",
      attempt: 1,
      max_retries: 3,
      retry_delay_ms: 1000,
      error: "rate_limit",
    },
    {
      type: "system",
      subtype: "notification",
      text: "Session validation review is complete.",
      priority: "low",
    },
    {
      type: "system",
      subtype: "compact_boundary",
      compact_metadata: {
        trigger: "auto",
        pre_tokens: 42000,
        post_tokens: 8000,
      },
    },
  ].map((response, index): Event => ({
    id: index + 3,
    task_id: "preview-review",
    type: "claude.activity",
    timestamp: base.updated_at,
    data: {
      ...response,
      raw_response: {
        ...response,
        uuid: `preview-${index}`,
        session_id: "preview-session",
      },
    },
  })),
  {
    id: 6,
    task_id: "preview-review",
    type: "agent.content",
    timestamp: base.updated_at,
    data: {
      role: "assistant",
      content: {
        type: "thinking",
        thinking:
          "Checking how the UI handles an expired session before reporting the findings.",
      },
      raw_response: {
        type: "assistant",
        uuid: "preview-thinking",
        message: {
          content: [
            {
              type: "thinking",
              thinking:
                "Checking how the UI handles an expired session before reporting the findings.",
              signature: "synthetic-signature",
            },
          ],
        },
      },
    },
  },
);
const timelineExamples: [string, string, Record<string, unknown>][] = [
  [
    "preview-review",
    "tool.started",
    { id: "preview-read", name: "Read", input: { file_path: "src/auth.ts" } },
  ],
  [
    "preview-review",
    "claude.activity",
    {
      type: "tool_progress",
      tool_use_id: "preview-read",
      tool_name: "Read",
      elapsed_time_seconds: 1,
    },
  ],
  [
    "preview-review",
    "tool.completed",
    {
      id: "preview-read",
      error: false,
      content: [
        {
          type: "text",
          text: "Read 86 lines from src/auth.ts. Session expiry is checked before task lookup.",
        },
      ],
    },
  ],
  [
    "preview-review",
    "claude.activity",
    {
      type: "system",
      subtype: "hook_started",
      hook_id: "preview-hook",
      hook_name: "Validate workspace",
      hook_event: "PreToolUse",
    },
  ],
  [
    "preview-review",
    "claude.activity",
    {
      type: "system",
      subtype: "hook_response",
      hook_id: "preview-hook",
      hook_name: "Validate workspace",
      outcome: "success",
      output: "Workspace boundary verified",
      exit_code: 0,
    },
  ],
  [
    "preview-running",
    "agent.started",
    { model: "Claude", tools: ["Read", "Grep"] },
  ],
  [
    "preview-running",
    "agent.message",
    { text: "I’m tracing how task refresh handles session expiry." },
  ],
  [
    "preview-running",
    "tool.started",
    {
      id: "preview-grep",
      name: "Grep",
      input: { pattern: "session|refresh", path: "ui/core" },
    },
  ],
  [
    "preview-running",
    "claude.activity",
    {
      type: "tool_progress",
      tool_use_id: "preview-grep",
      tool_name: "Grep",
      elapsed_time_seconds: 2,
    },
  ],
  [
    "preview-running",
    "claude.activity",
    {
      type: "tool_progress",
      tool_use_id: "preview-grep",
      tool_name: "Grep",
      elapsed_time_seconds: 4,
    },
  ],
];
previewEvents.push(
  ...timelineExamples.map(([task_id, type, data], index): Event => ({
    id: index + 7,
    task_id,
    type,
    timestamp: base.updated_at,
    data: {
      ...data,
      raw_response: {
        ...data,
        uuid: `timeline-${index}`,
        session_id: "preview-session",
      },
    },
  })),
);
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
