import assert from "node:assert/strict";

import { test } from "vitest";

import { task } from "../../../../app/state/controller-test-harness";
import { initialState } from "../../../../app/state/initial-state";
import type { Snapshot } from "../../../../app/state/types";
import { DraftFollower } from "./draft-follower";

function fixture() {
  let state: Snapshot = {
    ...initialState(),
    tasks: [task("a")],
    selected: "a",
    tab: "chat",
  };

  const reads: string[] = [];
  let refreshes = 0;

  const follower = new DraftFollower({
    snapshot: () => state,
    hidden: () => false,
    streamsDrafts: () => false,
    patch: (patch) => (state = { ...state, ...patch }),
    tool: async <T>(name: string, args: Record<string, unknown>) => {
      reads.push(`${name}:${(args.draft as { task_id: string }).task_id}`);

      return { draft: null } as T;
    },
    run: (action) => void action(),
    refresh: async () => {
      refreshes++;
    },
  });

  return {
    follower,
    reads,
    refreshes: () => refreshes,
    state: () => state,
    set: (patch: Partial<Snapshot>) => (state = { ...state, ...patch }),
  };
}

test("the target is the selected running task's draft while Chat shows it", () => {
  const { follower, set } = fixture();
  assert.deepEqual(follower.target(), { task_id: "a" });

  set({ draft: { task: "a", message_id: "m", text: "Hel" } });

  assert.deepEqual(follower.target(), {
    task_id: "a",
    message_id: "m",
    after_length: 3,
  });

  set({ tab: "activity" });
  assert.equal(follower.target(), undefined);
  set({ tab: "chat", tasks: [{ ...task("a"), status: "completed" }] });
  assert.equal(follower.target(), undefined);
});

test("showing reads a draft only for a new target", () => {
  const { follower, reads, set } = fixture();
  follower.show();
  follower.show();
  assert.deepEqual(reads, ["app_wait_for_updates:a"]);

  // Leaving Chat and coming back reads it again.
  set({ tab: "activity" });
  follower.show();
  set({ tab: "chat" });
  follower.show();
  assert.equal(reads.length, 2);
});

test("a wait's draft is applied, and a cleared draft reads the stored message", () => {
  const { follower, state, refreshes } = fixture();
  const target = { task_id: "a", message_id: "m", after_length: 3 };
  const draft = { message_id: "m", text: "Hello" };

  assert.equal(follower.receive(target, { draft, running: true }), true);
  assert.deepEqual(state().draft, { task: "a", ...draft });

  const grown = { ...target, after_length: 5 };
  assert.equal(follower.receive(grown, { draft, running: true }), false);
  assert.equal(refreshes(), 0);

  // The draft stays until a Chat read that started afterwards finds none.
  const before = follower.reading();
  assert.equal(follower.receive(grown, { draft: null, running: false }), true);
  assert.deepEqual(state().draft, { task: "a", ...draft });
  assert.equal(refreshes(), 1);
  follower.show(before);
  assert.deepEqual(state().draft, { task: "a", ...draft });
  follower.show(follower.reading());
  assert.equal(state().draft, undefined);

  // A wait for a task no longer selected changes nothing.
  assert.equal(
    follower.receive({ task_id: "b" }, { draft, running: true }),
    false,
  );

  assert.equal(state().draft, undefined);
});

test("a streamed draft stays shown until Chat holds its stored message", () => {
  const { follower, state, refreshes, set } = fixture();
  follower.apply({ task_id: "a", message_id: "m", offset: 0, text: "Hi" });
  const inFlight = follower.reading();
  follower.apply({ task_id: "a", message_id: "m", cleared: true });
  assert.equal(refreshes(), 1);

  // A read already in flight predates the stored message.
  follower.show(inFlight);
  assert.equal(state().draft?.text, "Hi");

  const message = {
    id: "m",
    event_id: 3,
    timestamp: "",
    turn: 1,
    from: "worker" as const,
    kind: "reply" as const,
    text: "Hi",
  };

  set({
    chat: {
      task: "a",
      items: [{ kind: "message", id: "m", event_id: 3, message }],
      cursor: 3,
    },
  });

  follower.show();
  assert.equal(state().draft, undefined);
});

test.each(["its own view's Chat read", "the stored message"] as const)(
  "a listed draft survives an older Chat read and releases after %s",
  (release) => {
    const { follower, state, set, refreshes } = fixture();
    const draft = { message_id: "listed", text: "Complete reply" };
    set({ tasks: [{ ...task("a"), draft }] });
    const inFlight = follower.reading();
    const view = follower.reading();
    const next = { ...task("a"), status: "completed" as const };

    set({ draft: follower.retainListed(next, view), tasks: [next] });
    follower.show(inFlight);

    assert.deepEqual(state().draft, { task: "a", ...draft });
    assert.equal(refreshes(), 0);

    if (release === "the stored message") {
      set({
        chat: {
          task: "a",
          items: [
            {
              kind: "message",
              id: "listed",
              event_id: 3,
              message: {
                id: "listed",
                event_id: 3,
                timestamp: "",
                turn: 1,
                from: "worker",
                kind: "reply",
                text: draft.text,
              },
            },
          ],
          cursor: 3,
        },
      });

      follower.show(inFlight);
    } else {
      follower.show(view);
    }

    assert.equal(state().draft, undefined);
  },
);

test("a canonical streamed draft wins when an older listed fallback clears", () => {
  const { follower, state, set } = fixture();

  set({
    tasks: [
      {
        ...task("a"),
        draft: { message_id: "listed", text: "Older fallback" },
      },
    ],
  });

  follower.apply({
    task_id: "a",
    message_id: "canonical",
    offset: 0,
    text: "Current streamed reply",
  });

  const canonical = state().draft;
  const next = task("a");
  const view = follower.reading();
  set({ draft: follower.retainListed(next, view), tasks: [next] });
  follower.show(view);

  assert.equal(state().draft, canonical);
  assert.equal(state().draft?.text, "Current streamed reply");
});

test("changing the selected task cannot retain the previous task's draft", () => {
  const { follower, set } = fixture();

  set({
    tasks: [
      { ...task("a"), draft: { message_id: "listed", text: "Previous reply" } },
    ],
  });

  assert.equal(follower.retainListed(task("b"), follower.reading()), undefined);

  follower.apply({
    task_id: "a",
    message_id: "canonical",
    offset: 0,
    text: "Previous streamed reply",
  });

  assert.equal(follower.retainListed(task("b"), follower.reading()), undefined);
});
