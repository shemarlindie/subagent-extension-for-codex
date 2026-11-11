import type { CDPSession, Locator } from "@playwright/test";

import { installChatCycle } from "./chat-cycle-test-harness";
import { startTask } from "./console-actions";
import { expect, test } from "./fixtures";

/** Measures the rendered caret itself, including its browser-generated static position. */
async function caretBox(cdp: CDPSession) {
  const { root } = await cdp.send("DOM.getDocument");

  const { nodeId } = await cdp.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: '[data-message="msg_cycle_0_first"]',
  });

  const { node } = await cdp.send("DOM.describeNode", {
    nodeId,
    depth: -1,
    pierce: true,
  });

  const carets: number[] = [];

  const visit = (current: typeof node) => {
    if (current.pseudoType === "after") carets.push(current.backendNodeId);
    for (const child of current.children ?? []) visit(child);
    for (const pseudo of current.pseudoElements ?? []) visit(pseudo);
  };

  visit(node);
  expect(carets).toHaveLength(1);

  const { model } = await cdp.send("DOM.getBoxModel", {
    backendNodeId: carets[0]!,
  });

  return {
    left: model.border[0]!,
    top: model.border[1]!,
    right: model.border[4]!,
    bottom: model.border[5]!,
  };
}

const conversationGeometry = (history: Locator) =>
  history.evaluate((element) => {
    const message = element.querySelector(
      '[data-message="msg_cycle_0_first"]',
    )!;

    const box = message.getBoundingClientRect();

    const earlier = element
      .querySelector('[data-message="request"]')!
      .getBoundingClientRect();

    return {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      earlierTop: earlier.top,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
    };
  });

/** Waits for Chat to finish laying out and animating after a reload. */
async function settledGeometry(history: Locator) {
  // A pending entrance, such as the narrow task slide, holds its first
  // keyframe until the next rendered frame, which a busy runner can delay.
  await history.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.effect?.getComputedTiming().endTime !== Infinity,
        )
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );

  // The first poll runs at once, so compare only samples an interval apart.
  let previous: Awaited<ReturnType<typeof conversationGeometry>> | undefined;

  await expect
    .poll(
      async () => {
        const current = await conversationGeometry(history);

        const same =
          previous !== undefined &&
          JSON.stringify(current) === JSON.stringify(previous);

        previous = current;

        return same;
      },
      { intervals: [100] },
    )
    .toBe(true);

  return previous!;
}

test.use({ reducedMotion: "no-preference" });

for (const width of [1280, 420]) {
  test(`Markdown ending carets stay with the final text without moving Chat at ${width}px`, async ({
    consolePage: page,
    repository,
    inProcessService,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await startTask(page, "Check Markdown ending carets");
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
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("DOM.enable");

    for (const [name, markdown] of [
      ["paragraph", "A paragraph ending."],
      ["nested unordered list", "- Outer item\n  - Nested tail"],
      ["nested ordered list", "1. Outer item\n   1. Nested tail"],
      ["loose list", "- First paragraph\n\n  Last paragraph"],
      ["blockquote", "> A quoted ending."],
      ["fenced code", "```ts\nconst done = true;\n```"],
    ] as const) {
      await test.step(name, async () => {
        cycle.at(8999, markdown);
        await page.reload();
        const message = history.locator('[data-message="msg_cycle_0_first"]');
        await expect(message).toHaveAttribute("aria-busy", "true");
        await expect(history).not.toHaveAttribute("aria-busy", "true");
        // A shown skeleton holds its minimum visible time after loading ends.
        await expect(history.locator(".loading-swap-skeleton")).toHaveCount(0);
        const before = await settledGeometry(history);

        const tail = await message.evaluate((element) => {
          const body = element.querySelector(".markdown-body")!;
          const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
          let last: Text | undefined;

          while (walker.nextNode()) {
            if (walker.currentNode.textContent?.trim()) {
              last = walker.currentNode as Text;
            }
          }

          if (!last) throw new Error("The message has no final text");
          const end = last.data.trimEnd().length;
          const range = document.createRange();
          range.setStart(last, end - 1);
          range.setEnd(last, end);
          const text = range.getBoundingClientRect();
          const box = element.getBoundingClientRect();

          return {
            top: text.top,
            bottom: text.bottom,
            right: text.right,
            messageTop: box.top,
            messageBottom: box.bottom,
            messageRight: box.right,
          };
        });

        const caret = await caretBox(cdp);
        const center = (caret.top + caret.bottom) / 2;

        expect(
          center,
          `${name}: caret should overlap the final text line`,
        ).toBeGreaterThanOrEqual(tail.top);

        expect(
          center,
          `${name}: caret should overlap the final text line`,
        ).toBeLessThanOrEqual(tail.bottom);

        expect(caret.left).toBeGreaterThanOrEqual(tail.right);
        expect(caret.left - tail.right).toBeLessThanOrEqual(4);
        expect(caret.top).toBeGreaterThanOrEqual(tail.messageTop - 1);
        expect(caret.bottom).toBeLessThanOrEqual(tail.messageBottom + 1);
        expect(caret.right).toBeLessThanOrEqual(tail.messageRight + 1);
        cycle.refresh(9000, markdown);
        await expect(message).not.toHaveAttribute("aria-busy", "true");

        // Lists each field that moved, so a failure shows what changed.
        await expect
          .poll(async () => {
            const after = await conversationGeometry(history);

            return Object.fromEntries(
              Object.entries(after)
                .map(([key, value]) => {
                  const earlier = before[key as keyof typeof before];

                  return [key, { before: earlier, after: value }] as const;
                })
                .filter(
                  ([, field]) => Math.abs(field.after - field.before) > 1,
                ),
            );
          })
          .toEqual({});
      });
    }
  });
}
