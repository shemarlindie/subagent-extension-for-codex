import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { Control } from "../src/control.js";
import { Store } from "../src/store.js";
import { Workspaces } from "../src/workspace.js";
import { FixtureProvider } from "../src/providers/fixture.js";
import { Forms } from "../src/forms.js";
import { application } from "../src/app.js";
import { Auth } from "../src/auth.js";
import type { Provider } from "../src/model.js";

async function setup(provider: Provider = new FixtureProvider()) {
  const dir = await mkdtemp(join(tmpdir(), "ac-forms-"));
  execFileSync("git", ["init", "-q", dir]);
  await writeFile(join(dir, "README.md"), "hello\n");
  execFileSync("git", ["-C", dir, "add", "README.md"]);
  execFileSync("git", [
    "-C",
    dir,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-qm",
    "initial",
  ]);
  const c = new Control(
    new Store(join(dir, "db.sqlite")),
    new Workspaces(join(dir, "worktrees"), [dir]),
    new Map([[provider.id, provider]]),
    dir,
  );
  const app = application(
    c,
    new Auth("token"),
    "http://127.0.0.1:4317",
    resolve("dist/console.html"),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const rpc = async (
    name: string,
    args: object,
    state?: string,
    response?: unknown,
    capabilities: object = { elicitation: { form: {} } },
  ) => {
    const result = await fetch(base + "/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: "Bearer token",
        "Mcp-Method": "tools/call",
        "Mcp-Name": name,
        "MCP-Protocol-Version": "2026-07-28",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name,
          arguments: args,
          ...(state ? { requestState: state } : {}),
          ...(response === undefined
            ? {}
            : { inputResponses: { form: response } }),
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientInfo": {
              name: "test",
              version: "1",
            },
            "io.modelcontextprotocol/clientCapabilities": capabilities,
          },
        },
      }),
    });
    const text = await result.text();
    return JSON.parse(
      text.startsWith("event:")
        ? text
            .split("\n")
            .find((line) => line.startsWith("data:"))!
            .slice(5)
        : text,
    );
  };
  const close = async () => {
    await app.locals.closeMcp();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await c.close();
  };
  return { c, rpc, close };
}
const accepted = {
  action: "accept",
  content: {
    task: "Review [input]",
    worker: "fixture:reviewer",
    revision: "HEAD",
    max_runtime_minutes: 2,
    max_cost_usd: 1,
  },
};
async function until(fn: () => boolean) {
  for (let i = 0; i < 300; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("Timed out");
}

test("native host delegation requests user input before starting and retries complete idempotently", async () => {
  const { c, rpc, close } = await setup();
  try {
    const args = { conversation_id: "conversation-a" };
    const requested = await rpc("request_agent_task", args);
    assert.equal(
      requested.result?.resultType,
      "input_required",
      JSON.stringify(requested),
    );
    assert.equal(c.store.all().length, 0);
    const form = requested.result.inputRequests.form;
    assert.equal(form.method, "elicitation/create");
    assert.equal(form.params.requestedSchema.properties.worker.oneOf.length, 7);
    assert.equal(
      form.params.requestedSchema.properties.worker.default,
      "fixture:reviewer",
    );
    const state = requested.result.requestState;
    const [first, second] = await Promise.all([
      rpc("request_agent_task", args, state, accepted),
      rpc("request_agent_task", args, state, accepted),
    ]);
    const task = first.result?.structuredContent.result;
    assert.ok(task?.id, JSON.stringify(first));
    assert.equal(second.result?.structuredContent.result.id, task.id);
    assert.equal(task.conversation_id, "conversation-a");
    assert.equal(task.budget.max_cost_usd, 1);
    assert.equal(c.store.all().length, 1);
    assert.ok(
      (
        await rpc(
          "request_agent_task",
          { conversation_id: "changed" },
          state,
          accepted,
        )
      ).result.isError,
    );
    assert.ok(
      (
        await rpc("request_agent_task", args, state, {
          ...accepted,
          content: { ...accepted.content, task: "Different" },
        })
      ).result.isError,
    );
    assert.equal(c.store.all().length, 1);
  } finally {
    await close();
  }
});

test("form state is durable, owner-bound, expiring and cannot accept unsolicited or malformed responses", async () => {
  const { c, rpc, close } = await setup();
  try {
    const requested = await rpc("request_agent_task", {});
    const state = requested.result.requestState;
    assert.throws(() => c.forms.verify("other-owner", state));
    assert.equal(
      (
        await rpc(
          "request_agent_task",
          {},
          state.slice(0, -1) + (state.endsWith("a") ? "b" : "a"),
          accepted,
        )
      ).error.code,
      -32602,
    );
    assert.ok(
      (await rpc("request_agent_task", {}, undefined, accepted)).result.isError,
    );
    assert.ok(
      (
        await rpc("request_agent_task", {}, state, {
          action: "accept",
          content: {},
        })
      ).result.isError,
    );
    assert.ok(
      (
        await rpc("request_agent_task", {}, state, {
          ...accepted,
          content: { ...accepted.content, worker: "claude:implementer" },
        })
      ).result.isError,
    );
    assert.equal(c.store.all().length, 0);
    c.forms = new Forms(c); // A fresh service facade reads persisted pending state.
    assert.equal(c.forms.verify("local", state), state);
    const cancelled = await rpc("request_agent_task", {}, state, {
      action: "cancel",
    });
    assert.equal(cancelled.result.structuredContent.result.cancelled, true);
    assert.equal(c.store.all().length, 0);
    c.forms = new Forms(c, () => Date.now() + 11 * 60000);
    assert.equal(
      (await rpc("request_agent_task", {}, state, { action: "cancel" })).error
        .code,
      -32602,
    );
  } finally {
    await close();
  }
});

test("worker question forms bind the exact input ID and reject stale answers", async () => {
  const { c, rpc, close } = await setup();
  try {
    const task = await c.start("local", {
      provider: "fixture",
      task: "Need decision [input]",
    });
    await until(() => !!c.store.get(task.id, "local").pending_input);
    const args = { task_id: task.id };
    const first = await rpc("request_agent_input", args);
    const stale = await rpc("request_agent_input", args);
    assert.equal(
      first.result.inputRequests.form.params.requestedSchema.properties.q0.type,
      "string",
    );
    const response = {
      action: "accept",
      content: { q0: "Preserve compatibility" },
    };
    const answered = await rpc(
      "request_agent_input",
      args,
      first.result.requestState,
      response,
    );
    assert.ok(!answered.result.isError, JSON.stringify(answered));
    await until(() => c.store.get(task.id, "local").status === "completed");
    assert.ok(
      c.store
        .events(task.id, "local")
        .some((e) => JSON.stringify(e.data).includes("Preserve compatibility")),
    );
    assert.ok(
      (
        await rpc(
          "request_agent_input",
          args,
          stale.result.requestState,
          response,
        )
      ).result.isError,
    );
    assert.ok(
      !(
        await rpc(
          "request_agent_input",
          args,
          first.result.requestState,
          response,
        )
      ).result.isError,
    );
  } finally {
    await close();
  }
});

test("shell permission forms default to deny, preserve original commands, and never grant on cancellation", async () => {
  const provider: Provider = new FixtureProvider();
  let decision: any;
  provider.run = async (ctx) => {
    decision = await ctx.input("Bash", {
      command: "git status",
      description: "Inspect workspace",
    });
    return {
      summary: "Permission resolved",
      findings: [],
      evidence: [],
      changes: [],
      tests: [],
      recommendations: [],
    };
  };
  const { c, rpc, close } = await setup(provider);
  try {
    const task = await c.start("local", {
      provider: "fixture",
      task: "Inspect workspace",
      worker_profile: "implementer",
    });
    await until(() => !!c.store.get(task.id, "local").pending_input);
    const args = { task_id: task.id };
    const first = await rpc("request_agent_input", args);
    assert.equal(
      first.result.inputRequests.form.params.requestedSchema.properties.decision
        .default,
      "deny",
    );
    assert.ok(
      first.result.inputRequests.form.params.message.includes("git status"),
    );
    assert.ok(
      (
        await rpc("request_agent_input", args, first.result.requestState, {
          action: "accept",
          content: { decision: "allow", command: "dangerous replacement" },
        })
      ).result.isError,
    );
    assert.equal(decision, undefined);
    await rpc("request_agent_input", args, first.result.requestState, {
      action: "cancel",
    });
    assert.equal(decision, undefined);
    assert.ok(c.store.get(task.id, "local").pending_input);
    const second = await rpc("request_agent_input", args);
    await rpc("request_agent_input", args, second.result.requestState, {
      action: "accept",
      content: { decision: "deny" },
    });
    await until(() => !!decision);
    assert.equal(decision.approved, false);
    assert.equal(decision.input, undefined);
  } finally {
    await close();
  }
});

test("rich question forms preserve titled choices and multiple selections for native worker answers", async () => {
  const provider: Provider = new FixtureProvider();
  let decision: any;
  provider.run = async (ctx) => {
    decision = await ctx.input("AskUserQuestion", {
      questions: [
        {
          question: "Compatibility strategy?",
          options: [
            { label: "Adapter", description: "Preserve clients" },
            { label: "Migration" },
          ],
        },
        {
          question: "Which checks?",
          multiSelect: true,
          options: [{ label: "Unit tests" }, { label: "Integration tests" }],
        },
      ],
    });
    return {
      summary: "Questions resolved",
      findings: [],
      evidence: [],
      changes: [],
      tests: [],
      recommendations: [],
    };
  };
  const { c, rpc, close } = await setup(provider);
  try {
    const task = await c.start("local", {
      provider: "fixture",
      task: "Choose approach",
    });
    await until(() => !!c.store.get(task.id, "local").pending_input);
    const args = { task_id: task.id };
    const request = await rpc("request_agent_input", args);
    const fields =
      request.result.inputRequests.form.params.requestedSchema.properties;
    assert.equal(fields.q0.oneOf[0].title, "Adapter");
    assert.equal(fields.q0.oneOf[0].description, "Preserve clients");
    assert.equal(fields.q1.type, "array");
    assert.equal(fields.q1.items.anyOf[1].const, "Integration tests");
    const bad = await rpc(
      "request_agent_input",
      args,
      request.result.requestState,
      { action: "accept", content: { q0: "Adapter", q1: ["Not offered"] } },
    );
    assert.ok(bad.result.isError);
    assert.equal(decision, undefined);
    const answered = await rpc(
      "request_agent_input",
      args,
      request.result.requestState,
      {
        action: "accept",
        content: { q0: "Adapter", q1: ["Unit tests", "Integration tests"] },
      },
    );
    assert.ok(!answered.result.isError, JSON.stringify(answered));
    await until(() => !!decision);
    assert.equal(decision.approved, true);
    assert.deepEqual(decision.input.answers, {
      "Compatibility strategy?": "Adapter",
      "Which checks?": "Unit tests, Integration tests",
    });
  } finally {
    await close();
  }
});

test("clients without form capabilities receive an explicit protocol error and no task is started", async () => {
  const { c, rpc, close } = await setup();
  try {
    const result = await rpc(
      "request_agent_task",
      {},
      undefined,
      undefined,
      {},
    );
    assert.equal(result.error?.code, -32021, JSON.stringify(result));
    assert.equal(c.store.all().length, 0);
  } finally {
    await close();
  }
});

test("host delegation preserves an explicit or default choice to run without a cost limit", async () => {
  const { c, rpc, close } = await setup();
  try {
    const args = {};
    const requested = await rpc("request_agent_task", args);
    assert.equal(
      requested.result.inputRequests.form.params.requestedSchema.properties
        .use_cost_budget.default,
      true,
    );
    const response = {
      ...accepted,
      content: { ...accepted.content, use_cost_budget: false },
    };
    const started = await rpc(
      "request_agent_task",
      args,
      requested.result.requestState,
      response,
    );
    assert.equal(
      started.result.structuredContent.result.budget.max_cost_usd,
      null,
    );
    // The form's effective default is tested with the authenticated service owner.
    const owner = c.store.all()[0].owner;
    c.settings.update(owner, { set: { max_cost_usd: null } });
    const inherited = await rpc("request_agent_task", args);
    assert.equal(
      inherited.result.inputRequests.form.params.requestedSchema.properties
        .use_cost_budget.default,
      false,
    );
    const second = await rpc(
      "request_agent_task",
      args,
      inherited.result.requestState,
      accepted,
    );
    assert.equal(
      second.result.structuredContent.result.budget.max_cost_usd,
      null,
    );
  } finally {
    await close();
  }
});

test("Codex execution forms disclose whole-turn authority and bind approval to the pending request", async () => {
  const provider: Provider = new FixtureProvider();
  let decision: any;
  const policy = {
    workspace: "/isolated/worktree",
    policy: "Shell commands execute within the sandbox",
  };
  provider.run = async (ctx) => {
    decision = await ctx.input("CodexExecution", policy);
    return {
      summary: "Turn permission resolved",
      findings: [],
      evidence: [],
      changes: [],
      tests: [],
      recommendations: [],
    };
  };
  const { c, rpc, close } = await setup(provider);
  try {
    const task = await c.start("local", {
      provider: "fixture",
      task: "Run a Codex turn",
      worker_profile: "implementer",
    });
    await until(() => !!c.store.get(task.id, "local").pending_input);
    const args = { task_id: task.id };
    const requested = await rpc("request_agent_input", args);
    const form = requested.result.inputRequests.form.params;
    assert.match(form.message, /entire turn, including shell commands/);
    assert.match(form.message, /no separate command approval prompts/);
    assert.ok(form.message.includes(policy.workspace));
    assert.equal(form.requestedSchema.properties.decision.default, "deny");
    assert.equal(
      form.requestedSchema.properties.decision.oneOf[1].title,
      "Approve this execution turn",
    );
    assert.equal(decision, undefined);
    const submitted = await rpc(
      "request_agent_input",
      args,
      requested.result.requestState,
      { action: "accept", content: { decision: "allow" } },
    );
    assert.ok(!submitted.result.isError, JSON.stringify(submitted));
    await until(() => !!decision);
    assert.equal(decision.approved, true);
    assert.equal(decision.input, undefined);
  } finally {
    await close();
  }
});
