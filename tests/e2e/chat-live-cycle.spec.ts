import {
  LIVE_CONVERSATION_PERIOD_MS,
  liveConversationSnapshot,
} from "../../dev/panel/scenarios/live-conversation";
import { chatItems } from "../../src/shared/tasks/conversation/chat";
import { listedTask } from "../../src/shared/tasks/task-list";
import { startTask } from "./console-actions";
import { expect, test } from "./fixtures";

for (const width of [1280, 420]) {
  test(`cycling replies keep their geometry through handoff at ${width}px`, async ({
    consolePage: page,
    repository,
  }) => {
    await startTask(page, "Check cycling conversation geometry");
    const history = page.getByRole("region", { name: "Chat history" });
    await expect(history).toContainText("Fixture session turn: 1.");

    const taskId = await page
      .getByRole("region", { name: "Selected task" })
      .getAttribute("data-task");

    expect(taskId).toBeTruthy();

    let snapshot = liveConversationSnapshot(8999);

    const task = () => ({
      ...snapshot.task,
      id: taskId!,
      repository,
      provider: "fixture",
    });

    const events = () =>
      snapshot.events.map((event) => ({ ...event, task_id: taskId! }));

    // Exercise the cycling fixture through the console's documented draft fallback.
    // Real SSE delivery and following are covered by chat-reading.spec.ts.
    await page.route("**/api/tools/list_tasks", (route) =>
      route.fulfill({
        json: {
          result: [listedTask(task(), events(), undefined, snapshot.draft)],
        },
      }),
    );

    await page.route("**/api/tools/app_get_chat", (route) => {
      const { after = 0 } = route.request().postDataJSON() as {
        after?: number;
      };

      return route.fulfill({
        json: {
          result: {
            items: chatItems(task(), events()).filter(
              (item) =>
                item.event_id > after || (after === 0 && item.event_id === 0),
            ),
            next_cursor: Math.max(after, snapshot.events.at(-1)?.id ?? 0),
          },
        },
      });
    });

    await page.route("**/api/tools/app_get_activity", (route) => {
      const { after = 0 } = route.request().postDataJSON() as {
        after?: number;
      };

      return route.fulfill({
        json: {
          result: { events: events().filter((event) => event.id > after) },
        },
      });
    });

    await page.setViewportSize({ width, height: 800 });
    await page.reload();
    const working = history.locator(".chat-working");
    await expect(history).not.toHaveAttribute("aria-busy", "true");

    const refresh = async (elapsed: number) => {
      snapshot = liveConversationSnapshot(elapsed);

      const refreshButton = page.getByRole("button", {
        name: "Refresh tasks",
        exact: true,
      });

      if (await refreshButton.isVisible()) {
        await refreshButton.click();
      } else {
        await page.getByRole("button", { name: "Panel actions" }).click();

        await page
          .getByRole("menuitem", { name: "Refresh", exact: true })
          .click();
      }
    };

    for (const [streamingAt, storedAt] of [
      [8999, 9000],
      [24999, 25000],
    ] as const) {
      await test.step(`streamed reply at ${streamingAt} becomes stored`, async () => {
        await refresh(streamingAt);
        const id = snapshot.draft!.message_id;
        const message = history.locator(`[data-message="${id}"]`);
        await expect(message).toHaveCount(1);
        await expect(message).toHaveAttribute("aria-busy", "true");

        await expect
          .poll(() =>
            history.evaluate(
              (element) =>
                element.scrollHeight - element.scrollTop - element.clientHeight,
            ),
          )
          .toBeLessThanOrEqual(1);

        const before = await message.boundingBox();
        expect(before).not.toBeNull();
        await refresh(storedAt);
        await expect(message).toHaveCount(1);
        await expect(message).not.toHaveAttribute("aria-busy", "true");

        await expect
          .poll(
            async () => {
              const after = await message.boundingBox();
              if (!after || !before) return Infinity;

              return Math.max(
                ...(["x", "y", "width", "height"] as const).map((key) =>
                  Math.abs(after[key] - before[key]),
                ),
              );
            },
            {
              message: `Reply ${id} should keep its box when the stored message replaces its draft`,
            },
          )
          .toBeLessThanOrEqual(1);
      });
    }

    // Two completed turns give the reader enough history to scroll away from
    // the end. Activity then changes without adding conversation rows.
    const laterTurn = 2 * LIVE_CONVERSATION_PERIOD_MS;
    await page.setViewportSize({ width, height: 640 });
    await refresh(laterTurn + 9500);

    await expect(
      history.locator('[data-message="msg_cycle_2_first"]'),
    ).toHaveCount(1);

    await expect(working).toHaveText("Thinking…");

    await expect
      .poll(() =>
        history.evaluate(
          (element) =>
            element.scrollHeight - element.scrollTop - element.clientHeight,
        ),
      )
      .toBeLessThanOrEqual(1);

    await history.hover();
    await page.mouse.wheel(0, -250);

    await expect(
      page.getByRole("button", {
        name: "Scroll to latest message",
        exact: true,
      }),
    ).toBeVisible();

    const anchorId = await history.evaluate((element) => {
      const frame = element.getBoundingClientRect();

      const visible = [...element.querySelectorAll("[data-message]")].find(
        (row) => {
          const box = row.getBoundingClientRect();

          return box.bottom > frame.top + 20 && box.top < frame.bottom;
        },
      );

      if (!visible) {
        throw new Error("No visible message to anchor the reading position");
      }

      return visible.getAttribute("data-message");
    });

    const anchor = history.locator(`[data-message="${anchorId}"]`);
    const start = await anchor.boundingBox();
    const height = (await working.boundingBox())!.height;

    for (const [elapsed, label] of [
      [laterTurn + 12_000, /Running Bash/],
      [laterTurn + 16_000, "Compacting context"],
      [laterTurn + 18_000, "Thinking…"],
    ] as const) {
      await refresh(elapsed);
      await expect(working).toHaveText(label);
      expect((await working.boundingBox())!.height).toBe(height);
      const current = await anchor.boundingBox();
      expect(Math.abs(current!.y - start!.y)).toBeLessThanOrEqual(1);
    }
  });
}
