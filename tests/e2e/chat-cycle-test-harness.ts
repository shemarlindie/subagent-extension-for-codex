import type { Page } from "@playwright/test";

import { liveConversationSnapshot } from "../../dev/panel/scenarios/live-conversation";
import { chatItems } from "../../src/shared/tasks/conversation/chat";
import { listedTask } from "../../src/shared/tasks/task-list";

/** Replays cycling fixture reads against an existing console task. */
export async function installChatCycle(
  page: Page,
  repository: string,
  taskId: string,
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
  await page.route("**/api/tools/list_tasks", (route) =>
    route.fulfill({
      json: {
        result: [
          listedTask(
            task(),
            events(),
            undefined,
            snapshot.draft && {
              ...snapshot.draft,
              text: messageText(snapshot.draft.message_id, snapshot.draft.text),
            },
          ),
        ],
      },
    }),
  );

  await page.route("**/api/tools/app_get_chat", (route) => {
    const { after = 0 } = route.request().postDataJSON() as { after?: number };

    return route.fulfill({
      json: {
        result: {
          items: chatItems(task(), events())
            .filter(
              (item) =>
                item.event_id > after || (after === 0 && item.event_id === 0),
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
        },
      },
    });
  });

  await page.route("**/api/tools/app_get_activity", (route) => {
    const { after = 0 } = route.request().postDataJSON() as { after?: number };

    return route.fulfill({
      json: {
        result: { events: events().filter((event) => event.id > after) },
      },
    });
  });

  return {
    get snapshot() {
      return snapshot;
    },
    at(elapsed: number, text?: string) {
      snapshot = liveConversationSnapshot(elapsed);
      firstReply = text;
    },
    async refresh(elapsed: number, text?: string) {
      this.at(elapsed, text);

      const button = page.getByRole("button", {
        name: "Refresh tasks",
        exact: true,
      });

      if (await button.isVisible()) {
        await button.click();
      } else {
        await page.getByRole("button", { name: "Panel actions" }).click();

        await page
          .getByRole("menuitem", { name: "Refresh", exact: true })
          .click();
      }
    },
  };
}
