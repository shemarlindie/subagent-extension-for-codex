import { expect, test } from "./fixtures";

test("settings reject invalid values, reset sections and confirm discarding edits", async ({
  consolePage: page,
}) => {
  await page.getByRole("button", { name: "Settings", exact: true }).click();

  const prefix = page.getByRole("textbox", {
    name: "Worktree branch prefix",
    exact: true,
  });

  const workspace = page.getByRole("combobox", {
    name: "Workspace",
    exact: true,
  });

  // Saving checks the branch prefix and keeps the invalid draft.
  await prefix.fill("bad prefix!");

  await page
    .getByRole("button", { name: "Save 1 change", exact: true })
    .click();

  await expect(prefix).toHaveAttribute("aria-invalid", "true");

  await expect(
    page.getByText(
      "Worktree branch prefix has characters a branch name can't use.",
    ),
  ).toBeVisible();

  // The console keeps the unsaved draft across reloads.
  await page.reload();
  await expect(prefix).toHaveValue("bad prefix!");
  await prefix.fill("browser/");
  await workspace.click();
  await page.getByRole("option", { name: "Isolated worktree" }).click();

  await page
    .getByRole("button", { name: "Save 2 changes", exact: true })
    .click();

  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();

  // A new task starts from the saved defaults.
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await page.getByRole("button", { name: "More ways to start a task" }).click();
  await page.getByRole("menuitem", { name: /Advanced task/ }).click();

  await expect(
    page
      .getByRole("dialog")
      .getByRole("combobox", { name: "Workspace", exact: true }),
  ).toHaveText("Isolated worktree");

  await page.keyboard.press("Escape");

  // Leaving with unsaved edits asks first. Keeping them stays on the page.
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await prefix.fill("draft/");
  await page.getByRole("button", { name: "Tasks", exact: true }).click();

  const leave = page
    .getByRole("alert")
    .filter({ hasText: "Discard unsaved changes?" });

  await leave
    .getByRole("button", { name: "Keep editing", exact: true })
    .click();

  await expect(prefix).toHaveValue("draft/");
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await leave.getByRole("button", { name: "Discard", exact: true }).click();

  await expect(
    page.getByRole("button", { name: "New task", exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(prefix).toHaveValue("browser/");

  // Reset restores the section's defaults, which saving keeps.
  await page
    .getByRole("button", { name: "Reset to defaults", exact: true })
    .click();

  await expect(prefix).toHaveValue("agent/");
  await expect(workspace).toHaveText("Current repository");

  await page
    .getByRole("button", { name: "Save 2 changes", exact: true })
    .click();

  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();

  await page.reload();
  await expect(prefix).toHaveValue("agent/");
  await expect(workspace).toHaveText("Current repository");
});

test("advanced task options set the task's model and permission policy", async ({
  consolePage: page,
}) => {
  await page.getByRole("button", { name: "More ways to start a task" }).click();
  await page.getByRole("menuitem", { name: /Advanced task/ }).click();
  const dialog = page.getByRole("dialog");

  await dialog
    .getByLabel("Description", { exact: true })
    .fill("Plan only [fixture:permission tool=Bash]");

  await dialog.getByRole("combobox", { name: "Model", exact: true }).click();
  await page.getByRole("option", { name: /Fixture Fast/ }).click();

  await dialog
    .getByRole("combobox", { name: "Permission mode", exact: true })
    .click();

  await page.getByRole("option", { name: /^Plan/ }).click();
  await dialog.getByRole("button", { name: "Start task", exact: true }).click();

  // Plan mode denies the tool without asking.
  const history = page.getByRole("region", { name: "Chat history" });
  await expect(history).toContainText("Fixture Bash request denied");
  await expect(page.getByRole("button", { name: "Deny" })).toHaveCount(0);
  await page.reload();
  const settings = page.getByRole("list", { name: "Task settings" });
  // Only Claude reports a permission mode for this list. The denial shows the fixture's.
  await expect(settings).toContainText("Fixture Fast");
});
