import { LIVE_CONVERSATION_PERIOD_MS } from "../../dev/panel/scenarios/live-conversation";
import { installChatCycle } from "./chat-cycle-test-harness";
import { startTask } from "./console-actions";
import { expect, test } from "./fixtures";

test.use({ reducedMotion: "no-preference" });

for (const width of [1280, 420]) {
  test(`cycling replies keep their geometry through handoff at ${width}px`, async ({
    consolePage: page,
    repository,
    inProcessService,
  }) => {
    await startTask(page, "Check cycling conversation geometry");
    const history = page.getByRole("region", { name: "Chat history" });
    await expect(history).toContainText("Fixture session turn: 1.");

    const taskId = await page
      .getByRole("region", { name: "Selected task" })
      .getAttribute("data-task");

    expect(taskId).toBeTruthy();

    const cycle = await installChatCycle(
      page,
      repository,
      taskId!,
      inProcessService.announceChange,
    );

    await page.setViewportSize({ width, height: 800 });
    await page.reload();
    const working = history.locator(".chat-working");
    await expect(history).not.toHaveAttribute("aria-busy", "true");

    for (const [streamingAt, storedAt] of [
      [8999, 9000],
      [24999, 25000],
    ] as const) {
      await test.step(`streamed reply at ${streamingAt} becomes stored`, async () => {
        cycle.refresh(streamingAt);
        const id = cycle.snapshot.draft!.message_id;
        const message = history.locator(`[data-message="${id}"]`);
        await expect(message).toHaveCount(1);
        await expect(message).toHaveAttribute("aria-busy", "true");

        // The fixture supplies the final text before the row finishes opening.
        // Measure its settled height before checking the draft-to-saved handoff.
        await expect
          .poll(() =>
            message.evaluate((element) =>
              element
                .getAnimations()
                .some(
                  (animation) =>
                    animation.playState === "running" &&
                    animation.effect instanceof KeyframeEffect &&
                    animation.effect
                      .getKeyframes()
                      .some((frame) => frame.height !== undefined),
                ),
            ),
          )
          .toBe(false);

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
        const streamed = await message.elementHandle();
        expect(streamed).not.toBeNull();
        cycle.refresh(storedAt);
        await expect(message).toHaveCount(1);
        await expect(message).not.toHaveAttribute("aria-busy", "true");

        expect(
          await message.evaluate(
            (element, original) => element === original,
            streamed,
          ),
        ).toBe(true);

        await streamed.dispose();

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
    cycle.refresh(laterTurn + 9500);

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

    // The wheel scroll can still be moving when Playwright returns, so anchor
    // only once samples an interval apart agree.
    let scrollTop: number | undefined;

    await expect
      .poll(
        async () => {
          const current = await history.evaluate(
              (element) => element.scrollTop,
            ),
            settled = current === scrollTop;

          scrollTop = current;

          return settled;
        },
        { intervals: [100] },
      )
      .toBe(true);

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
      cycle.refresh(elapsed);
      await expect(working).toHaveText(label);
      expect((await working.boundingBox())!.height).toBe(height);
      const current = await anchor.boundingBox();
      expect(Math.abs(current!.y - start!.y)).toBeLessThanOrEqual(1);
    }
  });
}
