import type { Page } from "@playwright/test";

import { openAdvancedTask, startTask } from "./console-actions";
import { expect, test } from "./fixtures";

/** Whether the page scrolls sideways, which a narrow layout must avoid. */
const overflows = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );

test("composer settings wrap only when the hint and details need more space", async ({
  consolePage: page,
}) => {
  await startTask(page, "Check composer details");
  const history = page.getByRole("region", { name: "Chat history" });
  await expect(history).toContainText("Fixture session turn: 1.");
  const settings = page.getByRole("list", { name: "Task settings" });
  const hint = page.locator("#chat-composer-hint");

  const sharesLine = async () => {
    const hintBox = await hint.boundingBox();
    const settingsBox = await settings.boundingBox();

    return (
      !!hintBox && !!settingsBox && settingsBox.y < hintBox.y + hintBox.height
    );
  };

  await page.setViewportSize({ width: 620, height: 800 });
  await expect.poll(sharesLine).toBe(true);

  await page.setViewportSize({ width: 360, height: 800 });
  await expect.poll(sharesLine).toBe(false);
  expect(await overflows(page)).toBe(false);

  await page.setViewportSize({ width: 1280, height: 800 });
  const model = `custom-model-${"long-name-".repeat(15)}`;
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await openAdvancedTask(page, "Check long model details");
  const dialog = page.getByRole("dialog");

  await dialog
    .getByRole("combobox", { name: "Model", exact: true })
    .fill(model);

  await dialog.getByRole("button", { name: "Start task", exact: true }).click();
  await expect(history).toContainText("Fixture session turn: 1.");
  await expect(settings).toContainText(model);
  await page.setViewportSize({ width: 620, height: 800 });
  await expect.poll(sharesLine).toBe(false);
  expect(await overflows(page)).toBe(false);

  expect(
    await settings
      .getByRole("listitem")
      .nth(1)
      .evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(true);
});

test("a narrow console switches between the list and the task, without overflowing", async ({
  consolePage: page,
}) => {
  await page.setViewportSize({ width: 420, height: 800 });
  const tasks = page.getByRole("complementary", { name: "Delegated tasks" });

  // Header actions move into Panel actions.
  await expect(
    page.getByRole("button", { name: "Settings", exact: true }),
  ).toBeHidden();

  await page.getByRole("button", { name: "Panel actions" }).click();
  await page.getByRole("menuitem", { name: "New task", exact: true }).click();

  await page
    .getByRole("textbox", { name: "Task message" })
    .fill("Check the narrow layout");

  // Enter starts the task once the composer's reads finish.
  await expect(
    page.getByRole("button", { name: "Start task", exact: true }),
  ).toBeEnabled();

  await page.getByRole("textbox", { name: "Task message" }).press("Enter");
  const history = page.getByRole("region", { name: "Chat history" });
  await expect(history).toContainText("Fixture session turn: 1.");
  await expect(tasks).toBeHidden();
  expect(await overflows(page)).toBe(false);

  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(tasks).toBeVisible();
  await expect(history).toBeHidden();
  expect(await overflows(page)).toBe(false);

  await tasks.getByRole("button", { name: /Check the narrow layout/ }).click();

  await expect(history).toBeVisible();
  await expect(tasks).toBeHidden();
});

test("keyboard users can search, open a task and move between its tabs", async ({
  consolePage: page,
}) => {
  for (const title of ["Keyboard target", "Another task"]) {
    await page.getByRole("button", { name: "New task", exact: true }).click();
    await page.getByRole("textbox", { name: "Task message" }).fill(title);

    await expect(
      page.getByRole("button", { name: "Start task", exact: true }),
    ).toBeEnabled();

    await page.getByRole("textbox", { name: "Task message" }).press("Enter");

    await expect(
      page.getByRole("region", { name: "Chat history" }),
    ).toContainText("Fixture session turn: 1.");
  }

  // The slash key focuses search from outside a text field.
  const search = page.getByRole("searchbox", { name: "Search tasks" });
  await page.getByRole("region", { name: "Chat history" }).focus();
  await page.keyboard.press("/");
  await expect(search).toBeFocused();
  await page.keyboard.type("keyboard");
  const tasks = page.getByRole("complementary", { name: "Delegated tasks" });
  const target = tasks.getByRole("button", { name: /Keyboard target/ });

  await expect(tasks.getByRole("button", { name: /Another task/ })).toHaveCount(
    0,
  );

  // Tab reaches the remaining row, and Enter opens it.
  for (let stop = 0; stop < 10; stop++) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((row) => row === document.activeElement)) break;
  }

  await expect(target).toBeFocused();

  await page.keyboard.press("Enter");

  await expect(
    page.getByRole("heading", { name: /Keyboard target/ }),
  ).toBeVisible();

  // Arrow keys move between the task's tabs.
  const chat = page.getByRole("tab", { name: "Chat", exact: true });
  await chat.focus();
  await page.keyboard.press("ArrowRight");

  await expect(
    page.getByRole("tab", { name: "Activity", exact: true }),
  ).toBeFocused();

  await page.keyboard.press("Enter");

  await expect(
    page.getByRole("tab", { name: "Activity", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
});
