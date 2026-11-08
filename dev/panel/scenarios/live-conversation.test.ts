import { expect, onTestFinished, test, vi } from "vitest";

import type { ChatRead } from "../../../src/panel/features/tasks/chat/chat-state";
import { eventPayload } from "../../../src/shared/events/payload";
import { currentActivityStatus } from "../../../src/shared/tasks/activity/activity-status";
import type { ActivityPage } from "../../../src/shared/tasks/activity/activity-tail";
import { chatItems } from "../../../src/shared/tasks/conversation/chat";
import type { Draft } from "../../../src/shared/tasks/conversation/drafts";
import type { Task } from "../../../src/shared/tasks/model";
import {
  LIVE_CONVERSATION_PERIOD_MS,
  liveConversationSnapshot,
  liveConversationTask,
} from "./live-conversation";

test("scheduled activity passes through thinking, responding, tool work and compaction", () => {
  const statusAt = (elapsed: number) => {
    const { task, events } = liveConversationSnapshot(elapsed);

    return currentActivityStatus(events, task).text;
  };

  expect(statusAt(1499)).toBe("Working");
  expect(statusAt(1500)).toBe("Thinking…");
  expect(statusAt(4000)).toBe("Responding");
  expect(statusAt(12_000)).toMatch(/^Running Bash · npm test/);
  expect(statusAt(16_000)).toBe("Compacting context");
  expect(statusAt(18_000)).toBe("Thinking…");
});

// The tools test below covers the first reply's handoff.
test("the second reply grows under one id and hands off to stored Chat", () => {
  const start = 20_000,
    end = 25_000;

  expect(liveConversationSnapshot(start - 1).draft).toBeUndefined();
  const first = liveConversationSnapshot(start);
  const growing = liveConversationSnapshot(start + 2000);
  const last = liveConversationSnapshot(end - 1);
  expect(first.draft).toBeDefined();
  expect(growing.draft?.message_id).toBe(first.draft?.message_id);
  expect(last.draft?.message_id).toBe(first.draft?.message_id);

  expect(growing.draft!.text.length).toBeGreaterThan(first.draft!.text.length);

  expect(last.draft!.text.startsWith(growing.draft!.text)).toBe(true);

  expect(
    chatItems(last.task, last.events).some(
      (item) => item.id === last.draft!.message_id,
    ),
  ).toBe(false);

  const stored = liveConversationSnapshot(end);
  expect(stored.draft).toBeUndefined();

  const matching = chatItems(stored.task, stored.events).filter(
    (item) => item.id === first.draft!.message_id,
  );

  expect(matching).toHaveLength(1);

  expect(matching[0]).toMatchObject({
    kind: "message",
    message: { text: last.draft!.text },
  });

  const finished = liveConversationSnapshot(28_000);

  expect(
    chatItems(finished.task, finished.events).filter(
      (item) => item.id === first.draft!.message_id,
    ),
  ).toHaveLength(1);
});

test("later loops keep event, message and tool identities distinct", () => {
  const first = liveConversationSnapshot(28_000);
  const second = liveConversationSnapshot(LIVE_CONVERSATION_PERIOD_MS + 28_000);
  const ids = second.events.map((event) => event.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).toEqual([...ids].sort((a, b) => a - b));

  const newEvents = second.events.filter(
    (event) => event.id > first.events.at(-1)!.id,
  );

  expect(newEvents.length).toBe(first.events.length);

  const messageIds = second.events.flatMap((event) => {
    const message = eventPayload(event, "agent.message");

    return message?.message_id ? [message.message_id] : [];
  });

  const toolIds = second.events.flatMap((event) => {
    const tool = eventPayload(event, "tool.started");

    return tool?.id ? [tool.id] : [];
  });

  expect(messageIds).toHaveLength(4);
  expect(new Set(messageIds).size).toBe(messageIds.length);
  expect(toolIds).toHaveLength(2);
  expect(new Set(toolIds).size).toBe(toolIds.length);
});

test("completion restarts cleanly and long-running reads retain three recent turns", () => {
  const finished = liveConversationSnapshot(LIVE_CONVERSATION_PERIOD_MS - 1);
  const restarted = liveConversationSnapshot(LIVE_CONVERSATION_PERIOD_MS);
  expect(finished.task.status).toBe("completed");
  expect(restarted.task).toMatchObject({ status: "running", turn: 2 });
  expect(restarted.draft).toBeUndefined();

  expect(restarted.events.at(-1)!.id).toBeGreaterThan(
    finished.events.at(-1)!.id,
  );

  expect(restarted.revision).not.toBe(finished.revision);

  const recent = liveConversationSnapshot(
    100 * LIVE_CONVERSATION_PERIOD_MS + 28_000,
  );

  const turns = recent.events.flatMap((event) => {
    const started = eventPayload(event, "task.started");

    return started ? [started.turn] : [];
  });

  expect(turns).toEqual([99, 100, 101]);
  expect(recent.events).toHaveLength(finished.events.length * 3);
});

test("preview tools share live cursors and replace a growing draft with stored Chat", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

  onTestFinished(() => {
    vi.useRealTimers();
  });

  vi.resetModules();
  const { previewTool } = await import("./tools");
  const taskId = liveConversationTask.id;
  const args = { task_id: taskId };

  const wait = () =>
    previewTool("app_wait_for_updates", { draft: args }) as {
      revision: string;
      draft: Draft | null;
      running: boolean;
    };

  const view = (after = 0) =>
    (
      previewTool("app_wait_for_updates", {
        view: {
          list: {},
          chat: { ...args, after },
          activity: { ...args, after },
        },
      }) as { view: { chat: ChatRead; activity: ActivityPage } }
    ).view;

  vi.advanceTimersByTime(4000);
  const first = wait();
  const { chat, activity } = view();
  const cursor = activity.events.at(-1)!.id;
  expect(first.running).toBe(true);
  expect(first.draft).toBeDefined();
  expect(chat.next_cursor).toBe(cursor);

  vi.advanceTimersByTime(2000);
  const growing = wait();
  expect(growing.revision).toBe(first.revision);
  expect(growing.draft?.message_id).toBe(first.draft?.message_id);
  expect(growing.draft!.text.length).toBeGreaterThan(first.draft!.text.length);

  expect(view(cursor).activity).toMatchObject({ events: [] });

  vi.advanceTimersByTime(3000);
  const stored = wait();

  const delta = view(chat.next_cursor).chat;

  expect(stored.draft).toBeNull();
  expect(stored.revision).not.toBe(first.revision);
  expect(delta.items).toHaveLength(1);
  expect(delta.items[0]?.id).toBe(first.draft?.message_id);
  expect(delta.next_cursor).toBeGreaterThan(chat.next_cursor);

  vi.advanceTimersByTime(19_000);
  expect(wait()).toMatchObject({ running: false, draft: null });
  vi.advanceTimersByTime(4000);
  expect(wait()).toMatchObject({ running: true, draft: null });
  const { tasks: listed } = previewTool("app_list_tasks") as { tasks: Task[] };

  expect(listed.find((task) => task.id === taskId)).toMatchObject({
    status: "running",
    turn: 2,
  });
});
