import assert from "node:assert/strict";

import { expect, test, vi } from "vitest";

import { ArchiveActions } from "../../features/tasks/archive/archive-actions";
import { task } from "./controller-test-harness";
import { initialState } from "./initial-state";
import type { Snapshot } from "./types";
import { taskView, UndoHistory, type UndoEntry } from "./undo-history";

function setup() {
  let state: Snapshot = initialState();

  const history = new UndoHistory({
    snapshot: () => state,
    closed: () => false,
    patch: (patch) => {
      state = { ...state, ...patch };
    },
  });

  const entry = (label: string, patch: Partial<UndoEntry> = {}): UndoEntry => ({
    label,
    undo: vi.fn(async () => {}),
    redo: vi.fn(async () => {}),
    ...patch,
  });

  return {
    history,
    entry,
    state: () => state,
    show: (patch: Partial<Snapshot>) => (state = { ...state, ...patch }),
    /** The open toast, which the test expects. */
    notice: () => {
      assert.ok(state.undoNotice);

      return state.undoNotice;
    },
  };
}

test("a change shows a toast only when it takes something off the screen, listing at most three items", () => {
  const { history, entry, state } = setup();

  history.record(
    entry("Archived 5 tasks", {
      toast: true,
      items: ["A", "B", "C", "D", "E"],
    }),
  );

  expect(state().undoNotice).toMatchObject({
    text: "Archived 5 tasks",
    items: ["A", "B", "C"],
    rest: "and 2 more",
    offer: "undo",
  });

  // A quiet change closes the older toast, whose Undo would reverse it unseen.
  history.record(entry("Moved a queued message"));
  expect(state().undoNotice).toBeUndefined();
});

test("undo and redo always show what they did, and steps the same way collect while the toast is open", async () => {
  const { history, entry, state } = setup();

  for (const label of ["First", "Second", "Third", "Fourth"]) {
    history.record(entry(label));
  }

  await history.undo();

  expect(state().undoNotice).toMatchObject({
    text: "Undid: Fourth",
    offer: "redo",
  });

  for (let step = 0; step < 3; step++) await history.undo();

  expect(state().undoNotice).toMatchObject({
    text: "Undid 4 changes",
    items: ["First", "Second", "Third"],
    rest: "and 1 earlier",
  });

  // Turning around starts a new list.
  await history.redo();

  expect(state().undoNotice).toMatchObject({
    text: "Redid: First",
    offer: "undo",
  });

  // Once the toast closes, the next step starts afresh.
  const notice = state().undoNotice;
  assert.ok(notice);
  history.dismiss(notice.id);
  await history.redo();
  expect(state().undoNotice?.text).toBe("Redid: Second");
  expect(state().undoRevision).toBe(6);

  // A new change clears what could be redone.
  const third = entry("Third again");
  history.record(third);
  await history.redo();
  expect(third.redo).not.toHaveBeenCalled();
});

test("a step names its task only while the task is out of view", async () => {
  const { history, entry, state, show } = setup();

  show({
    tasks: [{ ...task("t1"), title: "Rename the flags" }],
    selected: "t1",
    tab: "chat",
  });

  history.record(
    entry("Moved a queued message", { view: taskView("t1", "chat") }),
  );

  await history.undo();
  expect(state().undoNotice?.text).toBe("Undid: Moved a queued message");

  show({ tab: "activity" });
  await history.redo();

  expect(state().undoNotice?.text).toBe(
    "Redid: Moved a queued message · Rename the flags",
  );
});

test("a failed step warns and is dropped, and a busy panel keeps the step for later", async () => {
  const { history, entry, state, show } = setup();

  const kept = entry("Kept");
  const failing = entry("Failing");

  vi.mocked(failing.undo).mockRejectedValue(new Error("It changed."));
  history.record(kept);
  history.record(failing);

  show({ busy: true });
  await history.undo();
  expect(failing.undo).not.toHaveBeenCalled();

  show({ busy: false });
  await history.undo();

  expect(state().undoNotice).toEqual({
    id: expect.any(Number),
    text: "Couldn't undo: It changed.",
    failed: true,
  });

  await history.undo();
  expect(kept.undo).toHaveBeenCalledOnce();
  await history.redo();
  expect(failing.redo).not.toHaveBeenCalled();
});

test("the toast's button reverses every step it lists", async () => {
  const { history, entry, state, notice } = setup();
  const changes = ["First", "Second", "Third"].map((label) => entry(label));

  for (const change of changes) history.record(change);
  for (let step = 0; step < 3; step++) await history.undo();

  expect(state().undoNotice).toMatchObject({
    text: "Undid 3 changes",
    offer: "redo",
    steps: 3,
  });

  await history.redo(notice().steps);

  for (const change of changes) expect(change.redo).toHaveBeenCalledOnce();

  expect(state().undoNotice).toMatchObject({
    text: "Redid 3 changes",
    items: ["Third", "Second", "First"],
    steps: 3,
  });
});

test("quick presses all count, in order, while an earlier step is still running", async () => {
  const { history, entry } = setup();
  const order: string[] = [];
  let finish = () => {};

  const slow = entry("Slow", {
    undo: () =>
      new Promise<void>((resolve) => {
        order.push("slow");
        finish = resolve;
      }),
  });

  const fast = entry("Fast", {
    undo: async () => {
      order.push("fast");
    },
  });

  history.record(slow);
  history.record(fast);

  const first = history.undo();
  const second = history.undo();
  await first;
  await vi.waitFor(() => expect(order).toEqual(["fast", "slow"]));
  finish();
  await second;

  expect(order).toEqual(["fast", "slow"]);
});

test("changes and steps run in the order asked, so undo reverses the change in progress and never a later one", async () => {
  const { history, entry, state } = setup();
  const earlier = entry("Earlier");
  const saving = Promise.withResolvers<boolean>();
  const archive = entry("Archived “Parser”", { toast: true });
  const later = entry("Marked “Docs” unread");

  history.record(earlier);

  const archiving = history.change(
    () => saving.promise,
    () => archive,
  );

  const undoing = history.undo();

  const marking = history.change(
    async () => true,
    () => later,
  );

  expect(state().undoPending).toBe(true);

  saving.resolve(true);
  await Promise.all([archiving, undoing, marking]);
  expect(archive.undo).toHaveBeenCalledOnce();
  expect(later.undo).not.toHaveBeenCalled();
  expect(state().undoPending).toBe(false);

  await history.undo();
  expect(later.undo).toHaveBeenCalledOnce();
  expect(earlier.undo).not.toHaveBeenCalled();
});

test("a change that fails or changes nothing leaves the history as it was, redo included", async () => {
  const { history, entry } = setup();
  const first = entry("First");

  history.record(first);
  await history.undo();

  await expect(
    history.change(
      () => Promise.reject(new Error("offline")),
      () => entry("Failed"),
    ),
  ).rejects.toThrow("offline");

  await history.change(
    async () => false,
    (changed) => (changed ? entry("Skipped") : undefined),
  );

  await history.redo();
  expect(first.redo).toHaveBeenCalledOnce();
});

test("a local change made while an undo waits cancels the undo and stays undoable", async () => {
  const { history, entry, state } = setup();
  const first = entry("First");
  const viewed = entry("Marked “a.ts” viewed", { toast: true });
  const saving = Promise.withResolvers<boolean>();

  history.record(first);

  const archiving = history.change(
    () => saving.promise,
    (changed) => (changed ? entry("Archived") : undefined),
  );

  const undoing = history.undo();
  // Already on screen, so an older undo must not reverse what it changed.
  history.record(viewed);
  saving.resolve(false);
  await Promise.all([archiving, undoing]);

  expect(first.undo).not.toHaveBeenCalled();
  expect(viewed.undo).not.toHaveBeenCalled();
  expect(state().undoNotice?.text).toBe("Marked “a.ts” viewed");

  await history.undo();
  expect(viewed.undo).toHaveBeenCalledOnce();
});

test("a partial archive redo keeps its successful changes undoable", async () => {
  const { history, state, show } = setup();

  const tasks = ["a", "b"].map((id) => ({
    ...task(id),
    status: "completed" as const,
  }));

  show({ tasks });

  const tool = vi.fn(
    async (_name: string, args: Record<string, unknown>) =>
      ({ task_ids: args.task_ids, skipped: [] }) as never,
  );

  const actions = new ArchiveActions({
    snapshot: state,
    patch: show,
    closed: () => false,
    tool,
    leaveSelection: () => {},
    select: async () => {},
    undo: history,
  });

  await actions.setArchived(tasks, true);
  await history.undo();
  tool.mockResolvedValueOnce({ task_ids: ["a"], skipped: ["b"] } as never);
  await history.redo();

  expect(state().undoNotice).toMatchObject({
    text: expect.stringContaining("1 skipped"),
    offer: "undo",
    failed: true,
  });

  await history.undo();

  expect(tool).toHaveBeenLastCalledWith("app_set_tasks_archived", {
    task_ids: ["a"],
    archived: false,
  });

  expect(state().tasks.some((task) => task.archived_at)).toBe(false);
});
