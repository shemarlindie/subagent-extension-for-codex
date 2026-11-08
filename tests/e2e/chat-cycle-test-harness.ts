import type { Page } from "@playwright/test";

import { liveConversationSnapshot } from "../../dev/panel/scenarios/live-conversation";
import { chatItems } from "../../src/shared/tasks/conversation/chat";
import { panelTask } from "../../src/shared/tasks/task-list";

/** Replays cycling fixture reads against an existing console task. */
export async function installChatCycle(
  page: Page,
  repository: string,
  taskId: string,
  announceChange: () => void,
) {
  let snapshot = liveConversationSnapshot(8999);
  let firstReply: string | undefined;

  const messageText = (id: string, text: string) =>
    id === "msg_cycle_0_first" ? (firstReply ?? text) : text;

  const task = () => ({
    ...snapshot.task,
    id: taskId,
    repository,
    provider: "fixture",
  });

  const events = () =>
    snapshot.events.map((event) => ({ ...event, task_id: taskId }));

  // The console uses its documented listed-task draft fallback here. Real SSE
  // delivery and following are covered by chat-reading.spec.ts.
  const list = () => ({
    tasks: [
      panelTask(
        task(),
        events(),
        undefined,
        snapshot.draft && {
          ...snapshot.draft,
          text: messageText(snapshot.draft.message_id, snapshot.draft.text),
        },
      ),
    ],
  });

  const chat = (after: number) => ({
    items: chatItems(task(), events())
      .filter(
        (item) => item.event_id > after || (after === 0 && item.event_id === 0),
      )
      .map((item) =>
        item.kind === "message"
          ? {
              ...item,
              message: {
                ...item.message,
                text: messageText(item.id, item.message.text),
              },
            }
          : item,
      ),
    next_cursor: Math.max(after, snapshot.events.at(-1)?.id ?? 0),
  });

  const activity = (after: number) => ({
    events: events().filter((event) => event.id > after),
  });

  type ViewArgs = { chat?: { after?: number }; activity?: { after?: number } };

  // The service answers the rest of the view, such as projects and revision.
  await page.route("**/api/tools/app_wait_for_updates", async (route) => {
    const { view } = route.request().postDataJSON() as { view?: ViewArgs };
    const response = await route.fetch();
    const body = (await response.json()) as { result: { view?: object } };
    if (!view || !body.result.view) return route.fulfill({ response });

    return route.fulfill({
      response,
      json: {
        result: {
          ...body.result,
          view: {
            ...body.result.view,
            list: list(),
            ...(view.chat && { chat: chat(view.chat.after ?? 0) }),
            ...(view.activity && {
              activity: activity(view.activity.after ?? 0),
            }),
          },
        },
      },
    });
  });

  await page.route("**/api/tools/app_list_tasks", (route) =>
    route.fulfill({ json: { result: list() } }),
  );

  return {
    get snapshot() {
      return snapshot;
    },
    at(elapsed: number, text?: string) {
      snapshot = liveConversationSnapshot(elapsed);
      firstReply = text;
    },
    refresh(elapsed: number, text?: string) {
      this.at(elapsed, text);
      announceChange();
    },
  };
}
