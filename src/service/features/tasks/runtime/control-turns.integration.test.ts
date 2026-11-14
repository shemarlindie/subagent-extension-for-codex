import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { structuredPatch } from "diff";
import { test, vi } from "vitest";

import type { RunContext } from "../../providers/types.js";
import {
  eventData,
  input,
  pendingInput,
  PromptRecorder,
  setup,
  TestProvider,
  until,
} from "./control-test-harness.js";

test("fixture invalid-session marker triggers the normal continuation recovery path", async () => {
  const { c, store, repo } = await setup();

  const t = await c.start(
    "alice",
    input(repo, "[fixture:session state=invalid]"),
  );

  await until(() => store.get(t.id, "alice").status === "completed");
  assert.match(store.get(t.id, "alice").session_state_ref ?? "", /:invalid$/);

  await c.send("alice", t.id, "Continue", "user");
  await until(() => store.get(t.id, "alice").turn === 2);
  await until(() => store.get(t.id, "alice").status === "completed");

  assert.deepEqual(
    store
      .events(t.id, "alice")
      .find((event) => event.type === "task.session_started")?.data,
    { reason: "session_unavailable" },
  );

  const fresh = store.get(t.id, "alice").session_state_ref;
  assert.ok(fresh);
  assert.doesNotMatch(fresh, /:invalid$/);
  await c.close();
});

test("human input is durable and stale input IDs are rejected", async () => {
  const { c, store, repo } = await setup();
  const t = await c.start("alice", input(repo, "[input]"));
  await until(() => !!store.get(t.id, "alice").pending_input);
  const request = pendingInput(store, t.id);
  assert.throws(() => c.input("alice", t.id, "stale", true));

  c.input("alice", t.id, request.id, true, {
    answer: "preserve compatibility",
  });

  assert.throws(() => c.input("alice", t.id, request.id, true));
  await until(() => store.get(t.id, "alice").status === "completed");
  assert.equal(store.get(t.id, "alice").pending_input, undefined);
  await c.close();
});

test("interrupt preserves the session, and a follow-up resumes it with only the new message", async () => {
  const recorder = new PromptRecorder();
  const { c, store, repo } = await setup(recorder);
  const t = await c.start("alice", input(repo, "[input]"));
  await until(() => !!store.get(t.id, "alice").pending_input);
  await c.interrupt("alice", t.id);
  const previous = store.get(t.id, "alice").session_id;
  assert.ok(store.get(t.id, "alice").completed_at);
  await c.send("alice", t.id, "Carry on [input]", "parent");
  await until(() => !!store.get(t.id, "alice").pending_input);

  c.input("alice", t.id, pendingInput(store, t.id).id, true, {
    answer: "yes",
  });

  await until(() => store.get(t.id, "alice").status === "completed");
  const done = store.get(t.id, "alice");
  assert.equal(done.session_id, previous);
  assert.equal(done.turn, 2);
  assert.equal(done.instructions_sent, 1);
  // The resumed session already holds the request, so it gets only the message.
  assert.equal(recorder.prompts[1], "Carry on [input]");

  assert.ok(
    !store.events(t.id, "alice").some((e) => e.type === "task.session_started"),
  );

  await c.close();
});

test("a follow-up without a resumable session starts a new one carrying the conversation", async () => {
  const recorder = new PromptRecorder();
  const { c, store, repo } = await setup(recorder);
  const t = await c.start("alice", input(repo, "Review the parser"));
  await until(() => store.get(t.id, "alice").status === "completed");
  await c.send("alice", t.id, "Check the lexer too", "parent");
  await until(() => store.get(t.id, "alice").turn === 2);
  await until(() => store.get(t.id, "alice").status === "completed");

  // The session is on another worker now, so it can't resume.
  const moved = store.get(t.id, "alice");
  moved.session_owner = "another-worker";
  store.save(moved);
  await c.send("alice", t.id, "Summarise both", "user");
  await until(() => store.get(t.id, "alice").turn === 3);
  await until(() => store.get(t.id, "alice").status === "completed");

  assert.deepEqual(
    store
      .events(t.id, "alice")
      .filter((e) => e.type === "task.session_started")
      .map((e) => e.data),
    [{ reason: "session_unavailable" }],
  );

  const prompt = recorder.prompts[2];
  assert.ok(prompt);
  // The first turn's prompt, then the earlier conversation, then the message.
  assert.ok(prompt.startsWith("Review the parser"));
  assert.match(prompt, /continues in a new session/);
  assert.match(prompt, /Parent agent:\nCheck the lexer too/);
  assert.match(prompt, /Your reply:\nFixture task completed/);
  assert.ok(prompt.endsWith("Summarise both"));

  assert.ok(
    prompt.indexOf("Check the lexer too") < prompt.indexOf("Summarise both"),
  );

  assert.equal(store.get(t.id, "alice").session_owner, c.ownerWorker);

  // A task that failed before its session existed starts one, too.
  const early = await c.start("alice", input(repo, "Early"));
  await until(() => store.get(early.id, "alice").status === "completed");
  const failed = store.get(early.id, "alice");
  failed.status = "failed";
  delete failed.session_id;
  store.save(failed);
  await c.send("alice", early.id, "Try once more", "user");
  await until(() => store.get(early.id, "alice").status === "completed");

  assert.deepEqual(
    store
      .events(early.id, "alice")
      .filter((e) => e.type === "task.session_started")
      .map((e) => e.data),
    [{ reason: "no_session" }],
  );

  await c.close();
});

test("a turn stopped by its budget resumes after a follow-up raises it", async () => {
  const { c, store, repo } = await setup();

  const t = await c.start("alice", {
    ...input(repo),
    budget: { max_runtime_minutes: 20, max_cost_usd: 1 },
  });

  await until(() => store.get(t.id, "alice").status === "completed");
  const spent = store.get(t.id, "alice");
  spent.cost_usd = 1;
  store.save(spent);
  await c.send("alice", t.id, "More", "user");
  await until(() => store.get(t.id, "alice").status === "failed");
  assert.equal(store.get(t.id, "alice").error, undefined);
  assert.equal(store.get(t.id, "alice").error_code, "cost_budget_exhausted");

  assert.deepEqual(eventData(store, t.id, "task.failed"), [
    { error_code: "cost_budget_exhausted" },
  ]);

  // A limit can only go up.
  await assert.rejects(
    c.send("alice", t.id, "More", "user", {
      budget: { max_cost_usd: 0.5 },
    }),
    /can only be raised/,
  );

  assert.equal(store.get(t.id, "alice").status, "failed");

  await c.send("alice", t.id, "More", "parent", {
    budget: { max_cost_usd: 2, max_runtime_minutes: null },
  });

  await until(() => store.get(t.id, "alice").status === "completed");

  assert.equal(store.get(t.id, "alice").error_code, undefined);

  assert.deepEqual(store.get(t.id, "alice").budget, {
    max_cost_usd: 2,
    max_runtime_minutes: null,
  });

  await c.close();
});

test("cost counts each turn once, though a resumed session reports its running total", async () => {
  class Costly extends TestProvider {
    totals = [0.5, 0.8, 0.3];
    override async run(c: RunContext, p: string) {
      c.emit("agent.completed", { cost_usd: this.totals.shift() });

      return super.run(
        {
          ...c,
          emit: (type, data) => {
            if (type !== "agent.completed") c.emit(type, data);
          },
        },
        p,
      );
    }
  }

  const { c, store, repo } = await setup(new Costly());
  const t = await c.start("alice", input(repo));
  await until(() => store.get(t.id, "alice").status === "completed");
  await c.send("alice", t.id, "Again", "user");
  await until(() => store.get(t.id, "alice").turn === 2);
  await until(() => store.get(t.id, "alice").status === "completed");
  // 0.5, then 0.8 for the session so far: 0.3 more.
  assert.equal(store.get(t.id, "alice").cost_usd, 0.8);

  // A lower total started counting again, so all of it is new.
  await c.send("alice", t.id, "Again", "user");
  await until(() => store.get(t.id, "alice").turn === 3);
  await until(() => store.get(t.id, "alice").status === "completed");
  const cost = store.get(t.id, "alice").cost_usd;
  assert.ok(cost !== undefined && Math.abs(cost - 1.1) < 1e-9);
  await c.close();
});

test("a message whose turn never sent its prompt reaches the next turn", async () => {
  class Holding extends PromptRecorder {
    hold = false;

    override async run(c: RunContext, p: string) {
      if (this.hold) {
        c.promptHeld();
        throw new Error("Stopped before the prompt");
      }

      return super.run(c, p);
    }
  }

  const provider = new Holding();
  const { c, store, repo } = await setup(provider);
  const t = await c.start("alice", input(repo));
  await until(() => store.get(t.id, "alice").status === "completed");

  provider.hold = true;
  await c.send("alice", t.id, "First", "parent");
  await until(() => store.get(t.id, "alice").status === "failed");

  provider.hold = false;
  await c.send("alice", t.id, "Second", "parent");
  await until(() => store.get(t.id, "alice").status === "completed");

  const prompt = provider.prompts.at(-1) ?? "";
  assert.match(prompt, /First/);
  assert.match(prompt, /Second/);

  await c.close();
});

test("a session's effective options are stored apart from what the task requested", async () => {
  class Limited extends TestProvider {
    override async run(c: RunContext, p: string) {
      c.effectiveOptions({ model: "other" });

      return super.run(c, p);
    }
  }

  const { c, store, repo } = await setup(new Limited());

  const t = await c.start("alice", input(repo));
  await until(() => store.get(t.id, "alice").status === "completed");
  const stored = store.get(t.id, "alice");

  assert.deepEqual(stored.provider_options?.[stored.provider], {
    ...t.provider_options?.[t.provider],
    effective: { model: "other" },
  });

  await c.close();
});

test("runtime budget stops a worker waiting for input", async () => {
  const { c, store, repo } = await setup();

  const t = await c.start("alice", {
    ...input(repo, "[input]"),
    budget: { max_runtime_minutes: 0.002, max_cost_usd: 1 },
  });

  await until(() => store.get(t.id, "alice").status === "failed");
  assert.equal(store.get(t.id, "alice").error, undefined);
  assert.equal(store.get(t.id, "alice").error_code, "runtime_budget_exhausted");
  await c.close();
});

test("restart recovery marks live task interrupted and clears stale permissions", async () => {
  const { c, store, repo } = await setup();
  const t = await c.start("alice", input(repo, "[input]"));
  await until(() => !!store.get(t.id, "alice").pending_input);
  await c.interrupt("alice", t.id);
  const old = store.get(t.id, "alice");
  old.status = "waiting";
  old.waiting_reason = "waiting_for_permission";

  old.pending_input = {
    id: "old",
    kind: "permission",
    tool: "Bash",
    input: { command: "pwd" },
  };

  store.save(old);
  await c.recover();
  assert.equal(store.get(t.id, "alice").status, "interrupted");
  assert.equal(store.get(t.id, "alice").pending_input, undefined);
  await c.close();
});

test("a follow-up revalidates provider budget support before changing an interrupted task", async () => {
  const provider = new TestProvider();
  const { c, repo } = await setup(provider);
  c.stopped = true;

  try {
    const task = await c.start("alice", {
      ...input(repo),
      budget: { max_runtime_minutes: null, max_cost_usd: 1 },
    });

    await c.interrupt("alice", task.id);
    provider.capabilities.cost_budget = false;

    await assert.rejects(
      c.send("alice", task.id, "Continue", "user"),
      /does not support cost budgets/,
    );

    assert.equal(c.store.get(task.id, "alice").status, "interrupted");
  } finally {
    await c.close();
  }
});

test("cancelled queued input rejects promptly without bypassing the active permission or leaving stale requests", async () => {
  const cancelled = new AbortController();
  let queuedRejected = false;
  let firstApproved = false;
  let thirdApproved: boolean | undefined;
  const provider = new TestProvider();

  provider.run = async (ctx) => {
    const first = ctx.input("Bash", { command: "first" }, ctx.signal);

    const queued = ctx.input(
      "Bash",
      { command: "cancelled" },
      cancelled.signal,
    );

    const third = ctx.input("Bash", { command: "third" }, ctx.signal);
    cancelled.abort();
    await assert.rejects(queued, /Input interrupted/);
    queuedRejected = true;
    firstApproved = (await first).approved;
    thirdApproved = (await third).approved;
    const alreadyAborted = new AbortController();
    alreadyAborted.abort();

    await assert.rejects(
      ctx.input("Bash", { command: "already aborted" }, alreadyAborted.signal),
      /Input interrupted/,
    );

    return {
      reply: "Cancelled inputs skipped",
    };
  };

  const { c, store, repo } = await setup(provider);

  try {
    const task = await c.start("alice", {
      ...input(repo),
      provider_options: { fixture: { permission_mode: "default" } },
    });

    await until(
      () => queuedRejected && !!store.get(task.id, "alice").pending_input,
    );

    const first = pendingInput(store, task.id);
    assert.equal(first.input.command, "first");
    assert.equal(firstApproved, false);
    c.input("alice", task.id, first.id, true);

    await until(
      () =>
        store.get(task.id, "alice").pending_input?.input.command === "third",
    );

    assert.throws(() => c.input("alice", task.id, first.id, true), /stale/);

    c.input("alice", task.id, pendingInput(store, task.id).id, false);

    await until(() => store.get(task.id, "alice").status === "completed");
    assert.equal(firstApproved, true);
    assert.equal(thirdApproved, false);
    assert.equal(store.get(task.id, "alice").pending_input, undefined);

    assert.deepEqual(
      store
        .events(task.id, "alice")
        .filter((e) => e.type === "agent.input_required")
        .map((e) => (e.data.request as any).input.command),
      ["first", "third"],
    );
  } finally {
    await c.close();
  }
});

test("user task renaming checks ownership and persists across active turn updates", async () => {
  const { c, store, repo } = await setup();
  const { callTool } = await import("../../../platform/server/tools.js");
  const task = await c.start("alice", input(repo, "[input]"));

  try {
    await until(() => store.get(task.id, "alice").status === "waiting");

    await assert.rejects(
      callTool(c, "alice", "app_rename_task", {
        task_id: task.id,
        title: "New title",
      }),
      /User tools require a user interface/,
    );

    await assert.rejects(
      callTool(
        c,
        "bob",
        "app_rename_task",
        {
          task_id: task.id,
          title: "New title",
        },
        "user",
      ),
      /Task not found/,
    );

    for (const title of ["   ", "x".repeat(201)]) {
      await assert.rejects(
        callTool(
          c,
          "alice",
          "app_rename_task",
          {
            task_id: task.id,
            title,
          },
          "user",
        ),
      );
    }

    await callTool(
      c,
      "alice",
      "app_rename_task",
      {
        task_id: task.id,
        title: "  New title  ",
      },
      "user",
    );

    assert.equal(store.get(task.id, "alice").title, "New title");
    assert.equal(c.active.get(task.id)?.task.title, "New title");
    await c.interrupt("alice", task.id);
    assert.equal(store.get(task.id, "alice").title, "New title");
    assert.equal(store.get(task.id, "alice").description, task.description);
  } finally {
    await c.close();
  }
});

test("runtime budget expiry retains recorded edits", async () => {
  const started = Promise.withResolvers<RunContext>();
  const finish = Promise.withResolvers<void>();
  const provider = new TestProvider();

  provider.run = async (context) => {
    assert.ok(context.task.workspace);
    const path = join(context.task.workspace, "before-budget.txt");
    await writeFile(path, "written\n");

    context.fileChanged({
      path,
      hunks: structuredPatch("", "", "", "written\n").hunks,
      created: true,
      source: "tool",
    });

    started.resolve(context);
    await finish.promise;

    return { reply: "Provider returned after deadline" };
  };

  const { c, store, repo } = await setup(provider);

  try {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });

    const task = await c.start("alice", {
      ...input(repo),
      conversation_id: "parent-chat",
      budget: { max_runtime_minutes: 0.01, max_cost_usd: null },
    });

    const context = await started.promise;
    await vi.advanceTimersByTimeAsync(599);
    assert.equal(context.signal.aborted, false);
    await vi.advanceTimersByTimeAsync(1);
    assert.equal(context.signal.aborted, true);
    vi.useRealTimers();
    finish.resolve();
    await until(() => !c.active.has(task.id));
    const stopped = store.get(task.id, "alice");
    assert.equal(stopped.status, "failed");
    assert.equal(stopped.error_code, "runtime_budget_exhausted");
    assert.deepEqual(eventData(store, task.id, "agent.reply"), []);

    assert.deepEqual(
      c.changes.changes(stopped).files.map((file) => file.path),
      ["before-budget.txt"],
    );
  } finally {
    vi.useRealTimers();
    finish.resolve();
    await c.close();
  }
});
