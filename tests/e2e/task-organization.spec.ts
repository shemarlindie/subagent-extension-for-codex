import { join } from "node:path";

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
  await expect(filter(/^Needs input, 1/)).toBeChecked();

  // Each status filter lists only its tasks, and the choice survives reload.
  await expect(rows).toHaveCount(1);
  await expect(row(/Document the API/)).toBeVisible();
  await filter(/^Failed, 1/).click();
  await expect(rows).toHaveCount(1);
  await expect(row(/Fix flaky search/)).toContainText("Failed");
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
        "X-Codex-Subagent-Extension": "1",
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
