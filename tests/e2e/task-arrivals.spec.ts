import { scrollChatUp, send, startTask } from "./console-actions";
import { expect, test } from "./fixtures";

test.use({ reducedMotion: "no-preference" });

test("announce new tasks without moving the reader, then open one with View", async ({
  consolePage: page,
}) => {
  await page.setViewportSize({ width: 1280, height: 640 });
  await startTask(page, "Read this history [fixture:reply lines=40]");
  const history = page.getByRole("region", { name: "Chat history" });
  await expect(history).toContainText("Fixture reply line 40.");
  await scrollChatUp(page, 700);

  await expect(
    page.getByRole("button", { name: "Scroll to latest message", exact: true }),
  ).toBeVisible();

  const composer = page.getByRole("textbox", { name: "Message", exact: true });
  await composer.fill("Keep this unsent reply");
  await composer.focus();
  const position = await history.evaluate((element) => element.scrollTop);

  // Another console stands in for work started by the parent chat.
  const other = await page.context().newPage();
  await other.goto(page.url());
  await startTask(other, "Arriving task");

  await expect(
    other.getByRole("region", { name: "Chat history" }),
  ).toContainText("Fixture session turn: 1.");

  await page.bringToFront();

  const toast = page.getByRole("dialog", { name: "New task", exact: true });

  await expect(toast).toBeVisible();
  await expect(toast).toHaveAccessibleDescription("Arriving task");
  await expect(composer).toHaveValue("Keep this unsent reply");
  await expect(composer).toBeFocused();

  expect(
    Math.abs(
      (await history.evaluate((element) => element.scrollTop)) - position,
    ),
  ).toBeLessThanOrEqual(1);

  await page.keyboard.press("F6");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const firstView = toast.getByRole("button", { name: "View", exact: true });
  await expect(firstView).toBeFocused();

  // A newer arrival keeps keyboard focus on View.
  await startTask(other, "Latest arriving task");

  await expect(
    other.getByRole("region", { name: "Chat history" }),
  ).toContainText("Fixture session turn: 1.");

  await page.bringToFront();
  await expect(toast).toHaveAccessibleDescription("Latest arriving task");
  await expect(firstView).toBeFocused();
  await page.keyboard.press("Tab");

  await expect(
    toast.getByRole("button", { name: "Dismiss new task notification" }),
  ).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(toast).toHaveCount(0);
  await expect(composer).toBeFocused();

  await send(other, "Refresh dismissed arrival");

  await expect(
    other.getByRole("region", { name: "Chat history" }),
  ).toContainText("Fixture session turn: 2.");

  await page.bringToFront();
  await expect(toast).toHaveCount(0);

  // A later arrival can still be opened after dismissing an earlier one.
  const longTitle =
    "Review task synchronization for abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghij";

  await startTask(other, longTitle);

  await expect(
    other.getByRole("region", { name: "Chat history" }),
  ).toContainText("Fixture session turn: 1.");

  await other.close();
  await page.bringToFront();

  await expect(toast).toHaveAccessibleDescription(longTitle);

  // The overlay also fits a narrow console without shifting its content.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 360, height: 640 });
  await expect(toast).toBeVisible();

  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(360);

  await toast.hover();

  const view = toast.getByRole("button", { name: "View", exact: true });

  const close = toast.getByRole("button", {
    name: "Dismiss new task notification",
    exact: true,
  });

  for (const control of [view, close]) {
    await expect(control).toBeVisible();
    await expect(control).toBeInViewport({ ratio: 1 });
  }

  await view.click();

  await expect(
    page.getByRole("heading", {
      name: `Edit task title: ${longTitle}`,
      exact: true,
    }),
  ).toBeVisible();

  await expect(toast).toHaveCount(0);

  await page.setViewportSize({ width: 1280, height: 640 });

  await page
    .getByRole("complementary", { name: "Delegated tasks" })
    .getByRole("button", { name: /Read this history/ })
    .click();

  await expect(composer).toHaveValue("Keep this unsent reply");

  await expect
    .poll(async () =>
      Math.abs(
        (await history.evaluate((element) => element.scrollTop)) - position,
      ),
    )
    .toBeLessThanOrEqual(2);
});

test("a new task toast and an undo toast stack at the top without overlapping", async ({
  consolePage: page,
}) => {
  await page.setViewportSize({ width: 1280, height: 640 });
  await startTask(page, "Draft the release notes");

  const other = await page.context().newPage();
  await other.goto(page.url());
  await startTask(other, "Arriving task");

  await expect(
    other.getByRole("region", { name: "Chat history" }),
  ).toContainText("Fixture session turn: 1.");

  await other.close();
  await page.bringToFront();

  const arrival = page.getByRole("dialog", { name: "New task", exact: true });
  await expect(arrival).toBeVisible();

  // Renaming is quiet. Undoing it shows the undo toast below the arrival.
  await page
    .getByRole("button", { name: "Edit task title: Draft the release notes" })
    .click();

  const title = page.getByRole("textbox", { name: "Task title", exact: true });
  await title.fill("Write the release notes");
  await title.press("Enter");
  // Saving leaves the text field, so the shortcut undoes the rename.
  await expect(title).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");

  const undo = page.getByRole("dialog", { name: /^Undid: Renamed/ });
  await expect(undo).toBeVisible();

  for (const width of [1280, 360]) {
    await page.setViewportSize({ width, height: 640 });

    const [top, below] = await Promise.all(
      [arrival, undo].map(async (toast) => (await toast.boundingBox())!),
    );

    expect(below!.y).toBeGreaterThanOrEqual(top!.y + top!.height);
    await expect(undo).toBeInViewport({ ratio: 1 });
  }
});
