import { test } from "node:test";
import assert from "node:assert/strict";
import type { AgentSessionEvent } from "openai/resources/beta/agents/agents";
import type { AgentSessionStreamParams } from "openai/lib/agents/agent-session-stream";
import { startSchema, type RunContext } from "../src/core/model.js";
import { CodexAgentProvider } from "../src/providers/codex.js";
import { CodexExecutors } from "../src/providers/codex-executors.js";
import type { CodexSessions } from "../src/providers/codex-session.js";

const result = {
  summary: "Reviewed",
  findings: [],
  evidence: ["a.ts"],
  changes: [],
  tests: [],
  recommendations: [],
};
const ref = {
  session_id: "sess_one",
  state_ref: "openai-agent-session:sess_one",
  environment_id: "env_one",
  remote_url: "https://api.openai.com/executor",
};
const created = {
  type: "agent.session.turn.created",
  turn_id: "turn_one",
  turn: { id: "turn_one", subagent_id: null, status: "in_progress" },
} as AgentSessionEvent;
const completed = {
  type: "agent.session.turn.completed",
  turn_id: "turn_one",
  turn: { id: "turn_one", subagent_id: null, status: "completed" },
} as AgentSessionEvent;
function setup(
  events: (
    signal: AbortSignal,
    options: AgentSessionStreamParams,
  ) => AsyncGenerator<AgentSessionEvent> = async function* () {
    yield created;
    yield completed;
  },
) {
  const log: string[] = [];
  let exited!: (value: {
    code: number | null;
    signal: NodeJS.Signals | null;
  }) => void;
  const exit = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) => {
    exited = resolve;
  });
  const pool = new CodexExecutors({
    recover: async () => {
      log.push("local-recovery");
    },
    start: async (task) => {
      assert.equal(task.session_id, ref.session_id);
      assert.ok(log.includes("persist"));
      log.push("start");
      return {
        exited: exit,
        stop: async () => {
          log.push("stop");
          exited({ code: 0, signal: null });
        },
      };
    },
  });
  const sessions = {
    open: async () => {
      log.push("open");
      return ref;
    },
    turn: async (
      _task: unknown,
      _prompt: string,
      options: AgentSessionStreamParams,
      signal: AbortSignal,
    ) => {
      log.push("turn");
      return Object.assign(events(signal, options), {
        abort: () => log.push("abort"),
      });
    },
    structuredResult: async () => {
      log.push("result");
      return result;
    },
    cancelAndWait: async () => {
      log.push("confirm");
      return {};
    },
    cancel: async () => {
      log.push("cancel");
    },
  } as unknown as Pick<
    CodexSessions,
    "open" | "turn" | "structuredResult" | "cancelAndWait" | "cancel"
  >;
  const abort = new AbortController();
  const c: RunContext = {
    task: {
      ...startSchema.parse({
        provider: "codex",
        title: "Review",
        description: "Review",
        budget: { max_cost_usd: null },
      }),
      id: "task_one",
      owner: "alice",
      workspace: "/worktree",
      attempt: 1,
      runtime_ms: 0,
      instructions: [],
      status: "running",
      created_at: "now",
      updated_at: "now",
    },
    signal: abort.signal,
    emit: (type) => log.push(type),
    session: () => log.push("persist"),
    input: async (tool) => {
      log.push(tool);
      return { approved: true };
    },
  };
  return {
    provider: new CodexAgentProvider(sessions, pool),
    pool,
    sessions,
    c,
    log,
    abort,
    exited,
  };
}
test("native Codex provider persists session before execution and stops before returning structured results", async () => {
  const f = setup();
  assert.deepEqual(await f.provider.run(f.c, "Review"), result);
  assert.ok(f.log.indexOf("CodexExecution") < f.log.indexOf("open"));
  assert.ok(f.log.indexOf("persist") < f.log.indexOf("start"));
  assert.ok(f.log.indexOf("start") < f.log.indexOf("turn"));
  assert.equal(f.log.at(-1), "stop");
  assert.equal(f.c.task.native_turn_id, "turn_one");
  await f.pool.close();
});
test("execution approval discloses the full description alongside its concise title", async () => {
  const f = setup();
  f.c.task.title = "Review authentication";
  f.c.task.description =
    "Inspect token expiry and report the exact failing transition.";
  f.c.input = async (tool, input) => {
    assert.equal(tool, "CodexExecution");
    assert.equal(input.title, f.c.task.title);
    assert.equal(input.description, f.c.task.description);
    assert.equal(input.workspace, f.c.task.workspace);
    return { approved: true };
  };
  try {
    assert.deepEqual(await f.provider.run(f.c, f.c.task.description), result);
  } finally {
    await f.pool.close();
  }
});
test("native execution denial and unsupported budgets cannot create sessions or executors", async () => {
  const f = setup();
  f.c.input = async () => ({ approved: false });
  await assert.rejects(f.provider.run(f.c, "Review"), /not approved/);
  assert.deepEqual(f.log, []);
  f.c.task.budget.max_cost_usd = 5;
  await assert.rejects(f.provider.run(f.c, "Review"), /cannot enforce/);
  assert.deepEqual(f.log, []);
  await f.pool.close();
});
test("native question handler forwards the user's answer without launching a separate harness", async () => {
  const f = setup(async function* (_signal, options) {
    yield created;
    const answer = await options.toolHandlers!.AskUserQuestion({
      question: "Which approach?",
    });
    assert.deepEqual(answer, {
      answered: true,
      input: { answer: "Preserve API" },
      message: "",
    });
    yield completed;
  });
  f.c.input = async (tool) => ({
    approved: true,
    ...(tool === "AskUserQuestion"
      ? { input: { answer: "Preserve API" } }
      : {}),
  });
  await f.provider.run(f.c, "Review");
  await f.pool.close();
});
test("interruption confirms remote cancellation before stopping the executor", async () => {
  const f = setup(async function* (signal) {
    yield created;
    f.abort.abort(new Error("interrupt"));
    signal.throwIfAborted();
  });
  await assert.rejects(f.provider.run(f.c, "Review"), /interrupt/);
  assert.ok(f.log.indexOf("confirm") < f.log.indexOf("stop"));
  assert.ok(!f.log.includes("agent.completed"));
  await f.pool.close();
});
test("executor exit aborts a pending question, confirms remote state and cannot report success", async () => {
  const f = setup(async function* (_signal, options) {
    yield created;
    await options.toolHandlers!.AskUserQuestion({ question: "Pending?" });
    yield completed;
  });
  f.c.input = async (tool, _input, signal) => {
    if (tool === "CodexExecution") return { approved: true };
    f.exited({ code: 1, signal: null });
    return await new Promise((_resolve, reject) => {
      if (signal!.aborted) reject(signal!.reason);
      else
        signal!.addEventListener("abort", () => reject(signal!.reason), {
          once: true,
        });
    });
  };
  await assert.rejects(f.provider.run(f.c, "Review"), /executor exited/);
  assert.ok(f.log.includes("confirm"));
  assert.ok(!f.log.includes("agent.completed"));
  await f.pool.close();
});
test("unconfirmed remote termination is reported while local shutdown still runs", async () => {
  const f = setup(async function* () {
    yield created;
    throw new Error("stream disconnected");
  });
  f.sessions.cancelAndWait = async () => {
    throw new Error("timeout");
  };
  await assert.rejects(
    f.provider.run(f.c, "Review"),
    /remote termination unconfirmed/,
  );
  assert.equal(f.log.at(-1), "stop");
  await f.pool.close();
});

test("native recovery checks local shutdown before confirming the saved coordinator turn", async () => {
  const f = setup();
  f.c.task.session_id = ref.session_id;
  f.c.task.native_turn_id = "turn_one";
  await f.provider.recover(f.c.task);
  assert.deepEqual(f.log, ["local-recovery", "confirm"]);
  delete f.c.task.native_turn_id;
  await assert.rejects(f.provider.recover(f.c.task), /no observed coordinator/);
  assert.equal(f.log.filter((value) => value === "confirm").length, 1);
  await f.pool.close();
});
