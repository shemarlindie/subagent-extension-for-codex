// Console steps the browser flows share, driven through the visible UI.
import { expect, type Page } from "@playwright/test";

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

/**
 * Scrolls Chat up with the mouse wheel and waits for the scroll to settle.
 * Chat shows its scroll button on the wheel input, and a slow runner can apply
 * the scroll later, so only samples an interval apart that agree count.
 */
export async function scrollChatUp(page: Page, distance: number) {
  const history = page.getByRole("region", { name: "Chat history" });
  let last: number | undefined;

  await history.hover();
  await page.mouse.wheel(0, -distance);

  await expect
    .poll(
      async () => {
        const top = await history.evaluate((element) => element.scrollTop);
        const settled = top === last;

        last = top;

        return settled;
      },
      { intervals: [100] },
    )
    .toBe(true);
}

/** Opens the Projects page from the project dropdown. */
export async function openManageProjects(page: Page) {
  await page.getByRole("combobox", { name: "Project scope" }).click();
  await page.getByRole("option", { name: "Manage projects…" }).click();
}
