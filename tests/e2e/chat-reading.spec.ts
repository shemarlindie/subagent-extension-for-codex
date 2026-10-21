import type { Locator } from "@playwright/test";

import { send } from "./console-actions";
import { expect, test } from "./fixtures";

/** How far Chat's scroll position is from its end, in pixels. */
const distanceFromEnd = (history: Locator) =>
  history.evaluate(
    (element) =>
      element.scrollHeight - element.scrollTop - element.clientHeight,
  );

/** The paragraph at the middle of Chat, by its index, with its offset from Chat's top. */
const middleParagraph = (history: Locator) =>
  history.evaluate((element) => {
    const frame = element.getBoundingClientRect();
    const paragraphs = [...element.querySelectorAll("p")];
    const middle = frame.top + frame.height / 2;

    const index = paragraphs.findIndex((paragraph) => {
      const box = paragraph.getBoundingClientRect();

      return box.top <= middle && box.bottom >= middle;
    });

    if (index < 0) throw new Error("No paragraph at Chat's middle");

    return {
      index,
      offset: paragraphs[index]!.getBoundingClientRect().top - frame.top,
    };
  });

/** A paragraph's current offset from Chat's top. */
const paragraphOffset = (history: Locator, index: number) =>
  history.evaluate((element, index) => {
    const paragraph = element.querySelectorAll("p")[index];
    if (!paragraph) throw new Error("The anchor paragraph is gone");

    return (
      paragraph.getBoundingClientRect().top -
      element.getBoundingClientRect().top
    );
  }, index);

test("streamed replies follow the end, hold a reading position in history and return to latest", async ({
  consolePage: page,
}) => {
  await page.setViewportSize({ width: 1280, height: 640 });
  await page.getByRole("button", { name: "New task", exact: true }).click();

  await page
    .getByRole("textbox", { name: "Task message" })
    .fill("Fill the chat [fixture:reply lines=30]");

  await page.getByRole("button", { name: "Start task", exact: true }).click();
  const history = page.getByRole("region", { name: "Chat history" });
  await expect(history).toContainText("Fixture reply line 30.");
  const streaming = history.locator("[aria-busy=true]");

  const latest = page.getByRole("button", {
    name: "Scroll to latest message",
    exact: true,
  });

  // At the end, Chat follows a reply as it streams. The slow pace keeps the
  // reply streaming long enough for slow CI runners to observe it.
  await send(page, "Stream at the end [fixture:reply lines=30 pace=30]");
  await expect(streaming).toBeVisible();
  const partial = (await streaming.textContent())?.length ?? 0;

  await expect
    .poll(async () => (await streaming.textContent())?.length)
    .toBeGreaterThan(partial);

  expect(await distanceFromEnd(history)).toBeLessThanOrEqual(2);
  await expect(history).toContainText("Fixture session turn: 2.");
  await expect(streaming).toHaveCount(0);
  await expect.poll(() => distanceFromEnd(history)).toBeLessThanOrEqual(2);
  await expect(latest).toBeHidden();

  // In history, the paragraph being read stays put while the reply grows.
  await send(page, "Stream while reading [fixture:reply lines=30 pace=30]");
  await expect(streaming).toBeVisible();
  await history.hover();
  await page.mouse.wheel(0, -900);
  await expect(latest).toBeVisible();
  const anchor = await middleParagraph(history);

  const moved = async () =>
    Math.abs((await paragraphOffset(history, anchor.index)) - anchor.offset);

  await expect(history).toContainText("Fixture session turn: 3.");
  await expect(streaming).toHaveCount(0);
  expect(await moved()).toBeLessThanOrEqual(1);
  expect(await distanceFromEnd(history)).toBeGreaterThan(300);

  // The reply arrived out of view, so the task is unread until the reader returns.
  const unread = page.getByRole("button", {
    name: "Scroll to unread messages",
    exact: true,
  });

  const row = page
    .getByRole("complementary", { name: "Delegated tasks" })
    .getByRole("button", { name: /Fill the chat/ });

  await expect(unread).toBeVisible();
  await expect(row).toContainText("Unread");

  // Chat restores the reading position when its tab returns.
  await page.getByRole("tab", { name: "Activity" }).click();
  await expect(history).toHaveCount(0);
  await page.getByRole("tab", { name: "Chat" }).click();
  await expect(history).toContainText("Fixture session turn: 3.");
  await expect(unread).toBeVisible();
  await expect.poll(moved).toBeLessThanOrEqual(2);

  await unread.click();
  await expect.poll(() => distanceFromEnd(history)).toBeLessThanOrEqual(2);
  await expect(unread).toBeHidden();
  await expect(latest).toBeHidden();
  await expect(row).not.toContainText("Unread");
});
