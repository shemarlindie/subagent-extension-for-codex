import assert from "node:assert/strict";

import { test, vi } from "vitest";

import type { DraftTarget } from "../../features/tasks/chat/drafts/draft-follower";
import type { UpdateRead, ViewRequest } from "./panel-view";
import { UpdateFollower } from "./update-follower";

function fixture(
  t: { onTestFinished(fn: () => void): void },
  answer: (args: Record<string, unknown>) => unknown,
) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  let closed = false;

  t.onTestFinished(() => {
    closed = true;
    vi.useRealTimers();
  });

  const calls: Record<string, unknown>[] = [];
  const statuses: string[] = [];
  /** What the follower passed on, in order. */
  const received: string[] = [];
  let target: DraftTarget | undefined;
  let request: ViewRequest | undefined;
  let drafts = 0;

  const follower = new UpdateFollower({
    closed: () => closed,
    tool: async <T>(name: string, args: Record<string, unknown>) => {
      assert.equal(name, "app_wait_for_updates");
      calls.push(args);

      return answer(args) as T;
    },
    status: (text) => statuses.push(text),
    viewRequest: () => request,
    receive: async (read: UpdateRead, asked?: ViewRequest) => {
      assert.equal(asked, request);
      received.push(read.view ? "view" : read.revision);
    },
    draftTarget: () => target,
    receiveDraft: () => {
      drafts++;
      received.push("draft");

      return true;
    },
  });

  return {
    follower,
    calls,
    statuses,
    received,
    drafts: () => drafts,
    setTarget: (next?: DraftTarget) => (target = next),
    setRequest: (next?: ViewRequest) => (request = next),
  };
}

test("each wait sends the last revision, and one that returns at once with nothing new pauses", async (t) => {
  const { follower, calls, statuses, received } = fixture(t, () => ({
    revision: "boot:1",
  }));

  follower.follow();
  // Following twice still holds one wait at a time.
  follower.follow();
  await vi.advanceTimersByTimeAsync(0);
  assert.deepEqual(calls, [{ wait_ms: 20000 }]);

  // A new revision only keeps waits 100 ms apart.
  await vi.advanceTimersByTimeAsync(100);
  assert.deepEqual(calls.at(-1), { after: "boot:1", wait_ms: 20000 });
  assert.equal(calls.length, 2);

  // The same revision at once waits a second before the next wait.
  await vi.advanceTimersByTimeAsync(999);
  assert.equal(calls.length, 2);
  await vi.advanceTimersByTimeAsync(1);
  assert.equal(calls.length, 3);
  // Only the new revision is passed on.
  assert.deepEqual(received, ["boot:1"]);
  assert.deepEqual(new Set(statuses), new Set(["Connected"]));
});

test("a draft target goes with the wait, and its draft to the chat feature", async (t) => {
  const { follower, calls, drafts, setTarget } = fixture(t, (args) => ({
    revision: "boot:1",
    ...(args.draft ? { draft: null, running: true } : {}),
  }));

  setTarget({ task_id: "a", message_id: "m", after_length: 3 });
  follower.follow();
  await vi.advanceTimersByTimeAsync(0);

  assert.deepEqual(calls, [
    {
      draft: { task_id: "a", message_id: "m", after_length: 3 },
      wait_ms: 20000,
    },
  ]);

  assert.equal(drafts(), 1);

  // Without a target, as while hidden, the wait carries on for revisions.
  setTarget(undefined);
  await vi.advanceTimersByTimeAsync(1000);
  assert.deepEqual(calls.at(-1), { after: "boot:1", wait_ms: 20000 });
  assert.equal(drafts(), 1);
});

test("a failed wait reports reconnecting and retries after 2 s, doubling to 30 s", async (t) => {
  let failures = 6;

  const { follower, calls, statuses } = fixture(t, () => {
    if (failures-- > 0) throw new Error("Host unavailable");

    return { revision: "boot:1" };
  });

  follower.follow();
  await vi.advanceTimersByTimeAsync(0);
  assert.equal(calls.length, 1);
  assert.deepEqual(statuses, ["Reconnecting…"]);

  for (const [delay, count] of [
    [2000, 2],
    [4000, 3],
    [8000, 4],
    [16000, 5],
    [30000, 6],
    [30000, 7],
  ] as const) {
    await vi.advanceTimersByTimeAsync(delay - 1);
    assert.equal(calls.length, count - 1);
    await vi.advanceTimersByTimeAsync(1);
    assert.equal(calls.length, count);
  }

  assert.equal(statuses.at(-1), "Connected");
});

test("a view request goes with each wait, and its view applies before the draft", async (t) => {
  const { follower, calls, received, setTarget, setRequest } = fixture(
    t,
    (args) => ({
      revision: "boot:2",
      ...(args.view ? { view: {} } : {}),
      draft: null,
      running: true,
    }),
  );

  const args = {
    list: { conversation_id: null, include: [], include_read_completed: false },
  };

  setRequest({
    args,
    draftRead: 1,
    scope: 1,
    projects: 0,
    selection: 1,
    tab: 0,
  });

  setTarget({ task_id: "a", message_id: "m", after_length: 3 });
  follower.follow("boot:1");
  await vi.advanceTimersByTimeAsync(0);

  assert.deepEqual(calls, [
    {
      after: "boot:1",
      draft: { task_id: "a", message_id: "m", after_length: 3 },
      view: args,
      wait_ms: 20000,
    },
  ]);

  assert.deepEqual(received, ["view", "draft"]);
});
