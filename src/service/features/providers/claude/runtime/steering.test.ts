import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Options, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { test } from "vitest";

import { readyClaudeCli } from "../../../../../../tests/support/claude-cli.js";
import {
  claudeOverrideDefaults,
  resolveClaudePolicy,
} from "../../../../../shared/providers/claude/permissions.js";
import { startSchema, type Task } from "../../../../../shared/tasks/model.js";
import { now } from "../../../../../shared/time.js";
import { type RunContext, type Steer } from "../../types.js";
import { ClaudeAgentProvider } from "./provider.js";

type Frame = Record<string, unknown>;

const result = (text: string, subtype = "success") => ({
  type: "result",
  subtype,
  is_error: subtype !== "success",
  result: text,
  ...(subtype === "success" ? {} : { errors: ["aborted"] }),
  total_cost_usd: 0.1,
  usage: {},
});

const endTurn = {
  type: "stream_event",
  parent_tool_use_id: null,
  event: { type: "message_delta", delta: { stop_reason: "end_turn" } },
};

const lifecycle = (command_uuid: string, state: string) => ({
  type: "command_lifecycle",
  command_uuid,
  state,
});

async function context() {
  const workspace = await mkdtemp(join(tmpdir(), "claude-steering-"));
  execFileSync("git", ["init", "-q", workspace]);
  const abort = new AbortController();
  const events: { type: string }[] = [];
  const taken: string[] = [];
  const deltas: [string, string][] = [];
  let sink: ((steer: Steer) => boolean) | undefined;

  const task: Task = {
    ...startSchema.parse({ description: "Review" }),
    repository: workspace,
    workspace,
    id: "task-steering",
    title: "Review",
    owner: "alice",
    created_by: "user",
    status: "running",
    created_at: now(),
    updated_at: now(),
    instructions: [],
    instructions_sent: 0,
    pending_steers: [],
    queue: [],
    turn: 1,
    runtime_ms: 0,
    provider_options: {
      claude: {
        permission_mode: "plan",
        approval_decider: "user",
        permission_source: "task_profile",
        claude_policy: resolveClaudePolicy(claudeOverrideDefaults, "reviewer"),
      },
    },
  };

  const c: RunContext = {
    task,
    signal: abort.signal,
    emit: (type) => events.push({ type }),
    session: () => {},
    input: async () => ({ approved: false }),
    acceptSteers: (s) => (sink = s),
    steerTaken: (id) => taken.push(id),
    delta: (id, text) => deltas.push([id, text]),
  };

  return {
    c,
    abort,
    events,
    taken,
    deltas,
    steer: (steer: Steer) => sink!(steer),
  };
}

/**
 * A query that reads the streamed prompt and plays `script`, which yields
 * CLI frames and can wait for the next prompt message.
 */
function fakeQuery(
  script: (next: () => Promise<SDKUserMessage>) => AsyncGenerator<Frame>,
  controls: Partial<Record<"interrupt" | "cancelAsyncMessage", unknown>> = {},
) {
  let options: Options | undefined;

  const launch = ((args: {
    prompt: AsyncIterable<SDKUserMessage>;
    options: Options;
  }) => {
    options = args.options;
    const reader = args.prompt[Symbol.asyncIterator]();

    const next = async () =>
      (await reader.next()).value as unknown as SDKUserMessage;

    return Object.assign(script(next), { close() {}, ...controls });
  }) as unknown as ConstructorParameters<typeof ClaudeAgentProvider>[0];

  return { launch, options: () => options! };
}

test("a steer goes into the running turn as a priority next message, and is taken when the CLI starts it", async () => {
  const ctx = await context();
  let steerMessage: SDKUserMessage | undefined;

  const query = fakeQuery(async function* (next) {
    assert.equal((await next()).message.content, "Prompt");

    yield {
      type: "assistant",
      parent_tool_use_id: null,
      message: { content: [{ type: "tool_use", id: "t", name: "Read" }] },
    };

    assert.equal(ctx.steer({ id: "msg_1", text: "Also this" }), true);
    steerMessage = await next();
    yield lifecycle(steerMessage.uuid!, "queued");
    yield lifecycle(steerMessage.uuid!, "started");
    yield endTurn;
    yield result("Done");
  });

  const reply = await new ClaudeAgentProvider(
    query.launch,
    undefined,
    readyClaudeCli,
  ).run(ctx.c, "Prompt");

  assert.deepEqual(reply, { reply: "Done" });
  assert.equal(steerMessage?.priority, "next");
  assert.equal(steerMessage?.message.content, "Also this");
  assert.deepEqual(ctx.taken, ["msg_1"]);
  assert.equal(query.options().includePartialMessages, true);
  // Stream frames and lifecycle frames aren't stored as events.
  assert.ok(!ctx.events.some((e) => e.type === "claude.activity"));
});

test("a steer the turn won't take is withdrawn as the final message ends, and no more are accepted", async () => {
  const ctx = await context();
  const cancelled: string[] = [];
  let uuid = "";

  const query = fakeQuery(
    async function* (next) {
      await next();
      ctx.steer({ id: "msg_late", text: "Late" });
      uuid = (await next()).uuid!;
      yield lifecycle(uuid, "queued");
      yield endTurn;
      assert.equal(ctx.steer({ id: "msg_later", text: "Later" }), false);
      yield result("Done");
    },
    {
      cancelAsyncMessage: async (id: string) => {
        cancelled.push(id);

        return true;
      },
    },
  );

  await new ClaudeAgentProvider(query.launch, undefined, readyClaudeCli).run(
    ctx.c,
    "Prompt",
  );

  assert.deepEqual(cancelled, [uuid]);
  assert.deepEqual(ctx.taken, []);
});

test("a steer that can't be withdrawn runs after the result, and the turn ends with its reply", async () => {
  const ctx = await context();

  const query = fakeQuery(
    async function* (next) {
      await next();
      ctx.steer({ id: "msg_late", text: "Late" });
      const { uuid } = await next();
      yield endTurn;
      yield result("First");
      yield lifecycle(uuid!, "started");
      yield endTurn;
      yield result("Second");
    },
    { cancelAsyncMessage: async () => false },
  );

  const reply = await new ClaudeAgentProvider(
    query.launch,
    undefined,
    readyClaudeCli,
  ).run(ctx.c, "Prompt");

  assert.deepEqual(reply, { reply: "Second" });
  assert.deepEqual(ctx.taken, ["msg_late"]);
});

test("an interrupt ends the turn through the query, cancelling queued messages, without stopping the process", async () => {
  const ctx = await context();
  const interrupts: unknown[] = [];
  let release!: () => void;
  const interrupted = new Promise<void>((resolve) => (release = resolve));

  const query = fakeQuery(
    async function* (next) {
      await next();
      ctx.abort.abort();
      await interrupted;
      yield result("", "error_during_execution");
    },
    {
      interrupt: async (options: unknown) => {
        interrupts.push(options);
        release();
      },
    },
  );

  await assert.rejects(
    new ClaudeAgentProvider(query.launch, undefined, readyClaudeCli).run(
      ctx.c,
      "Prompt",
    ),
    /error_during_execution/,
  );

  assert.deepEqual(interrupts, [{ cancelQueued: true }]);
  assert.equal(query.options().abortController!.signal.aborted, false);
});

test("an interrupt that fails stops the process instead", async () => {
  const ctx = await context();

  const query = fakeQuery(
    async function* (next) {
      await next();
      ctx.abort.abort();

      await new Promise<void>((resolve) =>
        query
          .options()
          .abortController!.signal.addEventListener("abort", () => resolve()),
      );

      yield result("", "error_during_execution");
    },
    {
      interrupt: async () => {
        throw new Error("Not supported");
      },
    },
  );

  await assert.rejects(
    new ClaudeAgentProvider(query.launch, undefined, readyClaudeCli).run(
      ctx.c,
      "Prompt",
    ),
    /error_during_execution/,
  );

  assert.equal(query.options().abortController!.signal.aborted, true);
});

test("the main worker's text streams as deltas, and other stream frames are left out", async () => {
  const ctx = await context();

  const frame = (event: Frame, parent: string | null = null) => ({
    type: "stream_event",
    parent_tool_use_id: parent,
    event,
  });

  const query = fakeQuery(async function* (next) {
    await next();
    yield frame({ type: "message_start", message: { id: "msg_1" } });

    yield frame({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "Hel" },
    });

    // A subagent's text and other deltas don't stream.
    yield frame(
      { type: "content_block_delta", delta: { type: "text_delta", text: "x" } },
      "toolu_1",
    );

    yield frame({
      type: "content_block_delta",
      delta: { type: "input_json_delta", partial_json: "{" },
    });

    yield frame({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "lo" },
    });

    yield endTurn;
    yield result("Hello");
  });

  await new ClaudeAgentProvider(query.launch, undefined, readyClaudeCli).run(
    ctx.c,
    "Prompt",
  );

  assert.deepEqual(ctx.deltas, [
    ["msg_1", "Hel"],
    ["msg_1", "lo"],
  ]);

  assert.ok(!ctx.events.some((e) => e.type === "claude.activity"));
});
