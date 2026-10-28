import type { Page } from "@playwright/test";

import { startTask } from "./console-actions";
import { expect, test } from "./fixtures";

async function openDeleteTask(page: Page) {
  await page.getByRole("button", { name: "Task actions" }).click();

  await page
    .getByRole("menuitem", { name: "Delete task", exact: true })
    .click();

  return page.getByRole("dialog", { name: "Delete task?", exact: true });
}

const tasks = (page: Page) =>
  page.getByRole("complementary", { name: "Delegated tasks" });

test("delete a running task together with its agent session", async ({
  consolePage: page,
}) => {
  await startTask(page, "Delete while running [fixture:wait ms=60000]");
  const history = page.getByRole("region", { name: "Chat history" });
  await expect(history).toContainText("Fixture worker running turn 1");
  const confirmation = await openDeleteTask(page);
  await expect(confirmation).toContainText("Stop and delete");

  await confirmation
    .getByRole("switch", { name: "Also delete the agent task" })
    .check();

  await confirmation
    .getByRole("button", { name: "Delete task", exact: true })
    .click();

  await expect(confirmation).toHaveCount(0);
  const row = tasks(page).getByRole("button", { name: /Delete while running/ });
  await expect(row).toHaveCount(0);
  await page.reload();
  await expect(row).toHaveCount(0);
});

test("bulk delete a project's archived tasks", async ({
  consolePage: page,
  repository,
}) => {
  for (const title of ["First archived task", "Second archived task"]) {
    await startTask(page, title);

    await expect(
      page.getByRole("region", { name: "Chat history" }),
    ).toContainText("Fixture session turn: 1.");

    await page.getByRole("button", { name: "Task actions" }).click();
    await page.getByRole("menuitem", { name: "Archive", exact: true }).click();
  }

  await page.getByRole("button", { name: "Manage", exact: true }).click();
  const project = page.getByRole("listitem").filter({ hasText: repository });
  await project.getByRole("button", { name: /View archived tasks/ }).click();
  const archived = page.getByRole("list", { name: "Archived tasks" });
  await expect(archived.getByRole("listitem")).toHaveCount(2);

  // With nothing selected, the actions cover every archived task.
  await page.getByRole("button", { name: "Delete all", exact: true }).click();
  const confirm = page.getByRole("group", { name: "Confirm deletion" });

  await confirm
    .getByRole("switch", { name: "Also delete the agent tasks" })
    .check();

  await confirm.getByRole("button", { name: /^Delete/ }).click();

  await expect(
    page.getByText("No archived tasks in this project.", { exact: true }),
  ).toBeVisible();

  await page.reload();
  await project.getByRole("button", { name: /View archived tasks/ }).click();

  await expect(
    page.getByText("No archived tasks in this project.", { exact: true }),
  ).toBeVisible();
});

test.describe("when the agent session cannot be deleted", () => {
  test.use({ fixtureProvider: { deleteSessionError: true } });

  test("the task stays for retry and can still be deleted locally", async ({
    consolePage: page,
  }) => {
    await startTask(page, "Keep after a failed session deletion");

    await expect(
      page.getByRole("region", { name: "Chat history" }),
    ).toContainText("Fixture session turn: 1.");

    const confirmation = await openDeleteTask(page);

    const agentTask = confirmation.getByRole("switch", {
      name: "Also delete the agent task",
    });

    await agentTask.check();

    await confirmation
      .getByRole("button", { name: "Delete task", exact: true })
      .click();

    await expect(confirmation.getByRole("alert")).toContainText(
      "session deletion failed",
    );

    await expect(agentTask).toBeChecked();

    await expect(
      confirmation.getByRole("button", { name: "Delete task", exact: true }),
    ).toBeEnabled();

    // The local task stays, so deletion can be retried.
    await confirmation
      .getByRole("button", { name: "Cancel", exact: true })
      .click();

    const row = tasks(page).getByRole("button", {
      name: /Keep after a failed session deletion/,
    });

    await expect(row).toBeVisible();
    await page.reload();
    await expect(row).toBeVisible();

    // Without the agent session, deletion succeeds.
    await openDeleteTask(page);
    await expect(agentTask).not.toBeChecked();

    await confirmation
      .getByRole("button", { name: "Delete task", exact: true })
      .click();

    await expect(confirmation).toHaveCount(0);
    await expect(row).toHaveCount(0);
  });
});
