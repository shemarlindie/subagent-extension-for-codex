import assert from "node:assert/strict";
import { join } from "node:path";

import type { Locator } from "@playwright/test";

import { startTask } from "./console-actions";
import { createRepository, expect, test } from "./fixtures";

test("filter, search and rename tasks, keeping the choices across reload", async ({
  consolePage: page,
}) => {
  const tasks = page.getByRole("complementary", { name: "Delegated tasks" });
  const rows = tasks.getByRole("button", { name: /\[fixture:|flow|API/ });
  const row = (title: RegExp) => tasks.getByRole("button", { name: title });
  const filter = (name: RegExp) => page.getByRole("radio", { name });
  await startTask(page, "Review login flow");
  await startTask(page, "Fix flaky search [fixture:fail]");
  await startTask(page, "Document the API [fixture:question]");

  await expect(
    page.getByRole("button", { name: "Respond", exact: true }),
  ).toBeVisible();

  // The list opens on the first nonempty filter after Unread.
  await expect(filter(/^Needs attention, 1/)).toBeChecked();

  // Each status filter lists only its tasks, and the choice survives reload.
  await expect(rows).toHaveCount(1);
  await expect(row(/Document the API/)).toBeVisible();
  await filter(/^Failed, 1/).click();
  await expect(rows).toHaveCount(1);
  await expect(row(/Fix flaky search/)).toHaveAccessibleName(/Failed$/);
  await filter(/^Done, 1/).click();
  await expect(rows).toHaveCount(1);
  await page.reload();
  await expect(filter(/^Done, 1/)).toBeChecked();
  await expect(rows).toHaveCount(1);
  await expect(row(/Review login flow/)).toBeVisible();

  // Search narrows every filter, and Escape clears it.
  await filter(/^All, 3/).click();
  const search = page.getByRole("searchbox", { name: "Search tasks" });
  await search.fill("flaky");
  await expect(rows).toHaveCount(1);
  await expect(row(/Fix flaky search/)).toBeVisible();
  await search.press("Escape");
  await expect(search).toHaveValue("");
  await expect(rows).toHaveCount(3);

  // An inline rename updates the list and persists.
  await row(/Review login flow/).click();

  await page
    .getByRole("button", { name: "Edit task title: Review login flow" })
    .click();

  const title = page.getByRole("textbox", { name: "Task title", exact: true });
  await title.fill("Audit login flow");
  await title.press("Enter");
  await expect(row(/Audit login flow/)).toBeVisible();

  // Undo ignores key presses in the title field, so wait for it to close.
  await expect(
    page.getByRole("button", { name: "Edit task title: Audit login flow" }),
  ).toBeVisible();

  await page.keyboard.press("ControlOrMeta+z");
  await expect(row(/Review login flow/)).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(row(/Audit login flow/)).toBeVisible();
  await page.reload();

  await expect(
    page.getByRole("button", { name: "Edit task title: Audit login flow" }),
  ).toBeVisible();

  await search.fill("audit");
  await expect(rows).toHaveCount(1);
  await expect(row(/Audit login flow/)).toBeVisible();
});

test("group tasks by project, keeping collapsed groups across reload, and narrow to one project", async ({
  consolePage: page,
  consoleService,
}) => {
  const other = join(consoleService.directory, "other");
  await createRepository(other);

  const registration = await page.request.post(
    "/api/tools/app_register_project",
    {
      data: { repository: other },
      headers: {
        Origin: consoleService.origin,
        "X-Subagent-Extension-For-Codex": "1",
      },
    },
  );

  await expect(registration).toBeOK();

  const tasks = page.getByRole("complementary", { name: "Delegated tasks" });
  const row = (title: string) => tasks.getByRole("button", { name: title });
  const scope = page.getByRole("combobox", { name: "Project scope" });

  const chooseScope = async (name: string) => {
    await scope.click();
    await page.getByRole("option", { name }).click();
  };

  await startTask(page, "Review login flow");
  await chooseScope("other");
  await startTask(page, "Tidy the docs");
  await chooseScope("All projects");
  await page.getByRole("radio", { name: /^All, 2/ }).click();

  // Each project's tasks sit under a header with the project's task count.
  const header = tasks.getByRole("button", { name: /^other 1 task/ });
  await expect(row("Review login flow")).toBeVisible();
  await expect(row("Tidy the docs")).toBeVisible();

  // A collapsed group hides its rows and stays collapsed across reload.
  await header.click();
  await expect(row("Tidy the docs")).toBeHidden();
  await expect(row("Review login flow")).toBeVisible();
  await page.reload();
  await expect(header).toBeVisible();
  await expect(row("Tidy the docs")).toBeHidden();
  await header.click();
  await expect(row("Tidy the docs")).toBeVisible();

  // Show only this project selects the group's project.
  await tasks.getByRole("button", { name: "Actions for other" }).click();
  await page.getByRole("menuitem", { name: "Show only this project" }).click();
  await expect(scope).toContainText("other");
  await expect(row("Review login flow")).toBeHidden();
  await expect(row("Tidy the docs")).toBeVisible();
});

test("select tasks by row and undo bulk list actions as one step each", async ({
  consolePage: page,
}) => {
  const list = page.getByRole("complementary", { name: "Delegated tasks" });
  const status = list.getByRole("status");
  const listCount = list.locator(".list-count");
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  const first = list.getByRole("button", { name: /^Review login/ });
  const second = list.getByRole("button", { name: /^Review signup/ });
  const waiting = list.getByRole("button", { name: /^Document the API/ });

  const chooseAction = async (row: Locator, name: string) => {
    await row.click({ button: "right" });
    await page.getByRole("menuitem", { name, exact: true }).click();
  };

  const unread = list
    .getByRole("button", { name: /^Review (login|signup)/ })
    .and(list.locator("[data-unread]"));

  await page.getByRole("radio", { name: /^All, 0/ }).click();
  await startTask(page, "Review login");
  await expect(first).toContainText("Completed");
  await expect(first).not.toContainText("Unread");
  await startTask(page, "Review signup");
  await expect(second).toContainText("Completed");
  await expect(second).not.toContainText("Unread");
  await startTask(page, "Document the API [fixture:question]");
  await expect(waiting).toHaveAttribute("aria-current", "true");

  await first.click({ modifiers: ["Meta"] });
  await expect(first).toBeFocused();
  await expect(status).toHaveText("1 selected");

  await waiting.click({ modifiers: ["Shift"] });
  await expect(status).toHaveText("3 selected");
  await second.click({ modifiers: ["Shift"] });
  await expect(status).toHaveText("2 selected");
  await expect(waiting).toHaveAttribute("aria-pressed", "false");

  await first.click({ modifiers: ["Meta"] });
  await expect(first).toHaveAttribute("aria-pressed", "false");
  await expect(second).toHaveAttribute("aria-pressed", "true");
  // Deselecting the last task ends selection.
  await second.click({ modifiers: ["Meta"] });
  await expect(status).toBeHidden();
  await second.click({ modifiers: ["Meta"] });
  await page.keyboard.press("Escape");
  await expect(waiting).toHaveAttribute("aria-current", "true");

  // Start with Shift held at either endpoint, even when another task is open.
  for (const [from, to] of [
    [first, waiting],
    [waiting, first],
  ] as const) {
    await from.click({ modifiers: ["Shift"] });
    await expect(status).toHaveText("1 selected");
    await to.click({ modifiers: ["Shift"] });
    await expect(status).toHaveText("3 selected");
    // Clicking the list header clears the selection too.
    await list.locator(".list-label").click();
  }

  await waiting.click();
  await first.click({ modifiers: ["Shift"] });
  await expect(status).toHaveText("3 selected");
  // Clicking blank space below the rows clears the selection.
  const area = await list.locator("#task-list").boundingBox();
  assert.ok(area);
  await page.mouse.click(area.x + 20, area.y + area.height - 10);
  await expect(status).toBeHidden();

  await first.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Select task" }).click();
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await second.press("Space");
  await expect(second).toHaveAttribute("aria-pressed", "true");

  await expect(
    page.getByRole("button", { name: "Respond", exact: true }),
  ).toBeVisible();

  // Each read action and its undo leave the waiting task's inspector open.
  // A selected row's context menu acts on the whole selection.
  await chooseAction(second, "Mark unread (2)");
  await expect(unread).toHaveCount(2);
  // Rows can leave the list, so focus moves where Escape still works.
  await expect(listCount).toBeFocused();
  // Shift+F10 opens the menu from the keyboard, on the count or a row.
  await listCount.press("Shift+F10");

  await page
    .getByRole("menuitem", { name: "Mark read (2)", exact: true })
    .click();

  await expect(unread).toHaveCount(0);
  await undo.click();
  await expect(unread).toHaveCount(2);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(unread).toHaveCount(0);

  // Right-clicking a row outside the selection adds it first.
  await waiting.click({ button: "right" });

  await expect(
    page.getByRole("menuitem", { name: "Archive (2)" }),
  ).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(waiting).toHaveAttribute("aria-pressed", "true");
  await chooseAction(waiting, "Archive (2)");
  await expect(first).toBeHidden();
  await expect(second).toBeHidden();
  await expect(waiting).toHaveAttribute("aria-pressed", "true");
  await expect(status).toHaveText("1 selected · 1 skipped.");
  await undo.click();
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();

  await waiting.press("Escape");
  await expect(status).toBeHidden();
  await expect(waiting).toBeFocused();

  const release = Promise.withResolvers<void>();

  await page.route(
    "**/api/tools/app_set_tasks_archived",
    async (route) => {
      await release.promise;

      await route.fulfill({
        status: 500,
        json: { error: "Archive unavailable." },
      });
    },
    { times: 1 },
  );

  try {
    await first.click({ modifiers: ["Meta"] });
    await first.press("Shift+F10");
    await page.getByRole("menuitem", { name: "Archive (1)" }).click();
    await expect(status).toHaveText("Applying…");
    await expect(listCount).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(status).toBeHidden();
    await list.getByRole("searchbox", { name: "Search tasks" }).fill("signup");
  } finally {
    release.resolve();
  }

  const failure = page
    .getByRole("alert")
    .filter({ hasText: "Could not archive 1 task." });

  await expect(failure).toBeVisible();
  await page.getByRole("button", { name: "Dismiss action failure" }).click();
  await expect(failure).toBeHidden();
});
