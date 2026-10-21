// Console steps the browser flows share, driven through the visible UI.
import type { Page } from "@playwright/test";

/** Starts a task from the new-task composer. */
export async function startTask(page: Page, message: string) {
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByRole("textbox", { name: "Task message" }).fill(message);
  await page.getByRole("button", { name: "Start task", exact: true }).click();
}

/** Opens Advanced task with its description filled, ready for more options. */
export async function openAdvancedTask(page: Page, description: string) {
  await page.getByRole("button", { name: "More ways to start a task" }).click();
  await page.getByRole("menuitem", { name: /Advanced task/ }).click();
  await page.getByLabel("Description", { exact: true }).fill(description);
}

/** Sends a message from the open task's composer with Enter. */
export async function send(page: Page, message: string) {
  const composer = page.getByRole("textbox", { name: "Message", exact: true });
  await composer.fill(message);
  await composer.press("Enter");
}
