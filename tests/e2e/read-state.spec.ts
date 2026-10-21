import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";

async function startTask(page: Page, message: string) {
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByRole("textbox", { name: "Task message" }).fill(message);
  await page.getByRole("button", { name: "Start task", exact: true }).click();
}

test("unread replies persist until read, and manual read marks survive reload", async ({
  consolePage: page,
}) => {
  const tasks = page.getByRole("complementary", { name: "Delegated tasks" });
  const history = page.getByRole("region", { name: "Chat history" });
  const row = (title: RegExp) => tasks.getByRole("button", { name: title });
  const background = row(/Finish in the background/);
  const open = row(/Keep this task open/);

  // A reply that arrives while another task is open stays unread.
  await startTask(page, "Finish in the background [fixture:wait ms=1500]");
  await startTask(page, "Keep this task open");
  await expect(history).toContainText("Fixture session turn: 1.");
  await expect(background).toContainText("Unread");
  await expect(open).not.toContainText("Unread");
  await page.reload();
  await expect(background).toContainText("Unread");
  await expect(page).toHaveTitle(/^\(1\)/);

  // Opening it shows where its unseen messages start, then reads it.
  await background.click();

  await expect(
    history.getByRole("separator", { name: "New messages" }),
  ).toBeVisible();

  await expect(background).not.toContainText("Unread");
  await expect(page).not.toHaveTitle(/^\(\d+\)/);

  // A manual mark holds while its task stays open.
  await page.getByRole("button", { name: "Task actions" }).click();

  await page
    .getByRole("menuitem", { name: "Mark unread", exact: true })
    .click();

  await expect(background).toContainText("Unread");
  await open.click({ button: "right" });

  await page
    .getByRole("menuitem", { name: "Mark unread", exact: true })
    .click();

  await expect(open).toContainText("Unread");

  // The service keeps the mark on the task that isn't open. The open task
  // shows its latest message after reload, which reads it.
  await page.reload();
  await expect(open).toContainText("Unread");
  await expect(background).not.toContainText("Unread");

  const markFrom = history
    .getByRole("button", { name: "Mark unread from here" })
    .first();

  await markFrom.click();
  await expect(background).toContainText("Unread");

  await expect(
    history.getByRole("separator", { name: "New messages" }),
  ).toBeVisible();

  // The New divider goes straight above the marked reply.
  expect(
    await history.evaluate((element) => {
      const rows = [...element.querySelectorAll("[data-chat-item]")];
      const divider = rows.findIndex((row) => row.role === "separator");

      return rows[divider + 1]?.textContent;
    }),
  ).toContain("Fixture task completed.");

  await page.getByRole("radio", { name: "Unread, 2", exact: true }).click();

  await page
    .getByRole("button", { name: "Mark all read", exact: true })
    .click();

  await expect(page).not.toHaveTitle(/^\(\d+\)/);
  await page.getByRole("radio", { name: /^All,/ }).click();
  await expect(background).not.toContainText("Unread");
  await expect(open).not.toContainText("Unread");
  await page.reload();
  await expect(open).not.toContainText("Unread");
  await expect(background).not.toContainText("Unread");
});
