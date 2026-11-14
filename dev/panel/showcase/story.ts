// The showcase's curated collaboration: what Codex shows in its thread and
// what the panel shows for Claude at each step. Steps are cumulative.
import type { Draft } from "../../../src/shared/tasks/conversation/drafts";
import type { Task } from "../../../src/shared/tasks/model";
import { settingOptions, taskBase } from "../scenarios/scenario-context";
import { begin, Timeline } from "../scenarios/timeline";

export const STORY_THREAD = "showcase-thread";
export const STORY_REPOSITORY = "/demo/acme-api";
const taskId = "showcase-logging-review";
const startedAt = "2026-10-26T09:00:00.000Z";

type CodexRowIcon = "files" | "mcp" | "extension" | "edit" | "terminal";

export type CodexItem =
  | { kind: "user"; text: string }
  | { kind: "prose"; text: string }
  | { kind: "row"; icon: CodexRowIcon; text: string }
  /** An app Codex opens from a tool result, inline first. */
  | { kind: "app"; name: string }
  | { kind: "list"; items: string[] };

/** The story at one time: a step, and how much of its reply has streamed. */
export type StoryMoment = { step: number; streamed?: number };

export type StoryStep = {
  label: string;
  /** Items Codex adds to its thread in this step. */
  codex: CodexItem[];
  /** Codex's working line while this is the latest step. */
  working?: string;
  /**
   * Claude's events for this step. Omit while the task doesn't exist yet.
   * `state.running` carries a tool call a step leaves running to the next.
   */
  panel?: (t: Timeline, state: { running: string }) => void;
  /** Claude's reply that ends the step's turn, streamed during playback. */
  reply?: { text: string; duration_ms: number; total_cost_usd: number };
  /** The task's status and turn after this step's events. Set with `panel`. */
  status?: Task["status"];
  turn?: number;
};

const brief =
  "Review our logging design before I implement it. Today the service calls `console.log` in 40 places, has no request IDs and doesn't log auth failures. Give prioritized, concrete guidance. Don't edit files.";

const guidance = `Here's what I'd prioritize:

1. **One structured logger.** Emit JSON lines from a shared \`logger\` with \`level\`, \`event\` and \`request_id\`, and replace the \`console.log\` calls.
2. **Redact at the logger.** Strip \`authorization\`, cookies and tokens in one place, never at call sites.
3. **Log auth outcomes by reason.** Record missing, invalid and expired tokens separately, at \`warn\`.

Rotate by size (10 MB, 5 files). Per-query timing can wait.`;

const reviewRequest =
  "The implementation is in the working tree: `src/logging/logger.ts`, request IDs in `app.ts`, redaction and auth reasons. Tests pass. Please review the changes. No edits.";

const review = `Looks good, with one fix before merging:

- **\`middleware.ts:42\` logs the raw header** when parsing fails. Log only the failure reason.

Redaction, request IDs and rotation work as described, and the new tests cover all three auth reasons.`;

export const story: StoryStep[] = [
  {
    label: "Ask Codex",
    codex: [
      {
        kind: "user",
        text: "Let's improve logging across the service. Work closely with Claude for design feedback and a final review.",
      },
      {
        kind: "prose",
        text: "I'll map the current logging, then ask Claude to review the design before I build it.",
      },
      { kind: "row", icon: "files", text: "Read 8 files, ran a command" },
    ],
    working: "Thinking",
  },
  {
    label: "Delegate to Claude",
    codex: [
      {
        kind: "row",
        icon: "mcp",
        text: "MCP start_task on subagent_extension_for_codex",
      },
      { kind: "app", name: "Subagent Extension for Codex" },
      {
        kind: "prose",
        text: "Claude is reviewing the design. I'll keep mapping call sites in the meantime.",
      },
    ],
    working: "Thinking",
    status: "running",
    turn: 1,
    panel: (t, state) => {
      begin(t, ["Read", "Grep"]);
      t.say("Reading the request pipeline and the current log calls.");

      t.tool(
        "Grep",
        { pattern: "console\\.log", path: "src" },
        "src/server/app.ts:18\nsrc/auth/middleware.ts:42",
      );

      t.tool(
        "Read",
        { file_path: "src/server/app.ts" },
        "1\timport express from 'express';",
      );

      state.running = t.toolStart("Read", {
        file_path: "src/auth/middleware.ts",
      });
    },
  },
  {
    label: "Claude advises",
    codex: [
      { kind: "row", icon: "extension", text: "Read Claude's reply" },
      {
        kind: "prose",
        text: "Claude recommends one structured logger with request IDs, redaction in the logger, and auth failures logged by reason. I'm implementing that now.",
      },
      { kind: "row", icon: "edit", text: "Edited 9 files" },
      { kind: "row", icon: "terminal", text: "Ran npm test" },
    ],
    working: "Thinking",
    status: "completed",
    turn: 1,
    panel: (t, state) => {
      t.toolDone(state.running, "1\texport function authenticate(req) {");

      t.ticks(160).think("Rank the gaps by risk.");
    },
    reply: { text: guidance, duration_ms: 48_000, total_cost_usd: 0.31 },
  },
  {
    label: "Codex asks for review",
    codex: [
      {
        kind: "row",
        icon: "extension",
        text: "Sent the changes to Claude for review",
      },
    ],
    working: "Waiting for Claude's review",
    status: "running",
    turn: 2,
    panel: (t, state) => {
      t.add(
        "task.instruction",
        {
          message_id: "msg_showcase_review",
          message: reviewRequest,
          from: "parent",
          delivery: "queue",
        },
        90_000,
      )
        .add("task.queued", {}, 100)
        .add("task.started", { turn: 2 }, 300);

      t.tool(
        "Read",
        { file_path: "src/logging/logger.ts" },
        "1\texport const logger = createLogger();",
      );

      state.running = t.toolStart("Read", {
        file_path: "src/auth/middleware.ts",
      });
    },
  },
  {
    label: "Claude reviews",
    codex: [
      { kind: "row", icon: "extension", text: "Read Claude's review" },
      { kind: "row", icon: "edit", text: "Edited middleware.ts" },
      { kind: "row", icon: "terminal", text: "Ran npm test" },
      {
        kind: "prose",
        text: "Implemented with Claude's design feedback and review.",
      },
      {
        kind: "list",
        items: [
          "Structured JSON logs with request IDs.",
          "Secrets redacted in one place.",
          "Auth failures logged by reason.",
          "Size-based log rotation.",
        ],
      },
    ],
    status: "completed",
    turn: 2,
    panel: (t, state) => {
      t.toolDone(
        state.running,
        "42\t  log.debug('auth header', req.headers.authorization);",
      );
    },
    reply: { text: review, duration_ms: 36_000, total_cost_usd: 0.22 },
  },
];

const storyTask: Task = {
  ...taskBase,
  id: taskId,
  title: "Review the logging design",
  description: brief,
  worker_profile: "reviewer",
  // A read-only profile starts in plan mode.
  provider_options: {
    claude: {
      ...settingOptions().claude,
      permission_mode: "plan",
      permission_source: "profile",
    },
  },
  model: "opus",
  reasoning_effort: "medium",
  created_by: "parent",
  conversation_id: STORY_THREAD,
  repository: STORY_REPOSITORY,
  workspace_strategy: "current_repo",
  status: "running",
  created_at: startedAt,
  updated_at: startedAt,
};

/**
 * Adds a step's reply: the start of its stream, then, unless `streamed` holds
 * the part shown so far, the stored message and the turn's end. Frames share
 * the stream events so a playing panel's event ids only ever grow.
 */
function addReply(
  t: Timeline,
  { turn }: StoryStep,
  { text, ...result }: NonNullable<StoryStep["reply"]>,
  streamed?: string,
) {
  const id = `msg_showcase_${turn}`;

  t.streamed([text.slice(0, 1)], false, id);
  if (streamed !== undefined) return { message_id: id, text: streamed };

  t.stream({ type: "content_block_stop", index: 0 })
    .stream({ type: "message_stop" })
    .say(text, id)
    .finish(text, turn, result);

  return undefined;
}

/**
 * The task, events and clock at a moment, or none before Codex delegates.
 * `streamed`, from 0 to 1, shows the step's reply part way through streaming.
 */
export function storyAt({ step, streamed }: StoryMoment) {
  const steps = story.slice(0, step + 1);
  const last = steps.findLast((s) => s.panel);
  if (!last) return undefined;

  const timeline = new Timeline(taskId, startedAt, 1);
  const state = { running: "" };
  let draft: Draft | undefined;

  for (const s of steps) {
    s.panel?.(timeline, state);
    if (!s.reply) continue;

    const partial =
      s === steps.at(-1) && streamed !== undefined && streamed < 1
        ? s.reply.text.slice(
            0,
            Math.max(1, Math.ceil(s.reply.text.length * streamed)),
          )
        : undefined;

    draft = addReply(timeline, s, s.reply, partial);
  }

  const { events } = timeline;
  const turnStarted = events.findLast((e) => e.type === "task.started");

  const task: Task = {
    ...storyTask,
    status: draft ? "running" : (last.status ?? "running"),
    turn: last.turn ?? 1,
    run_started_at: turnStarted?.timestamp ?? startedAt,
    updated_at: timeline.end,
  };

  // The frame's clock: a few seconds after the latest event.
  const now = Date.parse(timeline.end) + 4000;

  return { task, events, draft, now };
}

/** The panel's clock at a moment, or the real time before Codex delegates. */
export const storyClock = (moment: StoryMoment) =>
  storyAt(moment)?.now ?? Date.now();
