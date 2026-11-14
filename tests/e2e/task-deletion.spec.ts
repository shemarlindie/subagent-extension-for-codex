import { mkdir, readdir, symlink } from "node:fs/promises";
import { join } from "node:path";

import type { Page } from "@playwright/test";

import {
  openAdvancedTask,
  openManageProjects,
  startTask,
} from "./console-actions";
import { expect, requiredAttribute, test } from "./fixtures";

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
  consoleService,
  repository,
}) => {
  const linkedRoot = join(consoleService.directory, "worktrees");
  const actualRoot = join(consoleService.directory, "actual-worktrees");
  await mkdir(actualRoot);
  await symlink(actualRoot, linkedRoot, "dir");
  await openAdvancedTask(page, "Delete while running [fixture:wait ms=60000]");
  await page.getByRole("combobox", { name: "Workspace", exact: true }).click();
  await page.getByRole("option", { name: /worktree/i }).click();
  await page.getByRole("button", { name: "Start task", exact: true }).click();
  const history = page.getByRole("region", { name: "Chat history" });
  await expect(history).toContainText("Fixture worker running turn 1");
  const row = tasks(page).getByRole("button", { name: /Delete while running/ });
  const taskId = await requiredAttribute(row, "data-task");
  // The only worktree is the task's, named from its title.
  const [name] = await readdir(actualRoot);
  if (!name) throw new Error("The task has no worktree.");
  const worktree = join(actualRoot, name);
  const confirmation = await openDeleteTask(page);

  const details = confirmation.getByRole("region", {
    name: "Removal details",
  });

  await expect(details).toContainText(taskId);

  await expect(details).toContainText(
    "Worktree folder and all contents, including uncommitted files:",
  );

  await expect(details).toContainText(worktree);
  await expect(details).toContainText(`agent/${name}`);
  await expect(details).toContainText(repository);

  await expect(
    details.getByRole("list", { name: "Will remain" }),
  ).toContainText("Provider session");

  await expect(confirmation).toContainText("Running work will stop first.");

  const linkInfo = details.getByRole("button", {
    name: `Symbolic links for ${worktree}`,
    exact: true,
  });

  await linkInfo.focus();
  await linkInfo.press("Enter");

  const linkNote = page.getByRole("dialog", {
    name: `Symbolic links for ${worktree}`,
    exact: true,
  });

  await expect(linkNote).toContainText(`Symbolic link${linkedRoot}`);
  await expect(linkNote).toContainText(`Resolved target${actualRoot}`);
  await linkInfo.press("Escape");
  await expect(linkNote).toHaveCount(0);

  const previewRelease = Promise.withResolvers<void>();
  const previewResumed = Promise.withResolvers<void>();
  const previewRoute = "**/api/tools/app_preview_task_deletion";
  let previewHeld = false;

  const resources = details.getByRole("list", {
    name: "Selected task resources",
  });

  const taskNode = await details
    .getByText(taskId, { exact: true })
    .elementHandle();

  const beforeToggle = await resources.boundingBox();

  await page.route(
    previewRoute,
    async (route) => {
      previewHeld = true;

      try {
        await previewRelease.promise;
        await route.continue();
      } finally {
        previewResumed.resolve();
      }
    },
    { times: 1 },
  );

  try {
    await confirmation
      .getByRole("switch", { name: "Also delete the agent task" })
      .check();

    await expect.poll(() => previewHeld).toBe(true);

    await expect(
      confirmation.getByRole("button", { name: "Delete task", exact: true }),
    ).toBeDisabled();

    expect(await taskNode?.evaluate((node) => node.isConnected)).toBe(true);
    expect(await resources.boundingBox()).toEqual(beforeToggle);
  } finally {
    previewRelease.resolve();
    if (previewHeld) await previewResumed.promise;
    await page.unroute(previewRoute);
  }

  await expect(details).toContainText(
    `Session transcript: fixture:${join(linkedRoot, name)}`,
  );

  await expect(
    details.getByRole("list", { name: "Will remain" }),
  ).not.toContainText("Provider session");

  const release = Promise.withResolvers<void>();
  const resumed = Promise.withResolvers<void>();
  const deleteRoute = "**/api/tools/app_delete_tasks";
  let requestHeld = false;

  await page.route(
    deleteRoute,
    async (route) => {
      requestHeld = true;

      try {
        await release.promise;
        await route.continue();
      } finally {
        resumed.resolve();
      }
    },
    { times: 1 },
  );

  try {
    await confirmation
      .getByRole("button", { name: "Delete task", exact: true })
      .click();

    await expect.poll(() => requestHeld).toBe(true);

    await expect(
      confirmation.getByRole("switch", { name: "Also delete the agent task" }),
    ).toBeDisabled();

    await expect(
      confirmation.getByRole("button", { name: "Refresh removal list" }),
    ).toBeDisabled();
  } finally {
    release.resolve();
    if (requestHeld) await resumed.promise;
    await page.unroute(deleteRoute);
  }

  await expect(confirmation).toHaveCount(0);
  await expect(row).toHaveCount(0);
  await page.reload();
  await expect(row).toHaveCount(0);
});

test.describe("when the session location cannot be verified", () => {
  test.use({ fixtureProvider: { sessionDeletionUnavailable: true } });

  test("unverified sessions stay while the local task can still be deleted", async ({
    consolePage: page,
    consoleService,
  }) => {
    await startTask(page, "Delete local record with an unverified session");

    await expect(
      page.getByRole("region", { name: "Chat history" }),
    ).toContainText("Fixture session turn: 1.");

    const row = tasks(page).getByRole("button", {
      name: /Delete local record with an unverified session/,
    });

    const taskId = await row.getAttribute("data-task");
    const confirmation = await openDeleteTask(page);

    const agentTask = confirmation.getByRole("switch", {
      name: "Also delete the agent task",
    });

    await expect(agentTask).toBeDisabled();
    await expect(agentTask).not.toBeChecked();

    await expect(confirmation).toContainText(
      "The session location could not be verified.",
    );

    const details = confirmation.getByRole("region", {
      name: "Removal details",
    });

    await expect(
      details.getByRole("list", { name: "Will remain" }),
    ).toContainText("Provider session");

    const headers = {
      Origin: consoleService.origin,
      "X-Subagent-Extension-For-Codex": "1",
    };

    const remove = confirmation.getByRole("button", {
      name: "Delete task",
      exact: true,
    });

    await expect(remove).toBeEnabled();
    const title = "Renamed after removal review";

    const renamed = await page.request.post("/api/tools/app_rename_task", {
      data: { task_id: taskId, title },
      headers,
    });

    await expect(renamed).toBeOK();
    await remove.click();

    await expect(confirmation.getByRole("alert")).toContainText(
      "Deletion details changed",
    );

    await confirmation
      .getByRole("button", { name: "Refresh removal list" })
      .click();

    await expect(details).toContainText(title);
    await remove.click();

    await expect(confirmation).toHaveCount(0);

    await expect(
      tasks(page).getByRole("button", { name: new RegExp(title) }),
    ).toHaveCount(0);
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

      await page
        .getByRole("menuitem", { name: "Archive", exact: true })
        .click();
    }

    await openManageProjects(page);
    const project = page.getByRole("listitem").filter({ hasText: repository });
    await project.getByRole("button", { name: /View archived tasks/ }).click();
    const archived = page.getByRole("list", { name: "Archived tasks" });
    await expect(archived.getByRole("listitem")).toHaveCount(2);

    // With nothing selected, the actions cover every archived task.
    await page.getByRole("button", { name: "Delete all", exact: true }).click();
    const confirm = page.getByRole("group", { name: "Confirm deletion" });

    await expect(
      confirm.getByRole("switch", { name: "Also delete the agent tasks" }),
    ).toBeDisabled();

    await expect(confirm).toContainText(
      "The session location could not be verified.",
    );

    const details = confirm.getByRole("region", {
      name: "Removal details",
    });

    await expect(details).toContainText("First archived task");
    await expect(details).toContainText("Second archived task");

    await expect(
      details.getByRole("list", { name: "Will remain" }),
    ).toHaveCount(0);

    for (const title of ["First archived task", "Second archived task"]) {
      const target = details.getByRole("button", { name: title, exact: true });
      await expect(target).toHaveAttribute("aria-expanded", "false");
      await target.click();
      await expect(target).toHaveAttribute("aria-expanded", "true");
    }

    await expect(details).toContainText(`Project files: ${repository}`);

    await expect(
      details.getByText("Provider session", { exact: true }),
    ).toHaveCount(2);

    await confirm.getByRole("button", { name: /^Delete/ }).click();

    await expect(
      page.getByText(
        "Tasks you archive in any chat in this project appear here.",
        { exact: true },
      ),
    ).toBeVisible();

    await page.reload();
    await project.getByRole("button", { name: /View archived tasks/ }).click();

    await expect(
      page.getByText(
        "Tasks you archive in any chat in this project appear here.",
        { exact: true },
      ),
    ).toBeVisible();
  });
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
