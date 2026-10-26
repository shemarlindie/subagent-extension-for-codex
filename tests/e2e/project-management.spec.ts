import { execFileSync } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Page } from "@playwright/test";

import { createRepository, expect, test } from "./fixtures";

async function createProjectWorktree(page: Page, title: string) {
  await page.getByRole("button", { name: "More ways to start a task" }).click();
  await page.getByRole("menuitem", { name: /Advanced task/ }).click();

  await page
    .getByLabel("Description", { exact: true })
    .fill(`${title} [fixture:change]`);

  await page.getByRole("combobox", { name: "Workspace", exact: true }).click();
  await page.getByRole("option", { name: /worktree/i }).click();
  await page.getByRole("button", { name: "Start task", exact: true }).click();

  await expect(
    page.getByRole("region", { name: "Chat history" }),
  ).toContainText("Fixture session turn: 1.");
}

test("rename a project and remove its approval while retaining task history and worktree", async ({
  consolePage: page,
  consoleService,
  repository,
}) => {
  const title = "Retain project work";
  await createProjectWorktree(page, title);
  const worktrees = join(consoleService.directory, "worktrees");
  const retainedWorktrees = await readdir(worktrees);
  expect(retainedWorktrees).toHaveLength(1);

  await page.getByRole("button", { name: "Manage", exact: true }).click();
  const project = page.getByRole("listitem").filter({ hasText: repository });

  await project
    .getByRole("button", { name: "Edit project name: repository" })
    .click();

  await project
    .getByRole("textbox", { name: "Project name", exact: true })
    .fill("Browser project");

  await project
    .getByRole("textbox", { name: "Project name", exact: true })
    .press("Enter");

  await expect(
    project.getByRole("button", { name: "Edit project name: Browser project" }),
  ).toBeVisible();

  await page.reload();

  await expect(
    project.getByRole("button", { name: "Edit project name: Browser project" }),
  ).toBeVisible();

  await project
    .getByRole("button", { name: "Remove Browser project", exact: true })
    .click();

  const confirmation = page.getByRole("dialog", {
    name: "Remove project?",
    exact: true,
  });

  await expect(
    confirmation.getByRole("switch", {
      name: "Also remove extension task data",
    }),
  ).not.toBeChecked();

  await confirmation
    .getByRole("button", { name: "Remove project", exact: true })
    .click();

  await expect(confirmation).toBeHidden();
  await expect(project).toHaveCount(0);
  await page.reload();
  await expect(project).toHaveCount(0);
  await page.getByRole("button", { name: "Tasks", exact: true }).click();

  await expect(
    page.getByRole("combobox", { name: "Project scope", exact: true }),
  ).toContainText("All projects");

  await page
    .getByRole("complementary", { name: "Delegated tasks" })
    .getByRole("button", { name: new RegExp(title) })
    .click();

  await expect(
    page.getByRole("region", { name: "Chat history" }),
  ).toContainText("Fixture session turn: 1.");

  await page.getByRole("tab", { name: "Changes" }).click();

  await expect(page.getByRole("tabpanel", { name: "Changes" })).toContainText(
    "Generated for task",
  );

  expect(await readdir(worktrees)).toEqual(retainedWorktrees);

  expect(
    execFileSync("git", ["-C", repository, "branch", "--list", "agent/*"], {
      encoding: "utf8",
    }).trim(),
  ).not.toBe("");
});

test("remove project task data and worktrees while preserving checkout files across reload", async ({
  consolePage: page,
  consoleService,
  repository,
}) => {
  const title = "Remove project work";
  const checkoutFile = join(repository, "local-notes.md");
  await writeFile(checkoutFile, "Keep my checkout notes\n");
  await createProjectWorktree(page, title);
  const worktrees = join(consoleService.directory, "worktrees");
  expect(await readdir(worktrees)).toHaveLength(1);

  await page.getByRole("button", { name: "Manage", exact: true }).click();
  const project = page.getByRole("listitem").filter({ hasText: repository });

  await project
    .getByRole("button", { name: "Remove repository", exact: true })
    .click();

  const confirmation = page.getByRole("dialog", {
    name: "Remove project?",
    exact: true,
  });

  await confirmation
    .getByRole("switch", { name: "Also remove extension task data" })
    .check();

  await confirmation
    .getByRole("button", { name: "Remove project and task data", exact: true })
    .click();

  await expect(confirmation).toBeHidden();
  await expect(project).toHaveCount(0);
  await page.reload();
  await expect(project).toHaveCount(0);
  await page.getByRole("button", { name: "Tasks", exact: true }).click();

  await expect(
    page.getByRole("combobox", { name: "Project scope", exact: true }),
  ).toContainText("All projects");

  await expect(
    page
      .getByRole("complementary", { name: "Delegated tasks" })
      .getByRole("button", { name: new RegExp(title) }),
  ).toHaveCount(0);

  expect(await readdir(worktrees)).toHaveLength(0);

  expect(
    execFileSync("git", ["-C", repository, "branch", "--list", "agent/*"], {
      encoding: "utf8",
    }).trim(),
  ).toBe("");

  expect(await readFile(checkoutFile, "utf8")).toBe("Keep my checkout notes\n");

  // Reapproval exposes any task records that were accidentally only hidden by scope.
  await page.getByRole("button", { name: "Manage", exact: true }).click();
  await page.getByRole("button", { name: "Add project", exact: true }).click();
  await page.getByLabel("Repository path").fill(repository);

  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add project", exact: true })
    .click();

  await expect(project).toHaveCount(1);
  await page.getByRole("button", { name: "Tasks", exact: true }).click();

  await page
    .getByRole("combobox", { name: "Project scope", exact: true })
    .click();

  await page.getByRole("option").filter({ hasText: repository }).click();

  await expect(
    page
      .getByRole("complementary", { name: "Delegated tasks" })
      .getByRole("button", { name: new RegExp(title) }),
  ).toHaveCount(0);
});

test("add a project from the new-task composer, keeping the list scope, and start a task there", async ({
  consolePage: page,
  consoleService,
}) => {
  const added = join(consoleService.directory, "added");
  await createRepository(added);

  const scope = page.getByRole("combobox", {
    name: "Project scope",
    exact: true,
  });

  await scope.click();
  await page.getByRole("option", { name: "All projects" }).click();
  await page.getByRole("button", { name: "New task", exact: true }).click();
  const chip = page.getByRole("combobox", { name: /^Project: / });
  await chip.click();
  await page.getByRole("option", { name: "Add project…" }).click();
  const dialog = page.getByRole("dialog", { name: "Add project" });
  await dialog.getByLabel("Repository path").fill(added);

  await dialog
    .getByRole("button", { name: "Add project", exact: true })
    .click();

  await expect(dialog).toBeHidden();
  await expect(chip).toHaveAccessibleName("Project: added");
  await expect(chip).toBeFocused();
  await expect(scope).toContainText("All projects");

  const message = page.getByRole("textbox", { name: "Task message" });
  await message.fill("Work in the added project");
  await message.press("Enter");

  // Opening the started task scopes the list to its project.
  await expect(scope).toContainText("added");

  await expect(
    page
      .getByRole("complementary", { name: "Delegated tasks" })
      .getByRole("button", { name: /Work in the added project/ }),
  ).toBeVisible();
});
