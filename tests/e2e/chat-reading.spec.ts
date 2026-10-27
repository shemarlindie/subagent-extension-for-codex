import type { Locator, Page } from "@playwright/test";

import type { Task } from "../../src/shared/tasks/model";
import { send, startTask } from "./console-actions";
import { expect, test } from "./fixtures";

/** How far Chat's scroll position is from its end, in pixels. */
const distanceFromEnd = (history: Locator) =>
  history.evaluate(
    (element) =>
      element.scrollHeight - element.scrollTop - element.clientHeight,
  );

/**
 * The paragraph nearest the middle of Chat, by its index, with its offset from
 * Chat's top. Streamed rows ease their height, so the middle can fall between
 * paragraphs.
 */
const middleParagraph = (history: Locator) =>
  history.evaluate((element) => {
    const frame = element.getBoundingClientRect();
    const paragraphs = [...element.querySelectorAll("p")];
    const middle = frame.top + frame.height / 2;

    const distance = (paragraph: Element) => {
      const box = paragraph.getBoundingClientRect();

      return Math.max(box.top - middle, middle - box.bottom, 0);
    };

    const index = paragraphs.reduce(
      (nearest, paragraph, i) =>
        nearest < 0 || distance(paragraph) < distance(paragraphs[nearest]!)
          ? i
          : nearest,
      -1,
    );

    if (index < 0) throw new Error("No paragraph in Chat");

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

/** Records opacity-only arrival fades, excluding height transitions that can retarget. */
const recordRowMotion = (page: Page) =>
  page.evaluate(() => {
    const endings: string[] = [];
    const animate = Element.prototype.animate;

    Element.prototype.animate = function (...args) {
      const animation = animate.apply(this, args);

      const frames =
        animation.effect instanceof KeyframeEffect
          ? animation.effect.getKeyframes()
          : [];

      if (
        this.hasAttribute("data-chat-item") &&
        frames.length &&
        frames.every(
          (frame) =>
            frame.opacity !== undefined &&
            frame.height === undefined &&
            frame.transform === undefined,
        )
      ) {
        for (const type of ["finish", "cancel"]) {
          animation.addEventListener(type, () => endings.push(type));
        }
      }

      return animation;
    };

    Object.assign(window, { rowMotion: endings });
  });

const rowMotion = (page: Page) =>
  page.evaluate(() => (window as unknown as { rowMotion: string[] }).rowMotion);

/**
 * Samples the first Chat row's offset each frame and records its largest
 * downward step. Every earlier message moves with it.
 */
const recordRowShift = (history: Locator) =>
  history.evaluate((element) => {
    const row = element.querySelector("[data-chat-item]")!;

    const offset = () =>
      row.getBoundingClientRect().top - element.getBoundingClientRect().top;

    const shift = { down: 0, done: false };
    let last = offset();

    const sample = () => {
      const next = offset();
      shift.down = Math.max(shift.down, next - last);
      last = next;
      if (!shift.done) requestAnimationFrame(sample);
    };

    requestAnimationFrame(sample);
    Object.assign(window, { rowShift: shift });
  });

/** Stops sampling and returns the largest downward step, in pixels. */
const rowShift = (page: Page) =>
  page.evaluate(() => {
    const { rowShift } = window as unknown as {
      rowShift: { down: number; done: boolean };
    };

    rowShift.done = true;

    return rowShift.down;
  });

test("activity labels reserve one line without moving the conversation", async ({
  consolePage: page,
}) => {
  await page.setViewportSize({ width: 760, height: 800 });
  await startTask(page, "Keep the conversation still");
  const history = page.getByRole("region", { name: "Chat history" });
  await expect(history).toContainText("Fixture session turn: 1.");

  // Vary only activity, keeping the real fixture conversation unchanged.
  let activity: string | undefined;

  await page.route("**/api/tools/list_tasks", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { result: Task[] };

    await route.fulfill({
      response,
      json: {
        ...body,
        result: body.result.map((task) => ({
          ...task,
          status: activity ? "running" : "completed",
          live_activity: activity
            ? { text: activity, state: "running" }
            : undefined,
        })),
      },
    });
  });

  await page.route("**/api/tools/app_get_activity", (route) =>
    route.fulfill({ json: { result: { events: [] } } }),
  );

  await page.reload();
  await expect(history).toContainText("Fixture session turn: 1.");
  await expect(history).not.toHaveAttribute("aria-busy", "true");
  await expect.poll(() => distanceFromEnd(history)).toBeLessThanOrEqual(2);
  const working = history.locator(".chat-working");
  await expect(working).toBeEmpty();

  const geometry = () =>
    history.evaluate((element) => {
      const status = element.querySelector(".chat-working")!;
      const lastMessage = element.querySelectorAll("article");

      return {
        statusHeight: status.getBoundingClientRect().height,
        messageTop:
          lastMessage[lastMessage.length - 1]!.getBoundingClientRect().top,
        scrollHeight: element.scrollHeight,
        scrollTop: element.scrollTop,
      };
    });

  const idle = await geometry();
  expect(idle.statusHeight).toBeGreaterThan(0);
  const longLabel = `Running npm run verify -- ${"packages/deeply-nested-project/".repeat(3)}`;

  for (const label of ["Thinking", longLabel, undefined]) {
    activity = label;

    await page
      .getByRole("button", { name: "Refresh tasks", exact: true })
      .click();

    if (label) await expect(working).toHaveText(label);
    else await expect(working).toBeEmpty();

    await expect
      .poll(async () => {
        const current = await geometry();

        return Math.max(
          ...Object.keys(idle).map((key) => {
            const field = key as keyof typeof idle;

            return Math.abs(current[field] - idle[field]);
          }),
        );
      })
      .toBeLessThanOrEqual(1);

    if (label === longLabel) {
      const text = working.locator("span[title]");
      await expect(text).toHaveAttribute("title", longLabel);

      expect(
        await text.evaluate(
          (element) => element.scrollWidth > element.clientWidth,
        ),
      ).toBe(true);
    }
  }
});

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

  // At the end, Chat follows a reply as it streams. It glides, so it can trail
  // the end until the reply settles. The slow pace keeps the reply streaming
  // long enough for slow CI runners to observe it.
  await recordRowMotion(page);
  await recordRowShift(history);
  await send(page, "Stream at the end [fixture:reply lines=30 pace=30]");
  await expect(streaming).toBeVisible();
  const partial = (await streaming.textContent())?.length ?? 0;

  await expect
    .poll(async () => (await streaming.textContent())?.length)
    .toBeGreaterThan(partial);

  await expect(latest).toBeHidden();
  await expect(history).toContainText("Fixture session turn: 2.");
  await expect(streaming).toHaveCount(0);
  await expect.poll(() => distanceFromEnd(history)).toBeLessThanOrEqual(2);
  await expect(latest).toBeHidden();

  // New messages fade in fully, even while the reply re-renders Chat.
  await expect.poll(() => rowMotion(page)).toContain("finish");
  expect(await rowMotion(page)).not.toContain("cancel");

  // Earlier messages only move up as new ones arrive, without jitter.
  expect(await rowShift(page)).toBeLessThanOrEqual(1);

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
