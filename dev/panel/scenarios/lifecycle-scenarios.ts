import type { Task } from "../../../src/shared/tasks/model";
import {
  at,
  FAKE_COMMIT,
  OTHER_THREAD,
  settingOptions,
  taskBase,
  timestamps,
  WEBSITE,
  worktree,
} from "./scenario-context";
import {
  begin,
  lifecycle,
  rateLimit,
  resultUsage,
  SESSION,
  Timeline,
} from "./timeline";

// --- Failed run: tool error, denied permission, mirror error ------------------
const failed = new Timeline("preview-failed", at(30), 200);
begin(failed, ["Read", "Edit", "Bash"]);
rateLimit(failed);
failed.say("I'll run the flaky test in a loop to reproduce it.");

const flaky = failed.toolStart("Bash", {
  command: "npm test -- retry.test.ts --repeat 20",
});

failed.toolProgress(flaky, "Bash", 3);
failed.toolProgress(flaky, "Bash", 6);

failed.toolDone(
  flaky,
  "FAIL retry.test.ts\n  ● retries with backoff\n    expected 3 calls, received 2\n\nTest Suites: 1 failed, 1 total",
  true,
);

failed.sdk({
  type: "system",
  subtype: "permission_denied",
  tool_name: "Edit",
  tool_use_id: "toolu_preview-failed_denied",
  message: "Edit is not allowed in plan mode.",
});

failed.sdk({
  type: "system",
  subtype: "mirror_error",
  error: "Transcript sync failed: disk quota exceeded",
  key: { projectKey: "demo-project", sessionId: SESSION },
});

rateLimit(failed, "rejected");

failed.result({
  type: "result",
  subtype: "error_max_turns",
  duration_ms: 310000,
  duration_api_ms: 280000,
  is_error: true,
  num_turns: 30,
  stop_reason: null,
  total_cost_usd: 1.18,
  usage: resultUsage(18000, 4200),
  modelUsage: {},
  permission_denials: [
    {
      tool_name: "Edit",
      tool_use_id: "toolu_preview-failed_denied",
      tool_input: { file_path: "src/retry.ts" },
    },
  ],
  errors: ["Reached the maximum number of turns before finishing."],
  uuid: "00000000-0000-4000-8000-000000299999",
  session_id: SESSION,
});

failed.turnEnded(1, "failed", 412000, 1.18);

failed.add(
  "task.failed",
  { error: "Worker stopped: reached the maximum number of turns." },
  200,
);

// The user removed the worktree afterwards; the branch is kept.
failed.add(
  "task.worktree_removed",
  {
    path: "/demo/data/worktrees/preview-failed",
    branch: "agent/preview-failed",
    forced: false,
  },
  60000,
);

// --- Running: permission flow, background work, compaction, streaming ---------
const refactor = new Timeline("preview-refactor", at(60), 400);
begin(refactor, ["Read", "Edit", "Bash", "Task"]);
rateLimit(refactor);
refactor.sdk({ type: "system", subtype: "status", status: "requesting" });
refactor.think("Planning the module split before touching files.");
refactor.say("Splitting billing into invoices and payments.");

refactor.add("agent.input_required", {
  request: {
    id: "preview-refactor-request",
    tool: "Bash",
    kind: "permission",
    input: { command: "npm run build", description: "Build the new modules." },
  },
});

refactor.add("agent.input_decision", {
  request_id: "preview-refactor-request",
  approved: true,
  authority: "user",
});

refactor.add("agent.input_submitted", { approved: true }, 200);

refactor.sdk({
  type: "system",
  subtype: "task_started",
  task_id: "preview-bg-tests",
  description: "Run the billing test suite in the background",
});

refactor.sdk({
  type: "system",
  subtype: "task_progress",
  task_id: "preview-bg-tests",
  description: "Running 42 tests",
  usage: { total_tokens: 1200, tool_uses: 3, duration_ms: 8000 },
});

refactor.sdk({
  type: "system",
  subtype: "task_updated",
  task_id: "preview-bg-tests",
  patch: { status: "running", description: "Running 42 tests · 18 done" },
});

refactor.sdk({
  type: "system",
  subtype: "background_tasks_changed",
  tasks: [
    {
      task_id: "preview-bg-tests",
      task_type: "local_bash",
      description: "Running 42 tests",
    },
  ],
});

refactor.sdk({
  type: "system",
  subtype: "task_started",
  task_id: "preview-bg-lint",
  description: "Lint the new modules",
});

refactor.sdk({
  type: "system",
  subtype: "task_updated",
  task_id: "preview-bg-lint",
  patch: { status: "killed", description: "Superseded by the test run" },
});

refactor.sdk({
  type: "system",
  subtype: "task_notification",
  task_id: "preview-bg-tests",
  status: "completed",
  output_file: "/demo/project/.tasks/preview-bg-tests.log",
  summary: "42 tests passed",
});

refactor.sdk({ type: "system", subtype: "status", status: "compacting" });

refactor.sdk({
  type: "system",
  subtype: "compact_boundary",
  compact_metadata: {
    trigger: "manual",
    pre_tokens: 90000,
    post_tokens: 12000,
  },
});

refactor.sdk({
  type: "system",
  subtype: "local_command_output",
  content: "Compacted context · 12k tokens kept",
});

const edit = refactor.toolStart("Edit", {
  file_path: "src/billing/invoices.ts",
  old_string: "export function charge(",
  new_string: "export function chargeInvoice(",
});

refactor.toolProgress(edit, "Edit", 2);

refactor.streamed(
  [
    "The new `payments` module exposes ",
    "`chargeInvoice` and `refundPayment`. ",
    "I'm updating the call sites",
  ],
  false,
);

// --- Interrupted while a tool was left running, then discarded ----------------
const release = new Timeline("preview-release", at(75), 500);
begin(release, ["Read", "WebFetch"]);
release.say("Drafting release notes from the merged pull requests.");

const fetch = release.toolStart("WebFetch", {
  url: "https://example.com/releases",
});

release.toolProgress(fetch, "WebFetch", 5);
release.add("task.control_requested", { status: "interrupted" }, 400);
release.turnEnded(1, "interrupted", 8000, 0.06);
release.add("task.interrupted", {}, 200);

// The user discarded the work: worktree, then branch.
release.add(
  "task.worktree_removed",
  {
    path: "/demo/data/worktrees/preview-release",
    branch: "agent/preview-release",
    forced: true,
  },
  30000,
);

release.add("task.branch_deleted", { branch: "agent/preview-release" }, 5000);

const interrupted = lifecycle(
  "preview-interrupted",
  20,
  ["task.queued"],
  ["task.started", { turn: 1 }],
  ["task.control_requested", { status: "interrupted" }],
  [
    "task.turn_ended",
    { turn: 1, outcome: "interrupted", runtime_ms: 70000, cost_usd: 0 },
  ],
  ["task.interrupted"],
  // A second turn, so the Changes tab offers This turn.
  [
    "task.instruction",
    {
      message_id: "msg_preview_interrupted_1",
      message: "Keep keyboard navigation unchanged.",
      from: "parent",
      delivery: "steer",
    },
  ],
  ["task.queued"],
  ["task.started", { turn: 2 }],
  [
    "task.turn_ended",
    { turn: 2, outcome: "interrupted", runtime_ms: 55000, cost_usd: 0 },
  ],
  ["task.interrupted", { reason: "service_restart" }],
);

// --- Changes: a 60-file diff from large-files.ts, for the Changes tab -------
const build = lifecycle(
  "preview-build",
  105,
  ["task.queued"],
  ["task.started", { turn: 1 }],
  [
    "agent.reply",
    {
      text: "Cached module compilation in 60 files: every build module now uses the cached compiler.",
      turn: 1,
    },
  ],
  [
    "task.turn_ended",
    { turn: 1, outcome: "completed", runtime_ms: 210000, cost_usd: 1.04 },
  ],
  [
    "task.completed",
    {
      reply:
        "Cached module compilation in 60 files: every build module now uses the cached compiler.",
    },
  ],
);

// --- Changes: every file in large-files.ts, for the file previews ----------
const profile = lifecycle(
  "preview-profile",
  107,
  ["task.queued"],
  ["task.started", { turn: 1 }],
  [
    "agent.reply",
    {
      text: "Wrote the build profile and its reports: the build log, size reports and a dependency graph.",
      turn: 1,
    },
  ],
  [
    "task.turn_ended",
    { turn: 1, outcome: "completed", runtime_ms: 260000, cost_usd: 1.31 },
  ],
  [
    "task.completed",
    {
      reply:
        "Wrote the build profile and its reports: the build log, size reports and a dependency graph.",
    },
  ],
);

// --- A follow-up after its worktree was removed: the worktree comes back from
// its branch, and a new session starts since the old one was unavailable ------
const resumedReplies = [
  "Made the retry test wait for the mocked clock instead of real time, so it no longer races the timer.",
  "Covered the timeout path too: the test now checks that the third retry gives up after the configured delay.",
];

const resumed = lifecycle(
  "preview-resumed",
  112,
  ["task.queued"],
  ["task.started", { turn: 1 }],
  [
    "agent.reply",
    {
      text: resumedReplies[0],
      turn: 1,
    },
  ],
  [
    "task.turn_ended",
    { turn: 1, outcome: "completed", runtime_ms: 98000, cost_usd: 0.41 },
  ],
  ["task.completed", { reply: resumedReplies[0] }],
  [
    "task.worktree_removed",
    {
      path: "/demo/data/worktrees/preview-resumed",
      branch: "agent/preview-resumed",
      forced: false,
    },
  ],
  [
    "task.instruction",
    {
      message_id: "msg_preview_resumed_1",
      message: "Also cover the timeout path.",
      from: "user",
      delivery: "steer",
    },
  ],
  ["task.queued"],
  ["task.worktree_recreated", { from: "branch" }],
  ["task.session_started", { reason: "session_unavailable" }],
  ["task.started", { turn: 2 }],
  [
    "agent.reply",
    {
      text: resumedReplies[1],
      turn: 2,
    },
  ],
  [
    "task.turn_ended",
    { turn: 2, outcome: "completed", runtime_ms: 88000, cost_usd: 0.47 },
  ],
  ["task.completed", { reply: resumedReplies[1] }],
);

const dependent = lifecycle(
  "preview-dependent",
  95,
  ["task.queued"],
  [
    "task.waiting",
    { reason: "waiting_for_dependency", dependency_id: "preview-interrupted" },
  ],
);

export const lifecycleTasks: Task[] = [
  {
    ...taskBase,
    id: "preview-failed",
    title: "Fix the flaky retry test",
    description:
      "Find why retry.test.ts fails intermittently and propose a fix.",
    worker_profile: "debugger",
    provider_options: settingOptions("debugger"),
    status: "failed",
    error: "Worker stopped: reached the maximum number of turns.",
    runtime_ms: 310000,
    cost_usd: 1.18,
    // Its worktree was removed; the Changes tab names the branch.
    ...worktree("preview-failed"),
    ...timestamps(30, 6),
  },
  {
    ...taskBase,
    id: "preview-refactor",
    title: "Refactor the billing module",
    description:
      "Split billing into invoices and payments without changing public behaviour.\n\nKeep the exported API stable: existing callers import from billing/index.\nMove invoice rendering, tax calculation and PDF export into billing/invoices, and charge, refund and webhook handling into billing/payments.\n\nDo not touch the database schema. Add tests for any code that moves, and run the full billing suite before finishing.",
    worker_profile: "implementer",
    provider_options: settingOptions("implementer"),
    status: "running",
    workspace_strategy: "current_repo",
    budget: { max_runtime_minutes: null, max_cost_usd: null },
    runtime_ms: 90000,
    workspace: "/demo/project",
    base_commit: FAKE_COMMIT,
    // Relative to load so the live clock reads as a run already under way.
    run_started_at: new Date(Date.now() - 125000).toISOString(),
    ...timestamps(60, 4),
  },
  {
    ...taskBase,
    id: "preview-release",
    title: "Draft the release notes",
    description: "Summarise merged pull requests into release notes.",
    conversation_id: OTHER_THREAD,
    status: "interrupted",
    // Its worktree and branch were deleted.
    ...worktree("preview-release"),
    ...timestamps(75, 1),
  },
  {
    ...taskBase,
    id: "preview-queued",
    title: "Review the onboarding copy",
    description: "Read the onboarding screens and suggest clearer wording.",
    worker_profile: "reviewer",
    conversation_id: OTHER_THREAD,
    status: "queued",
    ...timestamps(80, 0),
  },
  {
    ...taskBase,
    id: "preview-starting",
    title: "Check accessibility of the settings page",
    description:
      "Audit keyboard and screen reader behaviour of the settings page.",
    worker_profile: "reviewer",
    repository: WEBSITE,
    status: "starting",
    ...timestamps(82, 0),
  },
  {
    ...taskBase,
    id: "preview-interrupted",
    title: "Tighten the task inspector layout",
    description:
      "Improve the task inspector layout while preserving keyboard navigation and narrow-panel behavior.",
    worker_profile: "implementer",
    provider_options: settingOptions("implementer"),
    status: "interrupted",
    turn: 2,
    instructions: [
      {
        id: "msg_preview_interrupted_1",
        message: "Keep keyboard navigation unchanged.",
        from: "parent",
      },
    ],
    instructions_sent: 1,
    runtime_ms: 125000,
    ...worktree("preview-interrupted"),
    ...timestamps(20, 2),
  },
  {
    ...taskBase,
    id: "preview-dependent",
    title: "Review the inspector layout change",
    description:
      "Review the inspector layout change once it finishes, checking keyboard navigation.",
    worker_profile: "reviewer",
    status: "waiting",
    waiting_reason: "waiting_for_dependency",
    waiting_for: "preview-interrupted",
    depends_on: ["preview-interrupted"],
    ...timestamps(95, 0),
  },
  {
    ...taskBase,
    id: "preview-build",
    title: "Speed up the production build",
    description: "Cache module compilation across the build's source files.",
    worker_profile: "implementer",
    provider_options: settingOptions("implementer"),
    status: "completed",
    runtime_ms: 210000,
    cost_usd: 1.04,
    ...worktree("preview-build"),
    ...timestamps(105, 4),
  },
  {
    ...taskBase,
    id: "preview-profile",
    title: "Profile the production build",
    description:
      "Profile the production build and write reports on chunk and module sizes.",
    worker_profile: "implementer",
    provider_options: settingOptions("implementer"),
    status: "completed",
    runtime_ms: 260000,
    cost_usd: 1.31,
    ...worktree("preview-profile"),
    ...timestamps(107, 5),
  },
  {
    ...taskBase,
    id: "preview-resumed",
    title: "Stabilise the retry timer test",
    description:
      "Make the retry test independent of real time so it stops failing on slow machines.",
    worker_profile: "test_engineer",
    status: "completed",
    turn: 2,
    instructions: [
      {
        id: "msg_preview_resumed_1",
        message: "Also cover the timeout path.",
        from: "user",
      },
    ],
    instructions_sent: 1,
    runtime_ms: 186000,
    cost_usd: 0.88,
    ...worktree("preview-resumed"),
    ...timestamps(112, 40),
  },
];

export const lifecycleTimelines = [
  failed,
  refactor,
  release,
  interrupted,
  dependent,
  build,
  profile,
  resumed,
];
