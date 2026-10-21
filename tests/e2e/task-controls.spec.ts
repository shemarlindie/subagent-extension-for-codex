import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";

async function startTask(page: Page, message: string) {
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByRole("textbox", { name: "Task message" }).fill(message);
  await page.getByRole("button", { name: "Start task", exact: true }).click();
}

async function advancedTask(page: Page, description: string) {
  await page.getByRole("button", { name: "More ways to start a task" }).click();
  await page.getByRole("menuitem", { name: /Advanced task/ }).click();
  await page.getByLabel("Description", { exact: true }).fill(description);
}

test("edit, reorder and remove queued messages, then stop and resume after reload", async ({
  consolePage: page,
}) => {
  const initial = "Hold the queue [fixture:question]";
  await startTask(page, initial);

  await expect(
    page.getByRole("button", { name: "Respond", exact: true }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: "Show composer", exact: true })
    .click();

  const composer = page.getByRole("textbox", { name: "Message", exact: true });
  const queue = page.getByRole("region", { name: "Messages not sent yet" });

  for (const message of [
    "First queued turn",
    "Second queued turn",
    "Remove this turn",
  ]) {
    await composer.fill(message);
    await composer.press("Enter");
    await expect(queue.getByText(message, { exact: true })).toBeVisible();
  }

  const row = (text: string) =>
    queue.getByRole("listitem").filter({ hasText: text });

  await row("First queued turn")
    .getByRole("button", { name: "Edit", exact: true })
    .click();

  await queue
    .getByRole("textbox", { name: "Queued message" })
    .fill("Edited first turn");

  await queue.getByRole("button", { name: "Save", exact: true }).click();

  await expect(
    queue.getByText("Edited first turn", { exact: true }),
  ).toBeVisible();

  const moving = row("Second queued turn").locator("[aria-keyshortcuts]");
  await expect(moving).toHaveAttribute("draggable", "true");
  await moving.press("Alt+ArrowUp");

  await expect(queue.getByRole("listitem")).toHaveText([
    "Second queued turn",
    "Edited first turn",
    "Remove this turn",
  ]);

  await row("Remove this turn")
    .getByRole("button", { name: "Remove", exact: true })
    .click();

  await expect(queue.getByRole("listitem")).toHaveText([
    "Second queued turn",
    "Edited first turn",
  ]);

  await page
    .getByRole("button", { name: "Stop the turn", exact: true })
    .click();

  await expect(queue).toContainText("Queue paused · 2");
  await page.reload();
  await expect(queue).toContainText("Queue paused · 2");

  await expect(queue.getByRole("listitem")).toHaveText([
    "Second queued turn",
    "Edited first turn",
  ]);

  await expect(
    page.getByRole("button", { name: "Respond", exact: true }),
  ).toHaveCount(0);

  await queue.getByRole("button", { name: "Resume", exact: true }).click();

  const history = page.getByRole("region", { name: "Chat history" });
  await expect(history).toContainText("Fixture session turn: 3.");
  await expect(queue).toHaveCount(0);

  // User messages enter durable history in delivery order, between worker replies.
  await expect(
    history.getByRole("article", { name: "You", exact: true }),
  ).toHaveText([initial, "Second queued turn", "Edited first turn"]);

  await expect(
    history
      .getByRole("article")
      .filter({ hasText: /Fixture session turn: [23]\./ }),
  ).toHaveText([/Fixture session turn: 2\./, /Fixture session turn: 3\./]);

  await page.reload();
  await expect(history).toContainText("Fixture session turn: 3.");
  await expect(history).not.toContainText("Remove this turn");
});

test("exhaust the runtime budget, apply a higher limit and continue after reload", async ({
  consolePage: page,
}) => {
  await advancedTask(
    page,
    "Exercise the runtime limit [fixture:wait ms=60000]",
  );

  await page
    .getByRole("switch", { name: "Runtime limit", exact: true })
    .check();

  await page
    .getByRole("spinbutton", { name: "Runtime limit (mins)", exact: true })
    .fill("0.01");

  await page.getByRole("button", { name: "Start task", exact: true }).click();

  const history = page.getByRole("region", { name: "Chat history" });
  await expect(history).toContainText("Runtime budget exhausted");

  await expect(history.getByRole("status")).toContainText(
    "Runtime limit reached",
  );

  await page.reload();
  await expect(history).toContainText("Runtime budget exhausted");

  const budget = page.getByRole("group", {
    name: "Raise runtime limit",
    exact: true,
  });

  await budget
    .getByRole("spinbutton", { name: "Runtime limit (minutes)" })
    .fill("1");

  await budget.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(budget).toHaveCount(0);
  await page.reload();

  await expect(
    page.getByRole("group", { name: "Raise runtime limit", exact: true }),
  ).toHaveCount(0);

  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Continue within the raised limit");

  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .press("Enter");

  await expect(history).toContainText("Fixture session turn: 2.");
  await expect(history).toContainText("Runtime budget exhausted");
});

test("a dependent task waits across reload and runs after its prerequisite completes", async ({
  consolePage: page,
}) => {
  const prerequisite = "Prepare dependency [fixture:question]";
  await startTask(page, prerequisite);

  await expect(
    page.getByRole("button", { name: "Respond", exact: true }),
  ).toBeVisible();

  await advancedTask(page, "Run after the prerequisite");

  await page
    .getByRole("combobox", { name: "Wait for tasks (optional)" })
    .click();

  await page.getByRole("option", { name: prerequisite, exact: true }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Start task", exact: true }).click();
  const history = page.getByRole("region", { name: "Chat history" });
  await expect(history).toContainText("Waiting on dependency");
  await expect(history).not.toContainText("Fixture session turn:");
  await page.reload();
  await expect(history).toContainText("Waiting on dependency");
  const tasks = page.getByRole("complementary", { name: "Delegated tasks" });

  await tasks.getByRole("button", { name: /Prepare dependency/ }).click();

  await page
    .getByRole("textbox", { name: "Which fixture path should be used? (1/1)" })
    .fill("Release the dependent task");

  await page.getByRole("button", { name: "Respond", exact: true }).click();
  await expect(history).toContainText("Fixture session turn: 1.");

  await tasks
    .getByRole("button", { name: /Run after the prerequisite/ })
    .click();

  await expect(history).toContainText("Fixture session turn: 1.");
  await expect(history).not.toContainText("Waiting on dependency");
});
