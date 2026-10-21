import assert from "node:assert/strict";
import { join } from "node:path";

import { expect, test } from "vitest";

import { FixtureProvider } from "../../../../../dev/service/fixture-provider.js";
import { SendRejectedError } from "../../../../shared/tasks/conversation/send-errors.js";
import type { RunContext } from "../../providers/types.js";
import { Workspaces } from "../../workspaces/workspace.js";
import { Store } from "../storage/store.js";
import { Control } from "./control.js";
import { input, pause, setup, until } from "./control-test-harness.js";

test("send receipts survive restart, scope senders and reject conflicting retries", async () => {
  const { c, repo, db, dir } = await setup(undefined, 0);
  const task = await c.start("owner", input(repo));

  const sent = await c.send("owner", task.id, "Follow up", "user", {
    delivery: "queue",
    request_id: "retry",
  });

  assert.equal(
    (
      await c.send("owner", task.id, "Follow up", "user", {
        delivery: "queue",
        request_id: "retry",
      })
    ).message_id,
    sent.message_id,
  );

  await assert.rejects(
    c.send("owner", task.id, "Changed", "user", {
      delivery: "queue",
      request_id: "retry",
    }),
    { name: "SendRejectedError", message: /different payload/ },
  );

  await assert.rejects(
    c.send("other", task.id, "Follow up", "user", {
      delivery: "queue",
      request_id: "retry",
    }),
    { name: "Error", message: /Task not found/ },
  );

  const parent = await c.send("owner", task.id, "Follow up", "parent", {
    delivery: "queue",
    request_id: "retry",
  });

  assert.notEqual(parent.message_id, sent.message_id);
  await c.close();
  const provider = new FixtureProvider();

  const restarted = new Control(
    new Store(db),
    new Workspaces(join(dir, "worktrees"), [repo]),
    new Map([[provider.id, provider]]),
    0,
  );

  try {
    const replay = await restarted.send("owner", task.id, "Follow up", "user", {
      delivery: "queue",
      request_id: "retry",
    });

    assert.equal(replay.message_id, sent.message_id);
    assert.equal(restarted.store.get(task.id, "owner").queue.length, 2);
  } finally {
    await restarted.close();
  }
});

test("send retries coalesce before repository validation and rollback receipts", async () => {
  const { c, repo, store } = await setup(undefined, 0);

  try {
    const task = await c.start("owner", input(repo));
    task.status = "completed";
    store.save(task);
    let release!: () => void;

    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    let validations = 0;

    c.projects = {
      resolve: async () => {
        validations++;
        await gate;

        return repo;
      },
    } as unknown as NonNullable<Control["projects"]>;

    const first = c.send("owner", task.id, "Once", "user", {
      request_id: "concurrent",
    });

    const second = c.send("owner", task.id, "Once", "user", {
      request_id: "concurrent",
    });

    await pause();
    assert.equal(validations, 1);

    await assert.rejects(
      c.send("owner", task.id, "Conflict", "user", {
        request_id: "concurrent",
      }),
      /different payload/,
    );

    release();
    const results = await Promise.all([first, second]);
    assert.equal(results[0].message_id, results[1].message_id);
    assert.equal(store.get(task.id, "owner").instructions.length, 1);

    store.database.client.exec(
      "CREATE TRIGGER fail_send BEFORE INSERT ON task_send_receipts BEGIN SELECT RAISE(ABORT, 'receipt failed'); END",
    );

    await assert.rejects(
      c.send("owner", task.id, "Rollback", "user", {
        delivery: "queue",
        request_id: "rollback",
      }),
      { name: "SendRejectedError", message: "receipt failed" },
    );

    assert.equal(store.get(task.id, "owner").queue.length, 0);
    store.database.client.exec("DROP TRIGGER fail_send");

    await c.send("owner", task.id, "Rollback", "user", {
      delivery: "queue",
      request_id: "rollback",
    });

    assert.equal(store.get(task.id, "owner").queue.length, 1);
  } finally {
    await c.close();
  }
});

test("interrupt send receipts replay before shutdown finishes", async () => {
  const started = Promise.withResolvers<RunContext>();
  const finish = Promise.withResolvers<void>();
  const provider = new FixtureProvider();

  provider.run = async (context) => {
    started.resolve(context);
    await finish.promise;

    return { reply: "Stopped" };
  };

  const { c, repo, store } = await setup(provider);

  try {
    const task = await c.start("owner", input(repo));
    const context = await started.promise;

    const first = c.send("owner", task.id, "Next", "user", {
      delivery: "interrupt",
      request_id: "interrupt-retry",
    });

    await until(() => context.signal.aborted);

    const replay = await c.send("owner", task.id, "Next", "user", {
      delivery: "interrupt",
      request_id: "interrupt-retry",
    });

    assert.equal(replay.state, "started");
    assert.equal(c.active.has(task.id), true);
    assert.equal(store.get(task.id, "owner").pending_steers.length, 1);
    finish.resolve();
    assert.equal((await first).message_id, replay.message_id);
  } finally {
    finish.resolve();
    await c.close();
  }
});

test("different requests recheck task state after delayed validation", async () => {
  const { c, repo, store } = await setup(undefined, 0);

  try {
    const task = await c.start("owner", input(repo));
    task.status = "completed";
    store.save(task);
    const gate = Promise.withResolvers<void>();

    c.projects = {
      resolve: async () => {
        await gate.promise;

        return repo;
      },
    } as unknown as NonNullable<Control["projects"]>;

    const first = c.send("owner", task.id, "First", "user", {
      delivery: "queue",
      request_id: "one",
    });

    const second = c.send("owner", task.id, "Second", "user", {
      delivery: "queue",
      request_id: "two",
    });

    await pause();
    gate.resolve();
    const results = await Promise.all([first, second]);
    assert.equal(results[0].state, "started");
    assert.equal(results[1].state, "queued");
    const stored = store.get(task.id, "owner");
    assert.equal(stored.instructions.length, 1);
    assert.equal(stored.queue.length, 1);
    assert.equal(stored.instructions[0]!.message, "First");
    assert.equal(stored.queue[0]!.message, "Second");
  } finally {
    await c.close();
  }
});

test.each(["queue", "steer"] as const)(
  "failed %s receipt restores the active task before retry",
  async (delivery) => {
    const started = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    const provider = new FixtureProvider();

    provider.run = async () => {
      started.resolve();
      await finish.promise;

      return { reply: "Done" };
    };

    const { c, repo, store } = await setup(provider);

    try {
      const task = await c.start("owner", input(repo));
      await started.promise;

      store.database.client.exec(
        "CREATE TRIGGER fail_send BEFORE INSERT ON task_send_receipts BEGIN SELECT RAISE(ABORT, 'receipt failed'); END",
      );

      await assert.rejects(
        c.send("owner", task.id, "Once", "user", {
          delivery,
          request_id: "active-rollback",
        }),
        /receipt failed/,
      );

      assert.equal(c.active.get(task.id)!.task.queue.length, 0);
      assert.equal(c.active.get(task.id)!.task.pending_steers.length, 0);
      store.database.client.exec("DROP TRIGGER fail_send");

      await c.send("owner", task.id, "Once", "user", {
        delivery,
        request_id: "active-rollback",
      });

      const active = c.active.get(task.id)!.task;
      assert.equal(active.queue.length + active.pending_steers.length, 1);
    } finally {
      finish.resolve();
      await c.close();
    }
  },
);

test("accepted interrupt sends retain uncertain delivery if stopping fails", async () => {
  const started = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  const provider = new FixtureProvider();

  provider.run = async () => {
    started.resolve();
    await finish.promise;

    return { reply: "Done" };
  };

  const { c, repo, store } = await setup(provider);
  const interrupt = c.interrupt;

  try {
    const task = await c.start("owner", input(repo));
    await started.promise;
    const failure = new Error("Shutdown failed");

    c.interrupt = async () => {
      throw failure;
    };

    const options = { delivery: "interrupt", request_id: "accepted" } as const;

    await expect(
      c.send("owner", task.id, "Next", "user", options),
    ).rejects.toBe(failure);

    expect(failure).not.toBeInstanceOf(SendRejectedError);
    const replay = await c.send("owner", task.id, "Next", "user", options);
    expect(replay.state).toBe("started");
    expect(store.get(task.id, "owner").pending_steers).toHaveLength(1);

    expect(store.get(task.id, "owner").pending_steers[0]?.id).toBe(
      replay.message_id,
    );
  } finally {
    c.interrupt = interrupt;
    finish.resolve();
    await c.close();
  }
});

test("drain finishes running turns and leaves queued tasks for the next service", async () => {
  const { c, store, repo, db } = await setup(new FixtureProvider(), 1);
  const running = await c.start("alice", input(repo, "[input]"));
  await until(() => !!store.get(running.id, "alice").pending_input);
  const queued = await c.start("alice", input(repo, "Queued work"));
  const drained = c.drain(5000);

  c.input(
    "alice",
    running.id,
    store.get(running.id, "alice").pending_input!.id,
    true,
    { answer: "yes" },
  );

  await drained;
  assert.equal(store.get(running.id, "alice").status, "completed");
  assert.equal(store.get(queued.id, "alice").status, "queued");
  await c.close();
  const reopened = new Store(db);
  assert.equal(reopened.get(queued.id, "alice").status, "queued");
  reopened.close();
});

test("drain stops waiting at its limit, and close interrupts the turn left", async () => {
  const { c, store, repo, db } = await setup();
  const t = await c.start("alice", input(repo, "[input]"));
  await until(() => !!store.get(t.id, "alice").pending_input);
  await c.drain(20);
  assert.ok(c.active.has(t.id));
  await c.close();
  const reopened = new Store(db);
  assert.equal(reopened.get(t.id, "alice").status, "interrupted");
  reopened.close();
});
