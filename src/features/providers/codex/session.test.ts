import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import OpenAI from "openai";
import { test } from "vitest";

import { startSchema, type Task } from "../../../shared/contracts.js";
import { CodexSessions } from "./session.js";

const task: Task = {
  ...startSchema.parse({
    title: "Review changes",
    description: "Review changes",
  }),
  id: "task-one",
  title: "Review changes",
  owner: "alice",
  workspace: "/worktrees/task-one",
  status: "running",
  attempt: 2,
  runtime_ms: 0,
  instructions: [],
  created_at: "now",
  updated_at: "now",
};

test("native session deletion skips tasks without a session and sends DELETE for an existing one", async () => {
  const calls: { path: string; method: string }[] = [];
  const abort = new AbortController();

  const runtime = new CodexSessions(
    new OpenAI({
      apiKey: "test-placeholder",
      maxRetries: 0,
      fetch: async (url, init) => {
        calls.push({
          path: new URL(String(url)).pathname,
          method: init?.method ?? "GET",
        });

        return new Response(null, { status: 204 });
      },
    }),
    "configured-model",
  );

  await runtime.delete(task, abort.signal);
  assert.deepEqual(calls, []);
  await runtime.delete({ ...task, session_id: "sess-one" }, abort.signal);

  assert.deepEqual(calls, [
    { path: "/v1/agents/sessions/sess-one", method: "DELETE" },
  ]);
});

test("native session deletion tolerates missing sessions and propagates other API failures", async () => {
  for (const status of [404, 403, 500]) {
    const runtime = new CodexSessions(
      new OpenAI({
        apiKey: "test-placeholder",
        maxRetries: 0,
        fetch: async () =>
          new Response(
            JSON.stringify({ error: { message: "delete failed" } }),
            {
              status,
              headers: { "Content-Type": "application/json" },
            },
          ),
      }),
      "configured-model",
    );

    const deletion = runtime.delete({ ...task, session_id: "sess-one" });
    if (status === 404) await deletion;
    else
      await assert.rejects(
        deletion,
        (error: unknown) =>
          error instanceof OpenAI.APIError && error.status === status,
      );
  }
});

const session = () => ({
  id: "sess-one",
  status: "idle",
  metadata: {
    task_id: task.id,
    owner_ref: createHash("sha256").update(task.owner).digest("hex"),
  },
  environment: {
    type: "self_hosted",
    id: "env-one",
    remote_url: "https://api.openai.com/executor",
    workspace_directory: task.workspace,
  },
  usage: null,
  error: null,
});

function setup(
  onRequest: (path: string, method: string, state: any) => void = () => {},
) {
  const calls: {
    path: string;
    method: string;
    body: any;
    key: string | null;
  }[] = [];

  let state = session();

  const client = new OpenAI({
    apiKey: "test-placeholder",
    maxRetries: 0,
    fetch: async (url, init) => {
      const path = new URL(String(url)).pathname;
      const method = init?.method ?? "GET";

      calls.push({
        path,
        method,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        key: new Headers(init?.headers).get("Idempotency-Key"),
      });

      onRequest(path, method, state);
      if (path.endsWith("/items"))
        return new Response(
          JSON.stringify({
            object: "list",
            data: (state as any).items ?? [],
            has_more: false,
            last_id: null,
          }),
          {
            headers: { "Content-Type": "application/json" },
          },
        );
      if (path.includes("/turns/"))
        return new Response(JSON.stringify((state as any).turn), {
          headers: { "Content-Type": "application/json" },
        });
      if (path.endsWith("/events") && method === "POST")
        return new Response(null, { status: 202 });

      if (path.endsWith("/events")) {
        const events = [
          {
            type: "agent.session.turn.created",
            event_id: "e1",
            session_id: "sess-one",
            turn_id: "turn-one",
            turn: {
              id: "turn-one",
              agent_id: "root",
              subagent_id: null,
              status: "in_progress",
            },
          },
          {
            type: "agent.session.turn.completed",
            event_id: "e2",
            session_id: "sess-one",
            turn_id: "turn-one",
            turn: {
              id: "turn-one",
              agent_id: "root",
              subagent_id: null,
              status: "completed",
            },
          },
          { type: "agent.session.idle", event_id: "e3", session: state },
        ];

        return new Response(
          events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""),
          { headers: { "Content-Type": "text/event-stream" } },
        );
      }

      return new Response(JSON.stringify(state), {
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  return {
    runtime: new CodexSessions(client, "configured-model"),
    calls,
    state,
    replace: (next: any) => {
      state = next;
    },
  };
}

test("Codex session creation uses native Agents API with isolated worktree and correlation headers", async () => {
  const { runtime, calls } = setup();
  const ref = await runtime.open(task);
  assert.equal(ref.state_ref, "openai-agent-session:sess-one");
  const request = calls[0];
  assert.equal(request.path, "/v1/agents/sessions");
  assert.equal(request.method, "POST");
  assert.equal(request.key, "codex-subagent-extension-session-task-one");
  assert.equal(request.body.agent.model, "configured-model");
  assert.equal(request.body.agent.text.format.type, "json_schema");
  assert.deepEqual(request.body.agent.multi_agent, { enabled: false });

  assert.deepEqual(request.body.environment, {
    type: "self_hosted",
    workspace_directory: task.workspace,
    capability_directories: [],
  });

  assert.equal(request.body.input, undefined);
  assert.equal(request.body.agent.tools[0].name, "AskUserQuestion");
  assert.ok(!JSON.stringify(request.body).includes("test-placeholder"));
});

test("session continuation verifies owner and workspace and never creates a replacement session", async () => {
  const { runtime, calls, state } = setup();
  const continued = { ...task, session_id: "sess-one" };
  await runtime.open(continued);
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].path, "/v1/agents/sessions/sess-one");

  await assert.rejects(
    runtime.open({ ...continued, owner: "bob" }),
    /does not belong/,
  );

  state.environment.workspace_directory = "/primary-checkout";
  await assert.rejects(runtime.open(continued), /does not match/);
  assert.ok(calls.every((r) => r.method === "GET"));
});

test("Codex forwards task model and reasoning while inheriting the runtime model by default", async () => {
  for (const selection of [
    { model: "selected-model", reasoning_effort: "high" as const },
    { reasoning_effort: "none" as const },
    { reasoning_effort: "default" as const },
    {},
  ]) {
    const { runtime, calls } = setup();
    await runtime.open({ ...task, ...selection });
    const agent = calls[0].body.agent;

    assert.equal(
      agent.model,
      "model" in selection ? selection.model : "configured-model",
    );

    if (selection.reasoning_effort && selection.reasoning_effort !== "default")
      assert.deepEqual(agent.reasoning, { effort: selection.reasoning_effort });
    else assert.equal(Object.hasOwn(agent, "reasoning"), false);
  }
});

test("native turn helper subscribes before input and ends after coordinator completion plus idle", async () => {
  const { runtime, calls } = setup();

  const stream = await runtime.turn(
    { ...task, session_id: "sess-one" },
    "Continue reviewing",
  );

  assert.ok(calls.every((r) => r.method === "GET"));
  const seen = [];
  for await (const event of stream) seen.push(event.type);

  assert.deepEqual(seen, [
    "agent.session.turn.created",
    "agent.session.turn.completed",
    "agent.session.idle",
  ]);

  const subscribe = calls.findIndex(
    (r) => r.path.endsWith("/events") && r.method === "GET",
  );

  const submit = calls.findIndex((r) => r.method === "POST");
  assert.ok(subscribe >= 0 && submit > subscribe);
  assert.equal(calls[submit].key, "codex-subagent-extension-turn-task-one-2");

  assert.equal(
    calls[submit].body.events[0].type,
    "agent.session.input.message",
  );
});

test("cancellation submits a native cancel without claiming durable completion from HTTP 202", async () => {
  const { runtime, calls, state } = setup();
  state.status = "in_progress";
  const continued = { ...task, session_id: "sess-one" };
  await runtime.cancel(continued);

  assert.deepEqual(calls[1].body.events, [
    { type: "agent.session.input.cancel" },
  ]);

  assert.equal(calls[1].key, "codex-subagent-extension-cancel-task-one-2");
  assert.equal((await runtime.status(continued)).status, "in_progress");
  await assert.rejects(runtime.turn(continued, "Continue"), /must be idle/);
});

const coordinator = () => ({
  id: "turn-one",
  session_id: "sess-one",
  subagent_id: null,
  status: "in_progress",
  usage: null,
  error: null,
});

const continuedTask = { ...task, session_id: "sess-one" };

test("cancellation confirmation requires a terminal coordinator even when the session reports idle", async () => {
  let inspections = 0;

  const { runtime, calls, replace } = setup((path, _method, state) => {
    if (path.includes("/turns/") && ++inspections === 3)
      state.turn.status = "cancelled";
  });

  replace({ ...session(), turn: coordinator() });

  const confirmed = await runtime.cancelAndWait(continuedTask, "turn-one", {
    pollMs: 1,
  });

  assert.equal(confirmed.turn.status, "cancelled");
  assert.equal(inspections, 3);
  assert.equal(calls.filter((c) => c.method === "POST").length, 1);

  assert.ok(
    calls.some((c) => c.path === "/v1/agents/sessions/sess-one/turns/turn-one"),
  );
});

test("cancellation racing successful completion preserves the actual turn outcome and waits for session quiescence", async () => {
  let inspections = 0;

  const { runtime, calls, replace } = setup((path, _method, state) => {
    if (path.includes("/turns/")) {
      inspections++;

      if (inspections === 2) {
        state.turn.status = "completed";
        state.status = "idle";
      }
    }
  });

  replace({
    ...session(),
    status: "in_progress",
    turn: { ...coordinator(), status: "completed" },
  });

  const confirmed = await runtime.cancelAndWait(continuedTask, "turn-one", {
    pollMs: 1,
  });

  assert.equal(confirmed.turn.status, "completed");
  assert.equal(confirmed.session_status, "idle");
  assert.equal(inspections, 3);
  assert.ok(calls.every((c) => c.method === "GET"));
});

test("unconfirmed cancellation times out and caller abort never reports remote termination", async () => {
  const { runtime, replace } = setup();
  replace({ ...session(), status: "in_progress", turn: coordinator() });

  await assert.rejects(
    runtime.cancelAndWait(continuedTask, "turn-one", {
      timeoutMs: 20,
      pollMs: 1,
    }),
    /remains unconfirmed/,
  );

  const controller = new AbortController();
  controller.abort(new Error("service stopping"));

  await assert.rejects(
    runtime.cancelAndWait(continuedTask, "turn-one", {
      signal: controller.signal,
    }),
    /service stopping/,
  );
});

test("cancellation confirmation rejects cross-session turns and subagents before sending cancellation", async () => {
  for (const changed of [
    { session_id: "other" },
    { subagent_id: "child" },
    { id: "other" },
  ]) {
    const { runtime, calls, replace } = setup();
    replace({ ...session(), turn: { ...coordinator(), ...changed } });

    await assert.rejects(
      runtime.cancelAndWait(continuedTask, "turn-one"),
      /coordinator turn/,
    );

    assert.ok(calls.every((c) => c.method === "GET"));
  }
});

const report = {
  summary: "Reviewed",
  findings: [],
  evidence: ["a.ts"],
  changes: [],
  tests: [],
  recommendations: [],
};

const finalMessage = () => ({
  type: "message",
  role: "assistant",
  id: "msg-one",
  turn_id: "turn-one",
  phase: "final_answer",
  status: "completed",
  content: [{ type: "output_text", text: JSON.stringify(report) }],
});

test("native saved-item retrieval selects only the completed coordinator's final structured report", async () => {
  const { runtime, calls, replace } = setup();

  replace({
    ...session(),
    turn: { ...coordinator(), status: "completed" },
    items: [
      { ...finalMessage(), turn_id: "previous-turn" },
      {
        ...finalMessage(),
        phase: "commentary",
        content: [{ type: "output_text", text: "Working" }],
      },
      { ...finalMessage(), role: "user" },
      finalMessage(),
    ],
  });

  assert.deepEqual(
    await runtime.structuredResult(continuedTask, "turn-one"),
    report,
  );

  assert.ok(calls.some((c) => c.path === "/v1/agents/sessions/sess-one/items"));
});

test("native results cannot turn cancelled work or unrelated turns into success", async () => {
  for (const changed of [
    { status: "cancelled" },
    { status: "failed" },
    { subagent_id: "child" },
    { session_id: "other" },
  ]) {
    const { runtime, calls, replace } = setup();

    replace({
      ...session(),
      turn: { ...coordinator(), status: "completed", ...changed },
      items: [finalMessage()],
    });

    await assert.rejects(
      runtime.structuredResult(continuedTask, "turn-one"),
      /completed coordinator turn/,
    );

    assert.ok(calls.every((c) => !c.path.endsWith("/items")));
  }
});

test("missing, malformed and extra-field native reports fail instead of fabricating a result", async () => {
  for (const items of [
    [],
    [
      {
        ...finalMessage(),
        content: [{ type: "output_text", text: "Not JSON" }],
      },
    ],
    [
      {
        ...finalMessage(),
        content: [
          {
            type: "output_text",
            text: JSON.stringify({ ...report, unsupported: true }),
          },
        ],
      },
    ],
  ]) {
    const { runtime, replace } = setup();

    replace({
      ...session(),
      turn: { ...coordinator(), status: "completed" },
      items,
    });

    await assert.rejects(runtime.structuredResult(continuedTask, "turn-one"));
  }
});
