import { openAdvancedTask, send } from "./console-actions";
import { expect, test } from "./fixtures";

test("review several changed files across scopes, viewed marks and previews", async ({
  consolePage: page,
}) => {
  await openAdvancedTask(page, "Write the first file [fixture:change]");

  await page.getByRole("combobox", { name: "Workspace", exact: true }).click();
  await page.getByRole("option", { name: /worktree/i }).click();
  await page.getByRole("button", { name: "Start task", exact: true }).click();
  const history = page.getByRole("region", { name: "Chat history" });
  await expect(history).toContainText("Fixture session turn: 1.");
  await send(page, "Write the second file [fixture:change]");
  await expect(history).toContainText("Fixture session turn: 2.");
  await page.getByRole("tab", { name: "Changes" }).click();
  const changes = page.getByRole("tabpanel", { name: "Changes" });
  const first = changes.getByText(/^fixture-scenario-.*-turn-1\.md$/);
  const second = changes.getByText(/^fixture-scenario-.*-turn-2\.md$/);
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  await expect(changes).toContainText("0 of 2 viewed");

  // This turn shows only the latest turn's edits.
  const scope = changes.getByRole("group", { name: "Changes to show" });
  await scope.getByRole("button", { name: "This turn", exact: true }).click();
  await expect(second).toBeVisible();
  await expect(first).toHaveCount(0);
  await scope.getByRole("button", { name: "Whole task", exact: true }).click();
  await expect(first).toBeVisible();

  // Viewed collapses a file, and Preview all starts at the next unviewed one.
  await changes
    .getByRole("checkbox", { name: /^Viewed .*turn-1\.md$/ })
    .check();

  await expect(changes).toContainText("1 of 2 viewed");

  await changes
    .getByRole("button", { name: "Preview all changes", exact: true })
    .click();

  const preview = page.getByRole("dialog");
  await expect(preview).toContainText(/turn-2\.md/);
  await expect(preview).toContainText("turn 2.");

  // Wrap lines applies to the preview and stays on for the next file.
  await preview
    .getByRole("button", { name: "File preview options", exact: true })
    .click();

  await page.getByRole("menuitemcheckbox", { name: "Wrap lines" }).click();
  await expect(preview.locator("[data-wrap-lines=true]")).not.toHaveCount(0);

  await preview
    .getByRole("button", { name: "Previous file", exact: true })
    .click();

  await expect(preview).toContainText("turn 1.");
  await expect(preview.locator("[data-wrap-lines=true]")).not.toHaveCount(0);
  await preview.getByRole("button", { name: "Close", exact: true }).click();
  await expect(changes).toContainText("1 of 2 viewed");
});
