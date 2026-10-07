// Synthetic tasks that together exercise every task status and every Claude SDK
// message kind the panel can render. SDK messages are typed against
// `@anthropic-ai/claude-agent-sdk`, so a wrong or missing field fails the type
// check, and ui/dev/preview/preview-sdk-fixtures.test.ts replays them through the provider's
// own `normalize` to prove the derived events match. All content is invented.
import type {
  SDKAssistantMessage,
  SDKMessage,
  SDKResultMessage,
  SDKSystemMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";

import { claudeActivityPresentation } from "../../../src/features/providers/claude/activity";
import type { Event, Task } from "../../../src/shared/contracts";

type Data = Record<string, unknown>;

type Uuid = SDKAssistantMessage["uuid"];

type Beta = SDKAssistantMessage["message"];

type AssistantBlock = Beta["content"][number];

type UserContent = Exclude<SDKUserMessage["message"]["content"], string>;

type UserBlock = UserContent[number];

/** SDK messages built by `sdk()`; the others have dedicated builders. */
type Plain = Exclude<
  SDKMessage,
  SDKAssistantMessage | SDKUserMessage | SDKResultMessage | SDKSystemMessage
>;

type Body<T> = T extends unknown ? Omit<T, "uuid" | "session_id"> : never;

const SESSION = "preview-session";
const MODEL = "claude-sonnet-5-5";

// A 64×64 checkerboard PNG, small enough to inline.
const IMAGE =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAa0lEQVR42u3XMQ0AIAxFQYRVE3LQhBJ0YKBMXSBcwtiBm15+WyPSF32m77b7BgAAAABQArzy0dM9AAAAAEANoMQAAAAA9oASAwAAANgDSgwAAABgDygxAAAAgD2gxAAAAAD2gBIDAAAAfAPY6lJReJDUYR4AAAAASUVORK5CYII=";

/** Registered projects. Thread "dev-thread" has tasks in both. */
export const previewProjects = [
  { repository: "/demo/project", name: "Demo project", kind: "repository" },
  { repository: "/demo/website", name: "Demo website", kind: "repository" },
];

/** The dev host's default Thread ID; most tasks belong to it. */
export const PREVIEW_THREAD = "dev-thread";
const OTHER_THREAD = "other-thread";
const WEBSITE = previewProjects[1]!.repository;

const taskBase = {
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
  budget: { max_runtime_minutes: 20, max_cost_usd: 5 },
  created_by: "user" as const,
  instructions: [],
  instructions_sent: 0,
  pending_steers: [],
  queue: [],
  turn: 1,
  runtime_ms: 0,
};

const usage: Beta["usage"] = {
  cache_creation: null,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  inference_geo: null,
  input_tokens: 120,
  iterations: null,
  output_tokens: 48,
  server_tool_use: null,
  service_tier: "standard",
  speed: "standard",
};

const resultUsage = (
  input_tokens: number,
  output_tokens: number,
): SDKResultMessage["usage"] => ({
  cache_creation: {
    ephemeral_1h_input_tokens: 0,
    ephemeral_5m_input_tokens: 0,
  },
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  inference_geo: "not_available",
  input_tokens,
  iterations: [],
  output_tokens,
  server_tool_use: { web_fetch_requests: 0, web_search_requests: 0 },
  service_tier: "standard",
  speed: "standard",
});

const text = (value: string): AssistantBlock => ({
  type: "text",
  text: value,
  citations: null,
});

/** Builds ordered events for one task with stable ids and timestamps. */
class Timeline {
  readonly events: Event[] = [];
  private clock: number;
  private count = 0;
  private uuids = 0;
  private tools = 0;
  private messages = 0;
  constructor(
    readonly taskId: string,
    start: string,
    private readonly firstId: number,
  ) {
    this.clock = Date.parse(start);
  }

  get end() {
    return new Date(this.clock).toISOString();
  }

  private uuid(): Uuid {
    return `00000000-0000-4000-8000-${String(this.firstId * 1000 + ++this.uuids).padStart(12, "0")}`;
  }

  private messageId = () => `msg_${this.taskId}_${++this.messages}`;
  /** An event the service records itself (task lifecycle, input). */
  add(type: string, data: Data = {}, gapMs = 1500) {
    this.clock += gapMs;

    this.events.push({
      id: this.firstId + this.count++,
      task_id: this.taskId,
      type,
      timestamp: new Date(this.clock).toISOString(),
      data: data.raw_response
        ? { ...data, activity: claudeActivityPresentation({ type, data }) }
        : data,
    });

    return this;
  }

  /** Most SDK messages surface unchanged as `claude.activity`. */
  sdk(body: Body<Plain>, gapMs?: number) {
    const message = {
      ...body,
      uuid: this.uuid(),
      session_id: SESSION,
    } as Plain;

    return this.add(
      "claude.activity",
      { ...message, raw_response: message },
      gapMs,
    );
  }

  init(tools: string[]) {
    const message: SDKSystemMessage = {
      type: "system",
      subtype: "init",
      apiKeySource: "none",
      claude_code_version: "2.1.288",
      cwd: "/demo/project",
      tools,
      mcp_servers: [],
      model: MODEL,
      permissionMode: "plan",
      slash_commands: [],
      output_style: "default",
      skills: [],
      plugins: [],
      uuid: this.uuid(),
      session_id: SESSION,
    };

    return this.add("agent.started", {
      model: message.model,
      tools: message.tools,
      raw_response: message,
    });
  }

  /** One assistant message; each content block becomes its own event. */
  assistant(
    content: AssistantBlock[],
    id = this.messageId(),
    stop: Beta["stop_reason"] = null,
  ) {
    const message: SDKAssistantMessage = {
      type: "assistant",
      message: {
        id,
        container: null,
        content,
        context_management: null,
        model: MODEL,
        role: "assistant",
        stop_details: null,
        stop_reason: stop,
        stop_sequence: null,
        type: "message",
        usage,
      },
      parent_tool_use_id: null,
      uuid: this.uuid(),
      session_id: SESSION,
    };

    for (const block of content) {
      if (block.type === "text")
        this.add("agent.message", {
          role: "assistant",
          text: block.text,
          content: block,
          raw_response: message,
        });
      else if (block.type === "tool_use")
        this.add("tool.started", {
          id: block.id,
          name: block.name,
          input: block.input,
          raw_response: message,
        });
      else
        this.add("agent.content", {
          role: "assistant",
          content: block,
          raw_response: message,
        });
    }

    return this;
  }

  /** One user message; tool results become `tool.completed` events. */
  userMessage(content: UserContent) {
    const message: SDKUserMessage = {
      type: "user",
      message: { role: "user", content },
      parent_tool_use_id: null,
      uuid: this.uuid(),
      session_id: SESSION,
    };

    for (const block of content) {
      if (block.type === "text")
        this.add("agent.content", {
          role: "user",
          text: block.text,
          content: block,
          raw_response: message,
        });
      else if (block.type === "tool_result")
        this.add("tool.completed", {
          id: block.tool_use_id,
          error: block.is_error,
          content: block.content,
          raw_response: message,
        });
      else
        this.add("agent.content", {
          role: "user",
          content: block,
          raw_response: message,
        });
    }

    return this;
  }

  say(value: string, id?: string) {
    return this.assistant([text(value)], id);
  }

  think(thinking: string, id?: string) {
    return this.assistant(
      [{ type: "thinking", thinking, signature: "synthetic-signature" }],
      id,
    );
  }

  user(value: string) {
    return this.userMessage([{ type: "text", text: value }]);
  }

  /** Thinking-token ticks that precede a reasoning step. */
  ticks(...estimates: number[]) {
    let previous = 0;

    for (const estimated_tokens of estimates) {
      this.sdk(
        {
          type: "system",
          subtype: "thinking_tokens",
          estimated_tokens,
          estimated_tokens_delta: estimated_tokens - previous,
        },
        600,
      );

      previous = estimated_tokens;
    }

    return this;
  }

  toolStart(name: string, input: Data) {
    const id = `toolu_${this.taskId}_${++this.tools}`;
    this.assistant([{ type: "tool_use", id, name, input }]);

    return id;
  }

  toolProgress(id: string, name: string, seconds: number) {
    return this.sdk(
      {
        type: "tool_progress",
        tool_use_id: id,
        tool_name: name,
        parent_tool_use_id: null,
        elapsed_time_seconds: seconds,
      },
      1000,
    );
  }

  toolDone(
    id: string,
    content: string | (UserBlock & { type: "text" | "image" })[],
    error?: boolean,
  ) {
    return this.userMessage([
      { type: "tool_result", tool_use_id: id, content, is_error: error },
    ]);
  }

  /** A complete tool call: start, optional progress ticks, then its result. */
  tool(
    name: string,
    input: Data,
    content: Parameters<Timeline["toolDone"]>[1],
    options: { error?: boolean; progress?: number[] } = {},
  ) {
    const id = this.toolStart(name, input);
    for (const seconds of options.progress ?? [])
      this.toolProgress(id, name, seconds);

    return this.toolDone(id, content, options.error);
  }

  stream(event: Extract<Plain, { type: "stream_event" }>["event"]) {
    return this.sdk(
      { type: "stream_event", event, parent_tool_use_id: null },
      120,
    );
  }

  /** A streamed text response, optionally left unfinished (still running). */
  streamed(chunks: string[], finish = true) {
    const id = this.messageId();

    this.stream({
      type: "message_start",
      message: {
        id,
        container: null,
        content: [],
        context_management: null,
        model: MODEL,
        role: "assistant",
        stop_details: null,
        stop_reason: null,
        stop_sequence: null,
        type: "message",
        usage,
      },
    });

    this.stream({
      type: "content_block_start",
      index: 0,
      content_block: text(""),
    });

    for (const chunk of chunks)
      this.stream({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: chunk },
      });

    if (finish) {
      this.stream({ type: "content_block_stop", index: 0 });
      this.stream({ type: "message_stop" });
    }

    return this;
  }

  /**
   * The turn's result message, then the service's `agent.reply` and
   * `task.completed`.
   */
  finish(
    text: string,
    turn = 1,
    fields: Partial<Extract<SDKResultMessage, { subtype: "success" }>> = {},
  ) {
    return this.turnResult(text, fields)
      .reply(text, turn)
      .turnEnded(turn, "completed", fields.duration_ms, fields.total_cost_usd)
      .add("task.completed", { reply: text }, 200);
  }

  /** The service's record of how a turn ended, for its outcome row. */
  turnEnded(
    turn: number,
    outcome: "completed" | "failed" | "interrupted",
    runtime_ms = 64000,
    cost_usd = 0.42,
  ) {
    return this.add(
      "task.turn_ended",
      { turn, outcome, runtime_ms, cost_usd },
      100,
    );
  }

  /** The service's record of a turn's reply, with its snapshots. */
  reply(text: string, turn = 1) {
    return this.add(
      "agent.reply",
      {
        text,
        turn,
        start_tree: `${FAKE_TREE}${turn}s`,
        end_tree: `${FAKE_TREE}${turn}e`,
      },
      100,
    );
  }

  /** The turn's result alone: the task is still running until the service records its end. */
  turnResult(
    summary: string,
    fields: Partial<Extract<SDKResultMessage, { subtype: "success" }>> = {},
  ) {
    return this.result({
      type: "result",
      subtype: "success",
      duration_ms: 64000,
      duration_api_ms: 51000,
      is_error: false,
      num_turns: 9,
      result: summary,
      stop_reason: "end_turn",
      total_cost_usd: 0.42,
      usage: resultUsage(4200, 980),
      modelUsage: {},
      permission_denials: [],
      uuid: this.uuid(),
      session_id: SESSION,
      ...fields,
    });
  }

  result(message: SDKResultMessage) {
    return this.add("agent.completed", {
      ...message,
      cost_usd: message.total_cost_usd,
      usage: message.usage,
      raw_response: message,
    });
  }
}

const begin = (t: Timeline, tools: string[]) =>
  t
    .add("task.queued", {}, 100)
    .add("task.started", { turn: 1 }, 300)
    .init(tools);

const rateLimit = (t: Timeline, status: "allowed" | "rejected" = "allowed") =>
  t.sdk({
    type: "rate_limit_event",
    rate_limit_info: {
      status,
      rateLimitType: "five_hour",
      resetsAt: 1791030000,
      utilization: status === "rejected" ? 1 : 0.12,
    },
  });

const at = (minutes: number) =>
  new Date(Date.parse("2026-10-02T08:00:00Z") + minutes * 60000).toISOString();

const timestamps = (start: number, minutes: number) => ({
  created_at: at(start),
  updated_at: at(start + minutes),
});

// Stand-ins for the snapshot trees a reply records, with a turn suffix.
const FAKE_TREE = "9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0";

// Stand-ins for a worktree task's Git fields. The fixture service replaces
// them with a real repository's (ui/dev/preview/change-fixtures.ts).
const FAKE_COMMIT = "4f1c2d9e8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e";

const worktree = (id: string) => ({
  workspace: `/demo/data/worktrees/${id}`,
  branch: `agent/${id}`,
  base_commit: FAKE_COMMIT,
});

const auditReply = `Two dependencies use licences that need review before release; the rest are permissive.

- \`legacy-charts\` is GPL-3.0 and is imported by the reporting bundle.
- \`fast-parse\` has no licence field, and its repository has no LICENSE file.

I read \`package.json\` and \`package-lock.json\`, and checked the licence field of each installed package. No tests were run, since this was a read-only audit.

**Left to do:** replace \`legacy-charts\` or isolate it behind a separate process, and ask the \`fast-parse\` maintainers to add a licence before adopting it.`;

const blocksReply = `Catalogued the design assets and flagged one mismatched icon size: \`logo-small.png\` is 64×64 px, but the manifest expects 128×128.

I added \`assets/README.md\` with the expected sizes, and \`npm run lint\` passes. The small logo should be regenerated from the vector source.`;

const questionInput = {
  questions: [
    {
      question: "Which config format should the loader support first?",
      header: "Format",
      multiSelect: false,
      options: [
        { label: "YAML", description: "Readable; needs a parser dependency." },
        { label: "TOML", description: "Strict and small; fewer surprises." },
        { label: "JSON", description: "Already parsed everywhere." },
      ],
    },
  ],
};

// One AskUserQuestion call stacks several questions, mixing single and multiple choice.
const stackedQuestionInput = {
  questions: [
    {
      question: "Which sign-in methods should ship in the first release?",
      header: "Methods",
      multiSelect: true,
      options: [
        { label: "Passkeys", description: "Phishing-resistant; newest flow." },
        { label: "Email link", description: "No password to remember." },
        { label: "Google", description: "Most requested by beta users." },
        { label: "GitHub", description: "Useful for the developer tier." },
      ],
    },
    {
      question: "How should existing sessions migrate?",
      header: "Sessions",
      multiSelect: false,
      options: [
        {
          label: "Keep them",
          description: "Old tokens stay valid until they expire.",
        },
        {
          label: "Sign out all",
          description: "Clean cut-over; everyone signs in again.",
        },
      ],
    },
    {
      question: "Where should the rollout start?",
      header: "Rollout",
      multiSelect: false,
      options: [
        { label: "Staff only", description: "Internal accounts for a week." },
        { label: "10% of users", description: "Gradual, behind a flag." },
        { label: "Everyone", description: "Single release, no flag." },
      ],
    },
  ],
};

// --- Completed research run with most row kinds ------------------------------
const audit = new Timeline("preview-audit", at(0), 100);
begin(audit, ["Glob", "Grep", "Read", "Bash"]);
rateLimit(audit);
audit.ticks(40, 120, 310);
audit.think("", "msg_audit_plan");

audit.say(
  "I'll start with the manifest, then check each dependency's licence field.",
  "msg_audit_plan",
);

const glob = audit.toolStart("Glob", { pattern: "**/package.json" });
audit.toolProgress(glob, "Glob", 1);

audit.toolDone(
  glob,
  "package.json\nnode_modules/legacy-charts/package.json\nnode_modules/fast-parse/package.json",
);

audit.sdk({
  type: "system",
  subtype: "hook_started",
  hook_id: "preview-audit-hook",
  hook_name: "Validate workspace",
  hook_event: "PreToolUse",
});

audit.sdk({
  type: "system",
  subtype: "hook_progress",
  hook_id: "preview-audit-hook",
  hook_name: "Validate workspace",
  hook_event: "PreToolUse",
  stdout: "checking boundary",
  stderr: "",
  output: "checking boundary",
});

audit.sdk({
  type: "system",
  subtype: "hook_response",
  hook_id: "preview-audit-hook",
  hook_name: "Validate workspace",
  hook_event: "PreToolUse",
  output: "Workspace boundary verified",
  stdout: "Workspace boundary verified",
  stderr: "",
  exit_code: 0,
  outcome: "success",
});

audit.tool(
  "Read",
  { file_path: "package.json" },
  '1\t{\n2\t  "name": "demo-project",\n3\t  "dependencies": {\n4\t    "legacy-charts": "^2.1.0",\n5\t    "fast-parse": "^0.4.2"\n6\t  }\n7\t}',
  { progress: [1] },
);

audit.sdk({
  type: "system",
  subtype: "api_retry",
  attempt: 1,
  max_retries: 3,
  retry_delay_ms: 2000,
  error_status: 529,
  error: "overloaded",
});

audit.ticks(80, 260);

audit.assistant(
  [
    {
      type: "thinking",
      thinking:
        "The two unusual dependencies are the ones to inspect. Grep the licence field next.",
      signature: "synthetic-signature",
    },
    text(
      "Checking licences with a search, then summarising:\n\n```sh\ngrep -h '\"license\"' node_modules/*/package.json | sort | uniq -c\n```",
    ),
  ],
  "msg_audit_grep",
);

audit.tool(
  "Grep",
  { pattern: '"license"', path: "node_modules" },
  'node_modules/legacy-charts/package.json:  "license": "GPL-3.0"\nnode_modules/chart-utils/package.json:  "license": "MIT"',
  { progress: [2, 4] },
);

audit.sdk({
  type: "system",
  subtype: "compact_boundary",
  compact_metadata: { trigger: "auto", pre_tokens: 41000, post_tokens: 7800 },
});

audit.sdk({
  type: "system",
  subtype: "files_persisted",
  files: [{ filename: "licence-report.md", file_id: "file_demo_1" }],
  failed: [],
  processed_at: at(2),
});

audit.sdk({
  type: "system",
  subtype: "notification",
  key: "scan-complete",
  text: "Licence scan complete.",
  priority: "low",
});

audit.sdk({
  type: "tool_use_summary",
  summary: "Read the manifest and scanned dependency licences.",
  preceding_tool_use_ids: [],
});

audit.finish(auditReply);

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

// --- Waiting on a question (AskUserQuestion) ---------------------------------
const question = new Timeline("preview-question", at(45), 300);
begin(question, ["Read", "Grep", "AskUserQuestion"]);
question.say("The loader has three plausible formats, so I need a decision.");

question.tool(
  "Grep",
  { pattern: "loadConfig", path: "src" },
  "src/config.ts:12:export function loadConfig(path: string)",
);

question.add("agent.input_required", {
  request: {
    id: "preview-question-request",
    tool: "AskUserQuestion",
    kind: "question",
    input: questionInput,
  },
});

question.sdk({
  type: "system",
  subtype: "session_state_changed",
  state: "requires_action",
});

// --- Waiting on stacked questions (one AskUserQuestion, several questions) ---
const stacked = new Timeline("preview-stacked-questions", at(50), 300);
begin(stacked, ["Read", "Grep", "AskUserQuestion"]);
stacked.say("The rollout plan depends on three product decisions.");

stacked.add("agent.input_required", {
  request: {
    id: "preview-stacked-questions-request",
    tool: "AskUserQuestion",
    kind: "question",
    input: stackedQuestionInput,
  },
});

stacked.sdk({
  type: "system",
  subtype: "session_state_changed",
  state: "requires_action",
});

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

// --- Content blocks and rarer messages ----------------------------------------
const blocks = new Timeline("preview-blocks", at(90), 600);
begin(blocks, ["Read", "WebSearch", "mcp__assets__list"]);

blocks.add("task.control_requested", { status: "interrupted" }, 200);
blocks.turnEnded(1, "interrupted", 21000, 0.18);
blocks.add("task.interrupted", {}, 200);

blocks.add(
  "task.instruction",
  {
    message_id: "msg_preview_blocks_1",
    message: "Also check the vendored icons.",
    from: "user",
    delivery: "steer",
  },
  200,
);

blocks.add("task.queued", {}, 100);
blocks.add("task.started", { turn: 2 }, 300);
blocks.user("Also check the vendored icons.");

blocks.assistant(
  [
    {
      type: "thinking",
      thinking: "The user wants the icon sizes too.",
      signature: "synthetic-signature",
    },
  ],
  "msg_blocks_a",
);

blocks.assistant([{ type: "redacted_thinking", data: "redacted" }]);
blocks.say("Looking at the asset folder first.", "msg_blocks_a");

blocks.tool("Read", { file_path: "assets/logo-small.png" }, [
  { type: "text", text: "Image preview of assets/logo-small.png" },
  {
    type: "image",
    source: { type: "base64", media_type: "image/png", data: IMAGE },
  },
]);

blocks.assistant([
  {
    type: "text",
    text: "The style guide lists the expected sizes.",
    citations: [
      {
        type: "page_location",
        cited_text: "Small logo: 128×128 px",
        document_index: 0,
        document_title: "Style guide",
        end_page_number: 5,
        file_id: null,
        start_page_number: 4,
      },
    ],
  },
]);

blocks.userMessage([
  {
    type: "document",
    title: "Style guide (excerpt)",
    source: {
      type: "text",
      media_type: "text/plain",
      data: "Small logo: 128×128 px\nLarge logo: 512×512 px",
    },
  },
]);

blocks.assistant([
  {
    type: "server_tool_use",
    id: "srvtoolu_preview_search",
    name: "web_search",
    input: { query: "png icon sizes" },
  },
  {
    type: "web_search_tool_result",
    tool_use_id: "srvtoolu_preview_search",
    content: [
      {
        type: "web_search_result",
        encrypted_content: "synthetic",
        page_age: null,
        title: "PNG sizing guide",
        url: "https://example.com/png",
      },
    ],
  },
]);

blocks.sdk({
  type: "prompt_suggestion",
  suggestion: "Regenerate the small logo from the SVG source.",
});

blocks.sdk({
  type: "system",
  subtype: "elicitation_complete",
  mcp_server_name: "assets",
  elicitation_id: "preview-elicitation",
});

blocks.sdk({
  type: "system",
  subtype: "plugin_install",
  status: "installed",
  name: "asset-tools",
});

blocks.sdk({
  type: "system",
  subtype: "memory_recall",
  mode: "select",
  memories: [{ path: "style-guide.md", scope: "personal" }],
});

blocks.say(
  'Done. Summary of sizes:\n\n```json\n{ "logo-small.png": "64x64", "logo.png": "512x512" }\n```',
);

blocks.finish(blocksReply, 2);

// --- Rare SDK signals and session housekeeping --------------------------------
const signals = new Timeline("preview-signals", at(100), 700);
begin(signals, ["Read"]);

signals.sdk({
  type: "auth_status",
  isAuthenticating: true,
  output: ["Refreshing credentials…"],
});

signals.sdk({
  type: "auth_status",
  isAuthenticating: false,
  output: [],
});

signals.sdk({
  type: "system",
  subtype: "informational",
  content: "Plan mode is active; edits are disabled.",
  level: "notice",
});

signals.sdk({
  type: "system",
  subtype: "commands_changed",
  commands: [
    { name: "review", description: "Review changes", argumentHint: "" },
  ],
});

signals.sdk({
  type: "system",
  subtype: "control_request_progress",
  request_id: "preview-request",
  status: "api_retry",
  attempt: 1,
  max_retries: 3,
  retry_delay_ms: 1500,
  error_status: 429,
});

signals.sdk({
  type: "system",
  subtype: "model_refusal_fallback",
  trigger: "refusal",
  direction: "retry",
  original_model: "claude-opus-5-5",
  fallback_model: MODEL,
  request_id: null,
  content: "The request was retried with a different model.",
});

signals.sdk({
  type: "system",
  subtype: "model_refusal_no_fallback",
  original_model: "claude-opus-5-5",
  request_id: null,
  content: "The model declined to continue and no fallback was available.",
});

signals.sdk({
  type: "system",
  subtype: "worker_shutting_down",
  reason: "host_draining",
});

signals.sdk({
  type: "conversation_reset",
  new_conversation_id: "00000000-0000-4000-8000-0000000fffff",
  trigger: "clear",
});

signals.sdk({
  type: "system",
  subtype: "session_state_changed",
  state: "idle",
});

// --- Long run: more events than the activity view keeps (EVENT_TAIL_SIZE) ----
const longReply = `Converted 36 test files to the new runner; one needed a manual fix.

\`suite-17.test.ts\` relied on global state and failed once, so I isolated its setup. \`npm test\` now passes for all 36 files.

The legacy runner can be removed once CI has run twice.`;

const long = new Timeline("preview-long", at(110), 900);
begin(long, ["Read", "Edit", "Bash"]);

for (let i = 0; i < 36; i++) {
  const file = `tests/suite-${i}.test.ts`;
  if (i % 12 === 0) rateLimit(long);
  if (i === 18)
    long.sdk({
      type: "system",
      subtype: "compact_boundary",
      compact_metadata: {
        trigger: "auto",
        pre_tokens: 88000,
        post_tokens: 9000,
      },
    });
  long.ticks(40 + i, 120 + i);
  long.think(`Next up: ${file}. Check the imports before converting.`);
  long.say(`Converting ${file} to the new runner.`);

  long.tool(
    "Read",
    { file_path: file },
    `1\timport { test } from "legacy-runner";\n2\ttest("suite ${i}", () => {});`,
    { progress: [1] },
  );

  if (i % 3 === 0)
    long.tool(
      "Edit",
      {
        file_path: file,
        old_string: 'from "legacy-runner"',
        new_string: 'from "new-runner"',
      },
      `The file ${file} has been updated.`,
      { progress: [1] },
    );
  if (i % 5 === 0 || i === 17)
    long.tool(
      "Bash",
      { command: `npm test -- ${file}` },
      i === 17
        ? `FAIL ${file}\n  shared state leaked from another test`
        : `PASS ${file}`,
      { progress: [2, 4], error: i === 17 },
    );
}

long.finish(longReply);

const lifecycle = (id: string, start: number, ...rest: [string, Data?][]) => {
  const t = new Timeline(
    id,
    at(start),
    parseInt(id.replace(/\D/g, "") || "0") + 800,
  );

  for (const [type, data] of rest) t.add(type, data);

  return t;
};

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
      start_tree: `${FAKE_TREE}1s`,
      end_tree: `${FAKE_TREE}1e`,
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
      start_tree: `${FAKE_TREE}1s`,
      end_tree: `${FAKE_TREE}1e`,
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
      start_tree: `${FAKE_TREE}1s`,
      end_tree: `${FAKE_TREE}1e`,
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
      start_tree: `${FAKE_TREE}2s`,
      end_tree: `${FAKE_TREE}2e`,
    },
  ],
  [
    "task.turn_ended",
    { turn: 2, outcome: "completed", runtime_ms: 88000, cost_usd: 0.47 },
  ],
  ["task.completed", { reply: resumedReplies[1] }],
);

// --- Steering a running turn: one steer taken, one pending, two queued -------
const steeringMessages = {
  taken: {
    id: "msg_preview_steering_taken",
    message: "Keep the existing headings.",
    from: "user" as const,
  },
  pending: {
    id: "msg_preview_steering_pending",
    message: "Use sentence case in the buttons too.",
    from: "user" as const,
  },
  queued: [
    {
      id: "msg_preview_steering_queued_1",
      message: "Then shorten the empty-state text.",
      from: "user" as const,
      delivery: "queue" as const,
    },
    {
      id: "msg_preview_steering_queued_2",
      message: "Afterwards, list any strings you couldn't change.",
      from: "parent" as const,
      delivery: "queue" as const,
    },
  ],
  removed: "msg_preview_steering_removed",
};

const queueEntry = (m: { id: string; message: string; from: string }) => ({
  message_id: m.id,
  message: m.message,
  from: m.from,
});

const steering = new Timeline("preview-steering", at(115), 1700);
begin(steering, ["Read", "Edit"]);
steering.say("Reviewing the settings copy for consistent wording.");

steering.add(
  "task.instruction",
  { ...queueEntry(steeringMessages.taken), delivery: "steer" },
  2000,
);

steering.tool(
  "Read",
  { file_path: "ui/settings/copy.ts" },
  "1\texport const title = 'Settings';",
);

steering.add(
  "task.steer_taken",
  { message_id: steeringMessages.taken.id },
  100,
);

steering.say("Keeping the headings as they are; tightening the descriptions.");

steering.add(
  "task.queue_changed",
  {
    queue: [
      queueEntry(steeringMessages.queued[0]!),
      {
        message_id: steeringMessages.removed,
        message: "Check the dark theme too.",
        from: "user",
      },
    ],
    paused: false,
  },
  3000,
);

steering.add(
  "task.message_removed",
  { message_id: steeringMessages.removed },
  4000,
);

steering.add(
  "task.queue_changed",
  { queue: [queueEntry(steeringMessages.queued[0]!)], paused: false },
  0,
);

steering.add(
  "task.queue_changed",
  { queue: steeringMessages.queued.map(queueEntry), paused: false },
  5000,
);

steering.add(
  "task.instruction",
  { ...queueEntry(steeringMessages.pending), delivery: "steer" },
  2000,
);

steering.toolStart("Edit", {
  file_path: "ui/settings/copy.ts",
  old_string: "Save Changes",
  new_string: "Save changes",
});

// --- Interrupted with a steer pending: it waits at the front of a paused queue
const pausedMessages = {
  steer: {
    id: "msg_preview_paused_steer",
    message: "Rename the flags in the tests as well.",
    from: "user" as const,
  },
  queued: {
    id: "msg_preview_paused_queued",
    message: "Then remove the flags that are always on.",
    from: "parent" as const,
  },
};

const paused = new Timeline("preview-paused", at(118), 1800);
begin(paused, ["Read", "Edit", "Grep"]);
paused.say("Renaming the feature flags to the new prefix.");

paused.add(
  "task.queue_changed",
  { queue: [queueEntry(pausedMessages.queued)], paused: false },
  4000,
);

paused.add(
  "task.instruction",
  { ...queueEntry(pausedMessages.steer), delivery: "steer" },
  3000,
);

paused.add("task.control_requested", { status: "interrupted" }, 2000);
paused.turnEnded(1, "interrupted", 41000, 0.22);

paused.add(
  "task.queue_changed",
  {
    queue: [
      queueEntry(pausedMessages.steer),
      queueEntry(pausedMessages.queued),
    ],
    paused: true,
  },
  0,
);

paused.add("task.interrupted", {}, 0);

// --- Conversations ------------------------------------------------------------
/** A message sent to a fixture task, then the turn it starts. */
const followUp = (
  t: Timeline,
  turn: number,
  message: { id: string; message: string; from: "user" | "parent" },
  delivery: "steer" | "queue" = "steer",
) =>
  t
    .add(
      "task.instruction",
      {
        message_id: message.id,
        message: message.message,
        from: message.from,
        delivery,
      },
      60000,
    )
    .add("task.queued", {}, 100)
    .add("task.started", { turn }, 300);

// A multi-turn conversation: the parent starts it, the user and the parent follow up.
const conversationMessages = [
  {
    id: "msg_preview_conversation_1",
    message: "Also reject files whose extension doesn't match their type.",
    from: "user" as const,
  },
  {
    id: "msg_preview_conversation_2",
    message:
      "Thanks. Before I review: does anything else call `saveUpload` directly?",
    from: "parent" as const,
  },
];

const conversationReplies = [
  `Added a size limit to the upload endpoint: requests over **10 MB** now get \`413 Payload Too Large\` before the body is read.

- \`server/upload.ts\`: checks \`content-length\` first, then counts bytes as they stream.
- \`server/upload.test.ts\`: covers both paths.

\`npm test -- upload\` passes. Left to do: the limit is a constant; it could come from settings.`,
  `Uploads are now checked against their type, too: a file whose extension doesn't match its detected type is rejected with \`415\`.

| Extension | Detected | Result |
| --- | --- | --- |
| \`.png\` | PNG | accepted |
| \`.png\` | PDF | rejected |

The tests cover both cases.`,
  "Only the endpoint calls `saveUpload`; the import job uses its own writer, so it isn't affected.",
];

const conversationTask = new Timeline("preview-conversation", at(120), 1900);
begin(conversationTask, ["Read", "Edit", "Bash"]);
conversationTask.say("Reading the upload handler.");

conversationTask.tool(
  "Read",
  { file_path: "server/upload.ts" },
  "1\texport async function upload(req) {",
);

conversationTask.say(conversationReplies[0]!);

conversationTask.finish(conversationReplies[0]!, 1, {
  duration_ms: 142000,
  total_cost_usd: 0.61,
});

followUp(conversationTask, 2, conversationMessages[0]!);

conversationTask.tool(
  "Edit",
  {
    file_path: "server/upload.ts",
    old_string: "await saveUpload(file)",
    new_string: "await checkType(file);\n  await saveUpload(file)",
  },
  "The file server/upload.ts has been updated.",
);

conversationTask.say(conversationReplies[1]!);

conversationTask.finish(conversationReplies[1]!, 2, {
  duration_ms: 98000,
  total_cost_usd: 0.38,
});

followUp(conversationTask, 3, conversationMessages[1]!);

conversationTask.tool(
  "Grep",
  { pattern: "saveUpload", path: "." },
  "server/upload.ts:14:  await saveUpload(file)",
);

conversationTask.say(conversationReplies[2]!);

conversationTask.finish(conversationReplies[2]!, 3, {
  duration_ms: 31000,
  total_cost_usd: 0.09,
});

// A turn stopped by its cost budget, so the composer offers to raise it.
const budgetTask = new Timeline("preview-budget", at(125), 2000);
begin(budgetTask, ["Read", "Edit"]);
budgetTask.say("Moving the date helpers to the new module.");

budgetTask.tool(
  "Read",
  { file_path: "src/dates.ts" },
  "1\texport function formatDate(d: Date) {",
);

budgetTask.result({
  type: "result",
  subtype: "error_max_budget_usd",
  duration_ms: 302000,
  duration_api_ms: 251000,
  is_error: true,
  num_turns: 14,
  stop_reason: null,
  total_cost_usd: 2.04,
  usage: resultUsage(22000, 5100),
  modelUsage: {},
  permission_denials: [],
  errors: ["Reached the maximum budget for this task."],
  uuid: "00000000-0000-4000-8000-000000300001",
  session_id: SESSION,
});

budgetTask.turnEnded(1, "failed", 302000, 2.04);

budgetTask.add(
  "task.failed",
  { error: "Claude result: error_max_budget_usd" },
  200,
);

// A long conversation, for scrolling Chat.
const longChat = new Timeline("preview-long-chat", at(130), 2100);
begin(longChat, ["Read", "Edit"]);
const longChatTurns = 14;

const longChatMessages = Array.from(
  { length: longChatTurns - 1 },
  (_, index) => {
    const turn = index + 2;

    return {
      id: `msg_preview_long_chat_${turn}`,
      message:
        turn % 3 === 0
          ? `Now the ${turn}th screen, please, and keep the spacing tokens.`
          : `Next: screen ${turn}. Same approach as before.`,
      from: turn % 4 === 0 ? ("parent" as const) : ("user" as const),
    };
  },
);

for (let turn = 1; turn <= longChatTurns; turn++) {
  if (turn > 1) followUp(longChat, turn, longChatMessages[turn - 2]!);

  const reply = `Updated screen ${turn} to the new layout.\n\n- Replaced the fixed widths with the grid.\n- Kept the spacing tokens.${turn === longChatTurns ? "\n\nThat's every screen." : ""}`;

  longChat.say(reply);
  longChat.finish(reply, turn, { duration_ms: 40000, total_cost_usd: 0.12 });
}

const permission = lifecycle(
  "preview-input",
  25,
  ["task.queued"],
  ["task.started", { turn: 1 }],
  [
    "agent.input_required",
    {
      request: {
        id: "preview-request",
        tool: "Bash",
        kind: "permission",
        input: {
          command: "npm run typecheck",
          description:
            "Check the session-state change in the isolated worktree.",
        },
      },
    },
  ],
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

// --- Running tasks, one per "latest activity" the inspector can show ----------
// Each ends on a different event, so the live status line, the row that is still
// going and the clocks can all be seen. Timestamps are relative to load, so the
// run looks like it began under a minute ago and its clocks read a few seconds.
const liveStart = Date.now() - 40000;
const liveClock = () => new Date(liveStart).toISOString();

const liveTimeline = (name: string, firstId: number) => {
  const timeline = new Timeline(`preview-live-${name}`, liveClock(), firstId);
  begin(timeline, ["Read", "Edit", "Bash"]);

  return timeline.say("Starting on the change.");
};

const liveStates: {
  name: string;
  title: string;
  /** What the inspector's status line says while this is the latest activity. */
  status: string;
  timeline: Timeline;
}[] = [
  {
    name: "thinking",
    title: "Live: thinking",
    status: "Thinking…",
    timeline: liveTimeline("thinking", 1000).ticks(60, 180),
  },
  {
    name: "tool",
    title: "Live: running a tool",
    status: "Running Bash · npm test -- --runInBand",
    timeline: (() => {
      const timeline = liveTimeline("tool", 1100);

      const id = timeline.toolStart("Bash", {
        command: "npm test -- --runInBand",
        description: "Run the test suite",
      });

      return timeline.toolProgress(id, "Bash", 4);
    })(),
  },
  {
    name: "compacting",
    title: "Live: compacting context",
    status: "Compacting context",
    timeline: liveTimeline("compacting", 1200).sdk({
      type: "system",
      subtype: "status",
      status: "compacting",
    }),
  },
  {
    name: "retry",
    title: "Live: retrying a request",
    status: "Retrying request · attempt 2",
    timeline: liveTimeline("retry", 1300).sdk({
      type: "system",
      subtype: "api_retry",
      attempt: 2,
      max_retries: 3,
      retry_delay_ms: 4000,
      error_status: 529,
      error: "overloaded",
    }),
  },
  {
    name: "rate-limited",
    title: "Live: waiting for a rate limit",
    status: "Waiting for rate limit reset",
    timeline: rateLimit(liveTimeline("rate-limited", 1400), "rejected"),
  },
  {
    name: "working",
    title: "Live: working",
    status: "Working",
    timeline: liveTimeline("working", 1500).add(
      "task.started",
      { turn: 1 },
      800,
    ),
  },
  {
    name: "finishing",
    title: "Live: finishing up",
    status: "Finishing up",
    timeline: liveTimeline("finishing", 1600).turnResult("Change complete."),
  },
  {
    name: "hook",
    title: "Live: running a hook",
    status: "Hook · Run lint",
    timeline: liveTimeline("hook", 1700).sdk({
      type: "system",
      subtype: "hook_started",
      hook_id: "preview-live-hook",
      hook_name: "Run lint",
      hook_event: "PostToolUse",
    }),
  },
  {
    name: "background",
    title: "Live: background task",
    status: "Background task",
    timeline: liveTimeline("background", 1800).sdk({
      type: "system",
      subtype: "task_started",
      task_id: "preview-live-bg",
      description: "Watch the build",
    }),
  },
  {
    name: "failure",
    title: "Live: provider failure",
    status: "Context compaction failed",
    timeline: liveTimeline("failure", 1900).sdk({
      type: "system",
      subtype: "status",
      status: null,
      compact_result: "failed",
      compact_error: "The summary exceeded the context window.",
    }),
  },
];

const liveTimelines = liveStates.map((live) => live.timeline);

/** Expected inspector status line for each live task, keyed by task id. */
export const previewLiveStatus = Object.fromEntries(
  liveStates.map((live) => [live.timeline.taskId, live.status]),
);

const liveTasks: Task[] = liveStates.map((live, index) => ({
  ...taskBase,
  id: live.timeline.taskId,
  title: live.title,
  description: `Shows the inspector while "${live.status}" is the latest activity.`,
  worker_profile: "implementer",
  provider_options: {
    claude: {
      permission_mode: "inherit",
      permission_source: "user_config",
      approval_decider: "user",
    },
  },
  status: "running",
  workspace_strategy: "current_repo",
  budget: { max_runtime_minutes: null, max_cost_usd: null },
  run_started_at: liveClock(),
  ...timestamps(120 + index, 1),
}));

export const previewTasks: Task[] = [
  {
    ...taskBase,
    id: "preview-audit",
    title: "Audit dependency licences",
    description:
      "Check every direct dependency's licence and flag anything incompatible with a permissive release.",
    status: "completed",
    model: "sonnet",
    runtime_ms: 64000,
    cost_usd: 0.42,
    ...timestamps(0, 2),
  },
  {
    ...taskBase,
    id: "preview-failed",
    title: "Fix the flaky retry test",
    description:
      "Find why retry.test.ts fails intermittently and propose a fix.",
    worker_profile: "debugger",
    provider_options: {
      claude: {
        permission_mode: "inherit",
        permission_source: "user_config",
        approval_decider: "user",
      },
    },
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
    id: "preview-question",
    title: "Migrate the config loader",
    description:
      "Move the config loader to a typed schema and keep backwards compatibility.",
    worker_profile: "implementer",
    provider_options: {
      claude: {
        permission_mode: "inherit",
        permission_source: "user_config",
        approval_decider: "user",
      },
    },
    status: "waiting",
    waiting_reason: "waiting_for_user",
    runtime_ms: 120000,
    run_started_at: at(45),
    pending_input: {
      id: "preview-question-request",
      tool: "AskUserQuestion",
      kind: "question",
      input: questionInput,
    },
    ...timestamps(45, 1),
  },
  {
    ...taskBase,
    id: "preview-stacked-questions",
    title: "Plan the sign-in rollout",
    description:
      "Draft the rollout plan for the new sign-in service, including session migration.",
    worker_profile: "researcher",
    status: "waiting",
    waiting_reason: "waiting_for_user",
    runtime_ms: 90000,
    run_started_at: at(50),
    pending_input: {
      id: "preview-stacked-questions-request",
      tool: "AskUserQuestion",
      kind: "question",
      input: stackedQuestionInput,
    },
    ...timestamps(50, 1),
  },
  {
    ...taskBase,
    id: "preview-refactor",
    title: "Refactor the billing module",
    description:
      "Split billing into invoices and payments without changing public behaviour.\n\nKeep the exported API stable: existing callers import from billing/index.\nMove invoice rendering, tax calculation and PDF export into billing/invoices, and charge, refund and webhook handling into billing/payments.\n\nDo not touch the database schema. Add tests for any code that moves, and run the full billing suite before finishing.",
    worker_profile: "implementer",
    provider_options: {
      claude: {
        permission_mode: "inherit",
        permission_source: "user_config",
        approval_decider: "user",
      },
    },
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
    id: "preview-blocks",
    title: "Catalogue the design assets",
    description:
      "List the assets in assets/ and compare them with the style guide.",
    repository: WEBSITE,
    status: "completed",
    turn: 2,
    instructions: [
      {
        id: "msg_preview_blocks_1",
        message: "Also check the vendored icons.",
        from: "user" as const,
      },
    ],
    instructions_sent: 1,
    model: "opus",
    reasoning_effort: "high",
    runtime_ms: 128000,
    cost_usd: 0.91,
    ...timestamps(90, 3),
  },
  {
    ...taskBase,
    id: "preview-input",
    title: "Investigate session expiry regression",
    description:
      "Trace the session expiry regression and identify the first incorrect state transition.",
    worker_profile: "debugger",
    provider_options: {
      claude: {
        permission_mode: "inherit",
        permission_source: "user_config",
        approval_decider: "user",
      },
    },
    status: "waiting",
    waiting_reason: "waiting_for_permission",
    pending_input: {
      id: "preview-request",
      tool: "Bash",
      kind: "permission",
      input: {
        command: "npm run typecheck",
        description: "Check the session-state change in the isolated worktree.",
      },
    },
    ...timestamps(25, 1),
  },
  {
    ...taskBase,
    id: "preview-interrupted",
    title: "Tighten the task inspector layout",
    description:
      "Improve the task inspector layout while preserving keyboard navigation and narrow-panel behavior.",
    worker_profile: "implementer",
    provider_options: {
      claude: {
        permission_mode: "inherit",
        permission_source: "user_config",
        approval_decider: "user",
      },
    },
    status: "interrupted",
    turn: 2,
    instructions: [
      {
        id: "msg_preview_interrupted_1",
        message: "Keep keyboard navigation unchanged.",
        from: "parent" as const,
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
    id: "preview-signals",
    title: "Monitor session health",
    description: "Watch the worker session and report unusual conditions.",
    worker_profile: "reviewer",
    status: "interrupted",
    ...timestamps(100, 1),
  },
  {
    ...taskBase,
    id: "preview-long",
    title: "Convert the test suite to the new runner",
    description:
      "Convert every test file to the new runner API and run each one after editing it.",
    worker_profile: "implementer",
    provider_options: {
      claude: {
        permission_mode: "inherit",
        permission_source: "user_config",
        approval_decider: "user",
      },
    },
    status: "completed",
    runtime_ms: 540000,
    cost_usd: 2.37,
    ...timestamps(110, 9),
  },
  {
    ...taskBase,
    id: "preview-build",
    title: "Speed up the production build",
    description: "Cache module compilation across the build's source files.",
    worker_profile: "implementer",
    provider_options: {
      claude: {
        permission_mode: "inherit",
        permission_source: "user_config",
        approval_decider: "user",
      },
    },
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
    provider_options: {
      claude: {
        permission_mode: "inherit",
        permission_source: "user_config",
        approval_decider: "user",
      },
    },
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
        from: "user" as const,
      },
    ],
    instructions_sent: 1,
    runtime_ms: 186000,
    cost_usd: 0.88,
    ...worktree("preview-resumed"),
    ...timestamps(112, 40),
  },
  {
    ...taskBase,
    id: "preview-steering",
    title: "Tidy the settings copy",
    description:
      "Make the settings screen's wording consistent: sentence case, short descriptions.",
    worker_profile: "implementer",
    repository: WEBSITE,
    status: "running",
    runtime_ms: 0,
    instructions: [steeringMessages.taken],
    instructions_sent: 1,
    pending_steers: [steeringMessages.pending],
    queue: steeringMessages.queued,
    run_started_at: new Date(Date.now() - 95000).toISOString(),
    ...timestamps(115, 2),
  },
  {
    ...taskBase,
    id: "preview-paused",
    title: "Rename the feature flags",
    description: "Rename every feature flag to the new ff_ prefix.",
    worker_profile: "implementer",
    status: "interrupted",
    runtime_ms: 41000,
    cost_usd: 0.22,
    queue: [
      { ...pausedMessages.steer, delivery: "steer", recorded: true },
      { ...pausedMessages.queued, delivery: "queue" },
    ],
    queue_paused: true,
    ...timestamps(118, 1),
  },
  {
    ...taskBase,
    id: "preview-conversation",
    title: "Limit upload sizes",
    description:
      "Add a size limit to the upload endpoint and reject oversized requests early.",
    worker_profile: "implementer",
    created_by: "parent",
    repository: WEBSITE,
    status: "completed",
    turn: 3,
    instructions: conversationMessages,
    instructions_sent: 2,
    runtime_ms: 271000,
    cost_usd: 1.08,
    ...timestamps(120, 6),
  },
  {
    ...taskBase,
    id: "preview-budget",
    title: "Move the date helpers",
    description:
      "Move the date helpers into their own module and update imports.",
    worker_profile: "implementer",
    status: "failed",
    error: "Claude result: error_max_budget_usd",
    budget: { max_runtime_minutes: 20, max_cost_usd: 2 },
    runtime_ms: 302000,
    cost_usd: 2.04,
    ...timestamps(125, 5),
  },
  {
    ...taskBase,
    id: "preview-long-chat",
    title: "Move the screens to the new layout",
    description:
      "Move each settings screen to the new grid layout, one at a time.",
    worker_profile: "implementer",
    status: "completed",
    turn: longChatTurns,
    instructions: longChatMessages,
    instructions_sent: longChatTurns - 1,
    runtime_ms: longChatTurns * 40000,
    cost_usd: longChatTurns * 0.12,
    ...timestamps(130, 30),
  },
  ...liveTasks,
];

export const previewEvents: Event[] = [
  audit,
  failed,
  question,
  stacked,
  refactor,
  release,
  blocks,
  signals,
  long,
  interrupted,
  permission,
  dependent,
  build,
  profile,
  resumed,
  steering,
  paused,
  conversationTask,
  budgetTask,
  longChat,
  ...liveTimelines,
].flatMap((timeline) => timeline.events);
