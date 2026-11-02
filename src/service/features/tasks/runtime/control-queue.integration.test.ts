import assert from "node:assert/strict";

import { expect, test, vi } from "vitest";

import * as logging from "../../../platform/logging/logger.js";
import type { RunContext } from "../../providers/types.js";
import {
  eventData,
  input,
  PromptRecorder,
  setup,
  TestProvider,
  until,
} from "./control-test-harness.js";
import { TurnCheckpoints } from "./turn-checkpoints-test-harness.js";

test("a queued message waits for its own turn, which follows at once", async () => {
  const checkpoints = new TurnCheckpoints(1);
  const recorder = new PromptRecorder({ beforeReply: checkpoints.beforeReply });
  const { c, store, repo } = await setup(recorder);
  const log = vi.spyOn(logging, "logEvent").mockImplementation(() => {});

  const t = await c.start("alice", input(repo));
  await checkpoints.ready();

  const sent = await c.send("alice", t.id, "Then write the docs", "parent", {
    delivery: "queue",
  });

  assert.equal(sent.state, "queued");
  // Queued messages have no event until their turn starts.
  assert.deepEqual(eventData(store, t.id, "task.instruction"), []);

  assert.deepEqual(eventData(store, t.id, "task.queue_changed"), [
    {
      queue: [
        {
          message_id: sent.message_id,
          message: "Then write the docs",
          from: "parent",
        },
      ],
      paused: false,
    },
  ]);

  checkpoints.release();
  await until(() => store.get(t.id, "alice").turn === 2);
  await until(() => store.get(t.id, "alice").status === "completed");
  assert.deepEqual(recorder.prompts.slice(1), ["Then write the docs"]);

  expect(
    log.mock.calls
      .filter(([, event]) => event === "task.event_storage")
      .map(([, , fields]) => [fields?.turn, fields?.status]),
  ).toEqual([
    [1, "completed"],
    [2, "completed"],
  ]);

  log.mockRestore();

  // The task never showed as completed between the turns.
  const types = store
    .events(t.id, "alice")
    .map((e) => e.type)
    .filter((type) =>
      ["task.turn_ended", "task.completed", "task.started"].includes(type),
    );

  assert.deepEqual(types, [
    "task.started",
    "task.turn_ended",
    "task.started",
    "task.turn_ended",
    "task.completed",
  ]);

  assert.deepEqual(
    eventData(store, t.id, "task.turn_ended").map((d) => [d.turn, d.outcome]),
    [
      [1, "completed"],
      [2, "completed"],
    ],
  );

  assert.deepEqual(eventData(store, t.id, "task.instruction"), [
    {
      message_id: sent.message_id,
      message: "Then write the docs",
      from: "parent",
      delivery: "queue",
    },
  ]);

  // On an idle task, a queued message starts the next turn.
  const idle = await c.send("alice", t.id, "Last bit", "user", {
    delivery: "queue",
  });

  assert.equal(idle.state, "started");
  await until(() => store.get(t.id, "alice").turn === 3);
  await c.close();
});

test("a steer the turn ends without taking starts the next turn from the front of the queue", async () => {
  const checkpoints = new TurnCheckpoints(1);
  const recorder = new PromptRecorder({ beforeReply: checkpoints.beforeReply });
  const { c, store, repo } = await setup(recorder);
  const t = await c.start("alice", input(repo, "[late]"));
  await checkpoints.ready();
  const steer = await c.send("alice", t.id, "Late thought", "user");
  assert.equal(steer.state, "pending_steer");

  const queued = await c.send("alice", t.id, "Afterwards", "user", {
    delivery: "queue",
  });

  checkpoints.release();
  await until(() => store.get(t.id, "alice").turn === 3);
  await until(() => store.get(t.id, "alice").status === "completed");
  assert.deepEqual(recorder.prompts.slice(1), ["Late thought", "Afterwards"]);
  // The steer was recorded once, when it was sent.

  assert.deepEqual(
    eventData(store, t.id, "task.instruction").map((d) => [
      d.message_id,
      d.delivery,
    ]),
    [
      [steer.message_id, "steer"],
      [queued.message_id, "queue"],
    ],
  );

  assert.deepEqual(eventData(store, t.id, "task.steer_taken"), []);
  await c.close();
});

test("an interrupt with pending steers sends them at once as one new turn", async () => {
  const checkpoints = new TurnCheckpoints(1);
  const recorder = new PromptRecorder({ beforeReply: checkpoints.beforeReply });
  const { c, store, repo } = await setup(recorder);
  const t = await c.start("alice", input(repo, "[late]"));
  await checkpoints.ready();
  await c.send("alice", t.id, "First thought", "user");
  await c.send("alice", t.id, "Later", "user", { delivery: "queue" });

  const sent = await c.send("alice", t.id, "Stop and do this", "parent", {
    delivery: "interrupt",
  });

  assert.equal(sent.state, "started");
  await until(() => store.get(t.id, "alice").turn === 3);
  await until(() => store.get(t.id, "alice").status === "completed");

  assert.deepEqual(recorder.prompts.slice(1), [
    "First thought\n\nStop and do this",
    "Later",
  ]);

  assert.deepEqual(
    eventData(store, t.id, "task.turn_ended").map((d) => d.outcome),
    ["interrupted", "completed", "completed"],
  );

  assert.equal(store.get(t.id, "alice").queue_paused, undefined);
  await c.close();
});

test("a plain interrupt pauses the queue, keeping pending steers at its front, until resumed or a message is sent", async () => {
  const checkpoints = new TurnCheckpoints(1, 5);
  const recorder = new PromptRecorder({ beforeReply: checkpoints.beforeReply });
  const { c, store, repo } = await setup(recorder);
  const t = await c.start("alice", input(repo, "[late]"));
  await checkpoints.ready();
  await c.send("alice", t.id, "Pending", "user");
  await c.send("alice", t.id, "Queued", "user", { delivery: "queue" });
  await c.interrupt("alice", t.id);
  const paused = store.get(t.id, "alice");
  assert.equal(paused.status, "interrupted");
  assert.equal(paused.queue_paused, true);

  assert.deepEqual(
    paused.queue.map((m) => m.message),
    ["Pending", "Queued"],
  );

  assert.deepEqual(eventData(store, t.id, "task.queue_changed").at(-1), {
    queue: paused.queue.map((m) => ({
      message_id: m.id,
      message: m.message,
      from: "user",
    })),
    paused: true,
  });

  // The next message sent resumes the queue, which follows it.
  await c.send("alice", t.id, "New idea", "user");
  await until(() => store.get(t.id, "alice").turn === 4);
  await until(() => store.get(t.id, "alice").status === "completed");

  assert.deepEqual(recorder.prompts.slice(1), [
    "New idea",
    "Pending",
    "Queued",
  ]);

  // Resume starts the next queued message on an idle task.
  await c.send("alice", t.id, "[late] once more", "user");
  await checkpoints.ready(5);
  await c.send("alice", t.id, "Kept", "user", { delivery: "queue" });
  await c.interrupt("alice", t.id);
  assert.equal(store.get(t.id, "alice").queue_paused, true);
  c.resumeQueue("alice", t.id);
  await until(() => store.get(t.id, "alice").turn === 6);
  await until(() => store.get(t.id, "alice").status === "completed");
  assert.equal(recorder.prompts.at(-1), "Kept");
  await c.close();
});

test("queued messages can be reordered behind the steers the worker already has", async () => {
  const checkpoints = new TurnCheckpoints(1);
  const recorder = new PromptRecorder({ beforeReply: checkpoints.beforeReply });
  const { c, store, repo } = await setup(recorder);
  const t = await c.start("alice", input(repo, "[late]"));
  await checkpoints.ready();
  await c.send("alice", t.id, "Pending", "user");

  const [a, , last] = [
    await c.send("alice", t.id, "A", "user", { delivery: "queue" }),
    await c.send("alice", t.id, "B", "user", { delivery: "queue" }),
    await c.send("alice", t.id, "C", "user", { delivery: "queue" }),
  ];

  await c.interrupt("alice", t.id);
  const order = () => store.get(t.id, "alice").queue.map((m) => m.message);
  assert.deepEqual(order(), ["Pending", "A", "B", "C"]);

  // Nothing moves ahead of the left-over steer, and indexes clamp.
  c.moveQueued("alice", t.id, last.message_id, 0);
  assert.deepEqual(order(), ["Pending", "C", "A", "B"]);
  c.moveQueued("alice", t.id, a.message_id, 99);
  assert.deepEqual(order(), ["Pending", "C", "B", "A"]);

  const changed = eventData(store, t.id, "task.queue_changed").at(-1) as {
    queue: { message: string }[];
  };

  assert.deepEqual(
    changed.queue.map((m) => m.message),
    ["Pending", "C", "B", "A"],
  );

  const [pending] = store.get(t.id, "alice").queue;
  assert.ok(pending);

  assert.throws(
    () => c.moveQueued("alice", t.id, pending.id, 2),
    /stays at the front/,
  );

  assert.throws(
    () => c.moveQueued("alice", t.id, "msg_gone", 0),
    /no longer queued/,
  );

  c.resumeQueue("alice", t.id);
  await until(() => store.get(t.id, "alice").turn === 5);
  await until(() => store.get(t.id, "alice").status === "completed");
  assert.deepEqual(recorder.prompts.slice(1), ["Pending", "C", "B", "A"]);
  await c.close();
});

test.each([true, false])(
  "steering a queued message preserves its identity and other queue order when the provider accepts it: %s",
  async (accepted) => {
    const provider = new PromptRecorder();
    const run = provider.run.bind(provider);
    let context: RunContext | undefined;
    let finish!: () => void;

    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });

    const delivered: { id: string; text: string }[] = [];

    provider.run = async (ctx, prompt) => {
      if (!context) {
        context = ctx;

        ctx.acceptSteers((steer) => {
          delivered.push(steer);

          return accepted;
        });

        await finished;
      }

      return run(ctx, prompt);
    };

    const { c, store, repo } = await setup(provider);

    try {
      const task = await c.start("alice", input(repo));
      await until(() => !!context);

      const first = await c.send("alice", task.id, "First", "user", {
        delivery: "queue",
      });

      const selected = await c.send(
        "alice",
        task.id,
        "Keep this exact text",
        "parent",
        { delivery: "queue" },
      );

      const last = await c.send("alice", task.id, "Last", "user", {
        delivery: "queue",
      });

      c.steerQueued("alice", task.id, selected.message_id);

      assert.deepEqual(delivered, [
        { id: selected.message_id, text: "Keep this exact text" },
      ]);

      const updated = store.get(task.id, "alice");

      assert.deepEqual(
        updated.queue.map((message) => message.id),
        accepted
          ? [first.message_id, last.message_id]
          : [selected.message_id, first.message_id, last.message_id],
      );

      assert.deepEqual(eventData(store, task.id, "task.instruction"), [
        {
          message_id: selected.message_id,
          message: "Keep this exact text",
          from: "parent",
          delivery: "steer",
        },
      ]);

      if (accepted) {
        assert.deepEqual(updated.pending_steers, [
          {
            id: selected.message_id,
            message: "Keep this exact text",
            from: "parent",
          },
        ]);

        context!.steerTaken(selected.message_id);

        assert.equal(
          store.get(task.id, "alice").instructions.at(-1)?.id,
          selected.message_id,
        );
      } else {
        assert.deepEqual(updated.pending_steers, []);

        assert.deepEqual(updated.queue[0], {
          id: selected.message_id,
          message: "Keep this exact text",
          from: "parent",
          delivery: "steer",
          recorded: true,
        });

        assert.throws(() =>
          c.steerQueued("alice", task.id, selected.message_id),
        );
      }

      finish();
      await until(() => store.get(task.id, "alice").status === "completed");

      assert.deepEqual(
        provider.prompts.slice(1),
        accepted
          ? ["First", "Last"]
          : ["Keep this exact text", "First", "Last"],
      );

      assert.deepEqual(store.get(task.id, "alice").queue, []);

      assert.equal(
        eventData(store, task.id, "task.instruction").filter(
          (event) => event.message_id === selected.message_id,
        ).length,
        1,
      );
    } finally {
      finish();
      await c.close();
    }
  },
);

test("queued steering before provider startup adds the original message to the first turn instructions", async () => {
  const { c, store, repo } = await setup(new TestProvider(), 0);

  try {
    const task = await c.start("alice", input(repo));
    assert.equal(store.get(task.id, "alice").status, "queued");

    const queued = await c.send(
      "alice",
      task.id,
      "Include this in the prompt",
      "parent",
      { delivery: "queue" },
    );

    const paused = store.get(task.id, "alice");
    paused.queue_paused = true;
    store.save(paused);
    c.steerQueued("alice", task.id, queued.message_id);
    const updated = store.get(task.id, "alice");
    assert.deepEqual(updated.queue, []);
    assert.equal(updated.queue_paused, undefined);
    assert.deepEqual(updated.pending_steers, []);

    assert.deepEqual(updated.instructions, [
      {
        id: queued.message_id,
        message: "Include this in the prompt",
        from: "parent",
      },
    ]);

    assert.deepEqual(eventData(store, task.id, "task.instruction"), [
      {
        message_id: queued.message_id,
        message: "Include this in the prompt",
        from: "parent",
        delivery: "steer",
      },
    ]);
  } finally {
    await c.close();
  }
});

test("queued steering rejects idle tasks and input requests without removing the message", async () => {
  const { c, store, repo } = await setup();

  try {
    const task = await c.start("alice", input(repo, "[input]"));
    await until(() => !!store.get(task.id, "alice").pending_input);

    const queued = await c.send("alice", task.id, "Later", "user", {
      delivery: "queue",
    });

    assert.equal(queued.state, "queued");
    assert.deepEqual(store.get(task.id, "alice").pending_steers, []);

    assert.throws(
      () => c.steerQueued("alice", task.id, queued.message_id),
      /waiting for input/,
    );

    assert.equal(store.get(task.id, "alice").queue[0]?.id, queued.message_id);
    await c.interrupt("alice", task.id);
    assert.throws(() => c.steerQueued("alice", task.id, queued.message_id));
    assert.equal(store.get(task.id, "alice").queue[0]?.id, queued.message_id);
    assert.deepEqual(eventData(store, task.id, "task.instruction"), []);
  } finally {
    await c.close();
  }
});

test("a restart mid-turn moves pending steers to the front of a paused queue", async () => {
  const { c, store, repo } = await setup();
  c.stopped = true;

  try {
    const t = await c.start("alice", input(repo));
    t.status = "running";
    t.turn = 1;

    t.pending_steers = [
      { id: "msg_pending", message: "Lost in the SDK", from: "user" },
    ];

    t.queue = [
      {
        id: "msg_queued",
        message: "Queued",
        from: "parent",
        delivery: "queue",
      },
    ];

    store.save(t);
    await c.recover();
    const recovered = store.get(t.id, "alice");
    assert.equal(recovered.status, "interrupted");
    assert.equal(recovered.queue_paused, true);
    assert.deepEqual(recovered.pending_steers, []);

    assert.deepEqual(
      recovered.queue.map((m) => [m.id, m.recorded ?? false]),
      [
        ["msg_pending", true],
        ["msg_queued", false],
      ],
    );

    assert.deepEqual(eventData(store, t.id, "task.queue_changed").at(-1), {
      queue: [
        { message_id: "msg_pending", message: "Lost in the SDK", from: "user" },
        { message_id: "msg_queued", message: "Queued", from: "parent" },
      ],
      paused: true,
    });
  } finally {
    await c.close();
  }
});
