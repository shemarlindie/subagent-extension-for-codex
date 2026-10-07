import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { test } from "vitest";

import { FixtureProvider } from "../../../dev/fixture-provider.js";
import { waitForListening } from "../../../tests/support/helpers.js";
import { application } from "../../platform/server/app.js";
import { Auth } from "../../platform/server/auth.js";
import type {
  ModelChoice,
  Provider,
  RunContext,
} from "../../shared/contracts.js";
import { Projects } from "../projects/projects.js";
import { Workspaces } from "../workspaces/workspace.js";
import { Control } from "./control.js";
import { Forms } from "./forms.js";
import { Store } from "./store.js";

type InputDecision = Awaited<ReturnType<RunContext["input"]>>;

async function setup(
  provider: Provider = new FixtureProvider(),
  extra: Provider[] = [],
) {
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
    new Map([provider, ...extra].map((p) => [p.id, p])),
    dir,
  );

  const app = application(
    c,
    new Auth("token"),
    "http://127.0.0.1:4317",
    resolve("dist/app.html"),
  );

  const server = app.listen(0, "127.0.0.1");
  await waitForListening(server);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  const rpc = async (
    name: string,
    args: object,
    state?: string,
    response?: unknown,
    capabilities: object = { elicitation: { form: {} } },
    metadata: object = {},
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
            ...metadata,
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
    description: "Review [input]",
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
    const args = {
      conversation_id: "conversation-a",
      title: "  Suggested title  ",
      description: "  Suggested full instructions  ",
      model: "suggested-model",
      reasoning_effort: "low",
    };

    const requested = await rpc("request_agent_task", args);

    assert.equal(
      requested.result?.resultType,
      "input_required",
      JSON.stringify(requested),
    );

    assert.equal(c.store.all().length, 0);
    const form = requested.result.inputRequests.form;
    assert.ok(form.params.requestedSchema.required.includes("repository"));
    const schema = form.params.requestedSchema;
    assert.equal(schema.properties.model.default, "suggested-model");
    assert.equal(schema.properties.reasoning_effort.default, "low");
    assert.ok(!schema.required.includes("title"));
    assert.ok(!("title" in schema.properties));
    assert.ok(schema.required.includes("description"));

    assert.equal(
      schema.properties.description.default,
      "Suggested full instructions",
    );

    assert.equal(schema.properties.description.minLength, 1);
    assert.equal(schema.properties.description.maxLength, 20000);

    const repository =
      form.params.requestedSchema.properties.repository.oneOf[0].const;

    const response = {
      ...accepted,
      content: {
        ...accepted.content,
        repository,
        model: "accepted-model",
        reasoning_effort: "high",
        description:
          "Edited complete instructions [input]\nKeep all details and evidence.",
      },
    };

    assert.equal(form.method, "elicitation/create");
    assert.equal(form.params.requestedSchema.properties.worker.oneOf.length, 7);

    assert.equal(
      form.params.requestedSchema.properties.worker.default,
      "fixture:reviewer",
    );

    const state = requested.result.requestState;

    const missingProject = await rpc(
      "request_agent_task",
      args,
      state,
      accepted,
    );

    assert.ok(missingProject.result.isError);
    assert.equal(c.store.all().length, 0);

    const [first, second] = await Promise.all([
      rpc("request_agent_task", args, state, response),
      rpc("request_agent_task", args, state, response),
    ]);

    const task = first.result?.structuredContent.result;
    assert.ok(task?.id, JSON.stringify(first));
    assert.equal(second.result?.structuredContent.result.id, task.id);
    assert.equal(task.conversation_id, "conversation-a");
    assert.equal(task.title, "Edited complete instructions [input]");

    assert.equal(
      task.description,
      "Edited complete instructions [input]\nKeep all details and evidence.",
    );

    assert.equal(c.store.get(task.id, "local").description, task.description);
    assert.equal(task.repository, await realpath(repository));
    assert.equal(task.budget.max_cost_usd, 1);
    assert.equal(task.model, "accepted-model");
    assert.equal(task.reasoning_effort, "high");
    assert.equal(c.store.get(task.id, "local").model, "accepted-model");
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
          content: {
            ...accepted.content,
            description: "Different",
          },
        })
      ).result.isError,
    );

    assert.equal(c.store.all().length, 1);
  } finally {
    await close();
  }
});

function withModels(models: () => Promise<ModelChoice[]>): Provider {
  const provider = new FixtureProvider();

  return Object.assign(provider, { models });
}

test("host delegation offers discovered models as readable choices and keeps a custom request", async () => {
  const { c, rpc, close } = await setup(
    withModels(async () => [
      {
        value: "sonnet",
        displayName: "Sonnet 5.5",
        description: "Most efficient for simpler tasks",
        supportedEffortLevels: ["low", "medium", "high"],
      },
      { value: "haiku", displayName: "Haiku 4.5", description: "" },
    ]),
  );

  try {
    const args = { model: "custom-model" };
    const requested = await rpc("request_agent_task", args);

    const model =
      requested.result.inputRequests.form.params.requestedSchema.properties
        .model;

    assert.deepEqual(model.oneOf, [
      { const: "", title: "Use configured default" },
      {
        const: "sonnet",
        title: "Sonnet 5.5 — Most efficient for simpler tasks",
      },
      { const: "haiku", title: "Haiku 4.5" },
      { const: "custom-model", title: "custom-model (custom)" },
    ]);

    assert.equal(model.default, "custom-model");
    assert.ok(model.description.length < 160);

    const repository =
      requested.result.inputRequests.form.params.requestedSchema.properties
        .repository.oneOf[0].const;

    const unlisted = await rpc(
      "request_agent_task",
      args,
      requested.result.requestState,
      {
        ...accepted,
        content: { ...accepted.content, repository, model: "unlisted" },
      },
    );

    assert.ok(
      unlisted.result?.isError ?? unlisted.error,
      JSON.stringify(unlisted),
    );

    assert.equal(c.store.all().length, 0);

    const started = await rpc(
      "request_agent_task",
      args,
      requested.result.requestState,
      {
        ...accepted,
        content: { ...accepted.content, repository, model: "sonnet" },
      },
    );

    const task = started.result?.structuredContent.result;
    assert.ok(task?.id, JSON.stringify(started));
    assert.equal(task.model, "sonnet");
    await until(() => c.store.get(task.id, "local").status !== "queued");
  } finally {
    await close();
  }
});

test("host delegation names providers and flags workers without a model list", async () => {
  const claude = Object.assign(
    withModels(async () => [
      { value: "sonnet", displayName: "Sonnet 5.5", description: "" },
    ]),
    { id: "claude" },
  );

  const { rpc, close } = await setup(claude, [new FixtureProvider()]);

  try {
    const requested = await rpc("request_agent_task", {});

    const model =
      requested.result.inputRequests.form.params.requestedSchema.properties
        .model;

    assert.deepEqual(model.oneOf[1], {
      const: "sonnet",
      title: "claude · Sonnet 5.5",
    });

    assert.match(model.description, /No model list for fixture/);
  } finally {
    await close();
  }
});

test("host delegation keeps a free-text model field when discovery fails", async () => {
  const { rpc, close } = await setup(
    withModels(() => Promise.reject(new Error("offline"))),
  );

  try {
    const requested = await rpc("request_agent_task", {});

    const model =
      requested.result.inputRequests.form.params.requestedSchema.properties
        .model;

    assert.equal("oneOf" in model, false);
    assert.equal(model.maxLength, 200);
    assert.equal(model.default, "");
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
      title: "Need decision [input]",
      description: "Need decision [input]",
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
  let decision: InputDecision | undefined;

  provider.run = async (ctx) => {
    decision = await ctx.input("Bash", {
      command: "git status",
      description: "Inspect workspace",
    });

    return {
      reply: "Permission resolved",
    };
  };

  const { c, rpc, close } = await setup(provider);

  try {
    const task = await c.start("local", {
      provider: "fixture",
      title: "Inspect workspace",
      description: "Inspect workspace",
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
    const resolved: InputDecision = decision!;
    assert.equal(resolved.approved, false);
    assert.equal(resolved.input, undefined);
  } finally {
    await close();
  }
});

test("rich question forms preserve titled choices and multiple selections for native worker answers", async () => {
  const provider: Provider = new FixtureProvider();
  let decision: InputDecision | undefined;

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
      reply: "Questions resolved",
    };
  };

  const { c, rpc, close } = await setup(provider);

  try {
    const task = await c.start("local", {
      provider: "fixture",
      title: "Choose approach",
      description: "Choose approach",
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
    const resolved: InputDecision = decision!;
    assert.equal(resolved.approved, true);

    assert.deepEqual(resolved.input!.answers, {
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
      content: {
        ...accepted.content,
        use_cost_budget: false,
        repository:
          requested.result.inputRequests.form.params.requestedSchema.properties
            .repository.oneOf[0].const,
      },
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
      {
        ...accepted,
        content: {
          ...accepted.content,
          repository:
            inherited.result.inputRequests.form.params.requestedSchema
              .properties.repository.oneOf[0].const,
        },
      },
    );

    assert.equal(
      second.result.structuredContent.result.budget.max_cost_usd,
      null,
    );
  } finally {
    await close();
  }
});

test("provider-owned permission forms disclose whole-turn authority and bind approval to the pending request", async () => {
  const provider: Provider = new FixtureProvider();
  let decision: InputDecision | undefined;

  const policy = {
    workspace: "/isolated/worktree",
    policy: "Shell commands execute within the sandbox",
  };

  provider.run = async (ctx) => {
    decision = await ctx.input("Execution", policy, undefined, {
      description:
        "Approval covers the entire execution turn, including shell commands.",
      approveLabel: "Approve this execution turn",
      formMessage:
        "Allow this execution turn? Approval covers the entire turn, including shell commands; there are no separate command approval prompts.",
      formTitle: "Execution permission",
      formApproveLabel: "Approve this execution turn",
    });

    return {
      reply: "Turn permission resolved",
    };
  };

  const { c, rpc, close } = await setup(provider);

  try {
    const task = await c.start("local", {
      provider: "fixture",
      title: "Run an execution turn",
      description: "Run an execution turn",
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
    const resolved: InputDecision = decision!;
    assert.equal(resolved.approved, true);
    assert.equal(resolved.input, undefined);
  } finally {
    await close();
  }
});

test("project registration form requires explicit allow and replays durably without starting tasks", async () => {
  const { c, rpc, close } = await setup();
  c.projects = new Projects(c.store, c.workspaces);
  const register = c.projects.register.bind(c.projects);
  let registrations = 0;

  c.projects.register = async (...args) => {
    registrations++;

    return register(...args);
  };

  try {
    const args = { repository: c.repository };
    const requested = await rpc("request_agent_project", args);
    const schema = requested.result.inputRequests.form.params.requestedSchema;
    assert.equal(schema.properties.repository.default, c.repository);
    assert.equal(schema.properties.repository.maxLength, 4096);
    assert.equal(schema.properties.decision.default, "deny");
    assert.deepEqual(c.projects.list(), []);
    const state = requested.result.requestState;
    assert.throws(() => c.forms.verify("other-owner", state));

    const response = {
      action: "accept",
      content: { repository: c.repository, decision: "allow" },
    };

    const [submitted, concurrent] = await Promise.all([
      rpc("request_agent_project", args, state, response),
      rpc("request_agent_project", args, state, response),
    ]);

    assert.deepEqual(concurrent, submitted);
    assert.equal(registrations, 1);

    assert.equal(
      submitted.result.structuredContent.result.repository,
      await realpath(c.repository),
    );

    assert.equal(c.projects.list().length, 1);
    assert.equal(c.store.all().length, 0);
    c.forms = new Forms(c);

    assert.deepEqual(
      await rpc("request_agent_project", args, state, response),
      submitted,
    );

    assert.equal(registrations, 1);

    assert.ok(
      (
        await rpc("request_agent_project", args, state, {
          ...response,
          content: { ...response.content, decision: "deny" },
        })
      ).result.isError,
    );

    assert.ok(
      (
        await rpc(
          "request_agent_project",
          { repository: "/changed" },
          state,
          response,
        )
      ).result.isError,
    );

    c.forms = new Forms(c, () => Date.now() + 11 * 60000);

    assert.equal(
      (await rpc("request_agent_project", args, state, response)).error.code,
      -32602,
    );
  } finally {
    await close();
  }
});

test("project registration cancellation and accepted deny never grant access", async () => {
  const { c, rpc, close } = await setup();
  c.projects = new Projects(c.store, c.workspaces);

  try {
    for (const response of [
      { action: "cancel" },
      { action: "decline" },
      {
        action: "accept",
        content: { repository: c.repository, decision: "deny" },
      },
    ]) {
      const requested = await rpc("request_agent_project", {});

      const submitted = await rpc(
        "request_agent_project",
        {},
        requested.result.requestState,
        response,
      );

      assert.equal(submitted.result.structuredContent.result.cancelled, true);
      assert.deepEqual(c.projects.list(), []);
    }

    assert.equal(c.store.all().length, 0);
  } finally {
    await close();
  }
});

test("project registration validates repository roots and does not trust unsolicited responses", async () => {
  const { c, rpc, close } = await setup();
  c.projects = new Projects(c.store, c.workspaces);

  try {
    const response = {
      action: "accept",
      content: { repository: c.repository, decision: "allow" },
    };

    assert.ok(
      (await rpc("request_agent_project", {}, undefined, response)).result
        .isError,
    );

    for (const repository of [
      "relative/path",
      join(c.repository, "README.md"),
      await mkdtemp(join(tmpdir(), "ac-not-git-")),
    ]) {
      const requested = await rpc("request_agent_project", {});

      const submitted = await rpc(
        "request_agent_project",
        {},
        requested.result.requestState,
        {
          ...response,
          content: { ...response.content, repository },
        },
      );

      assert.ok(submitted.result.isError, JSON.stringify(submitted));
      assert.deepEqual(c.projects.list(), []);
    }

    const requested = await rpc("request_agent_project", {});

    for (const content of [
      { repository: "", decision: "allow" },
      { repository: c.repository, decision: "allow", kind: "parent" },
      { repository: c.repository },
    ]) {
      assert.ok(
        (
          await rpc(
            "request_agent_project",
            {},
            requested.result.requestState,
            { action: "accept", content },
          )
        ).result.isError,
      );

      assert.deepEqual(c.projects.list(), []);
    }

    assert.equal(c.store.all().length, 0);
  } finally {
    await close();
  }
});

test("project registration prefills host metadata without changing continuation arguments", async () => {
  const { c, rpc, close } = await setup();
  c.projects = new Projects(c.store, c.workspaces);

  try {
    const requested = await rpc(
      "request_agent_project",
      {},
      undefined,
      undefined,
      undefined,
      {
        "codex/sandbox-state-meta": {
          sandboxCwd: pathToFileURL(c.repository).href,
        },
      },
    );

    assert.equal(
      requested.result.inputRequests.form.params.requestedSchema.properties
        .repository.default,
      await realpath(c.repository),
    );

    const stored = JSON.parse(
      String(c.store.db.prepare("SELECT body FROM form_requests").get()!.body),
    );

    assert.deepEqual(stored.args, {});
    assert.deepEqual(c.projects.list(), []);

    const submitted = await rpc(
      "request_agent_project",
      {},
      requested.result.requestState,
      {
        action: "accept",
        content: { repository: c.repository, decision: "allow" },
      },
    );

    assert.ok(!submitted.result.isError, JSON.stringify(submitted));
    assert.equal(c.projects.list().length, 1);
    assert.equal(c.store.all().length, 0);
  } finally {
    await close();
  }
});
