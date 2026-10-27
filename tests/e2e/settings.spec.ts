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

test("settings copy as JSON and import from pasted text", async ({
  consolePage: page,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

  await page.getByRole("button", { name: "Settings", exact: true }).click();

  const prefix = page.locator("#setting-task-worktree_branch_prefix");

  const taskTab = page.getByRole("tab", { name: /^Task defaults/ });

  const transferTab = page.getByRole("tab", {
    name: "Import and export",
    exact: true,
  });

  await expect(prefix).toHaveValue("agent/");

  const copyButton = page.getByRole("button", {
    name: "Copy JSON",
    exact: true,
  });

  const saveFileButton = page.getByRole("button", {
    name: "Export file",
    exact: true,
  });

  const paste = page.getByRole("textbox", {
    name: "Paste copied settings",
    exact: true,
  });

  const importButton = page.getByRole("button", {
    name: "Import settings",
    exact: true,
  });

  await expect(copyButton).not.toBeVisible();
  await expect(saveFileButton).not.toBeVisible();

  // Transfer cannot drop an unsaved draft or copy older saved values.
  await prefix.fill("draft/");
  await transferTab.click();
  await paste.fill("{}");
  await expect(copyButton).toBeDisabled();
  await expect(saveFileButton).toBeDisabled();
  await expect(importButton).toBeDisabled();
  await taskTab.click();
  await expect(copyButton).not.toBeVisible();
  await prefix.fill("agent/");
  await transferTab.click();
  await expect(paste).toHaveValue("{}");
  await expect(copyButton).toBeEnabled();
  await expect(saveFileButton).toBeEnabled();
  await expect(importButton).toBeEnabled();

  // Copy writes the saved defaults as a versioned export.
  await copyButton.click();

  await expect(
    page.getByRole("status").filter({ hasText: "Copied" }),
  ).toBeVisible();

  const copied = JSON.parse(
    await page.evaluate(() => navigator.clipboard.readText()),
  ) as {
    format: number;
    settings: Record<string, unknown> & {
      task: Record<string, unknown>;
    };
  };

  expect(copied.format).toBe(2);
  expect(copied.settings.task.worktree_branch_prefix).toBe("agent/");

  // Text that isn't an export changes nothing and says why.
  await paste.fill("{");
  await importButton.click();
  await expect(page.getByRole("alert")).toContainText("aren't valid JSON");
  await expect(prefix).toHaveValue("agent/");

  // Import saves what this version knows and lists what it skipped.
  copied.settings.task.worktree_branch_prefix = "moved/";
  copied.settings.later_setting = true;

  await paste.fill(JSON.stringify(copied));
  await importButton.click();

  await expect(
    page.getByRole("status").filter({ hasText: "Skipped: later_setting" }),
  ).toBeVisible();

  await taskTab.click();
  await expect(prefix).toHaveValue("moved/");
  await transferTab.click();

  // Hosts can block both clipboard APIs. The export stays available by hand.
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: () => Promise.reject(new Error("Clipboard blocked")),
    });

    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: () => false,
    });
  });

  await copyButton.click();

  const manualCopy = page.getByRole("textbox", {
    name: "Couldn't copy automatically. Select and copy these settings.",
    exact: true,
  });

  await expect(manualCopy).toBeVisible();

  expect(
    JSON.parse(await manualCopy.inputValue()).settings.task
      .worktree_branch_prefix,
  ).toBe("moved/");

  await manualCopy.focus();

  expect(
    await manualCopy.evaluate(
      (field: HTMLTextAreaElement) =>
        field.selectionStart === 0 && field.selectionEnd === field.value.length,
    ),
  ).toBe(true);

  await page.reload();
  await taskTab.click();
  await expect(prefix).toHaveValue("moved/");
});

test("pending imports protect settings edits and failures restore editing", async ({
  consolePage: page,
}) => {
  const first = Promise.withResolvers<void>(),
    retry = Promise.withResolvers<void>();

  let imports = 0;

  await page.route("**/api/tools/app_import_settings", async (route) => {
    imports++;

    if (imports === 1) {
      await first.promise;

      await route.fulfill({
        status: 400,
        json: { error: "Import temporarily unavailable." },
      });
    } else {
      await retry.promise;
      await route.continue();
    }
  });

  await page.getByRole("button", { name: "Settings", exact: true }).click();

  const prefix = page.locator("#setting-task-worktree_branch_prefix");

  const workspace = page.locator("#setting-task-workspace_strategy");

  const taskTab = page.getByRole("tab", { name: /^Task defaults/ });

  const transferTab = page.getByRole("tab", {
    name: "Import and export",
    exact: true,
  });

  const paste = page.getByRole("textbox", {
    name: "Paste copied settings",
    exact: true,
  });

  const importButton = page.getByRole("button", {
    name: "Import settings",
    exact: true,
  });

  const document = JSON.stringify({
    format: 2,
    settings: { task: { worktree_branch_prefix: "imported/" } },
  });

  await expect(prefix).toHaveValue("agent/");
  await transferTab.click();
  await paste.fill(document);

  try {
    await importButton.click();
    await expect(importButton).toBeDisabled();
    await expect(prefix).toBeDisabled();
    await expect(workspace).toBeDisabled();
    await expect(paste).toHaveValue(document);
    first.resolve();

    await expect(page.getByRole("alert")).toContainText(
      "Import temporarily unavailable.",
    );

    await expect(paste).toHaveValue(document);
    await taskTab.click();
    await expect(prefix).toBeEnabled();
    await expect(workspace).toBeEnabled();
    await expect(prefix).toHaveValue("agent/");

    await transferTab.click();
    await importButton.click();
    await expect(prefix).toBeDisabled();
    retry.resolve();

    await expect(paste).toHaveValue("");
    await taskTab.click();
    await expect(prefix).toHaveValue("imported/");
    await expect(prefix).toBeEnabled();
    await page.reload();
    await expect(prefix).toHaveValue("imported/");
  } finally {
    first.resolve();
    retry.resolve();
  }
});

test("saving settings reports failures and the service computer's full path", async ({
  consolePage: page,
}) => {
  const pending = Promise.withResolvers<void>();
  let saves = 0;
  const path = String.raw`C:\Users\Renée Example\Téléchargements\delegated-work-settings-${"long-name-".repeat(12)}.json`;

  // Keep file writes inside the service integration tests, away from real Downloads.
  await page.route("**/api/tools/app_save_settings_file", async (route) => {
    saves++;

    if (saves === 1) {
      await pending.promise;

      await route.fulfill({
        status: 400,
        json: { error: "Downloads isn't writable." },
      });
    } else {
      await route.fulfill({ json: { result: { path } } });
    }
  });

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.setViewportSize({ width: 360, height: 1000 });

  await page
    .getByRole("tab", { name: "Import and export", exact: true })
    .click();

  const saveFile = page.getByRole("button", {
    name: "Export file",
    exact: true,
  });

  const copy = page.getByRole("button", { name: "Copy JSON", exact: true });

  const paste = page.getByRole("textbox", {
    name: "Paste copied settings",
    exact: true,
  });

  const importButton = page.getByRole("button", {
    name: "Import settings",
    exact: true,
  });

  await paste.fill("{}");
  await saveFile.click();

  await expect(
    page.getByRole("button", { name: "Saving…", exact: true }),
  ).toBeDisabled();

  await expect(copy).toBeDisabled();
  await expect(importButton).toBeDisabled();
  expect(saves).toBe(1);
  pending.resolve();

  await expect(page.getByRole("alert")).toContainText(
    "Downloads isn't writable.",
  );

  await expect(page.getByRole("alert")).toContainText("Use Copy JSON instead.");

  await expect(copy).toBeEnabled();
  await expect(importButton).toBeEnabled();
  await expect(paste).toHaveValue("{}");

  await saveFile.click();

  await expect(
    page.getByRole("status").filter({ hasText: "Saved to" }),
  ).toHaveText(`Saved to ${path}`);

  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(saves).toBe(2);

  expect(
    await page
      .locator(".settings-transfer-status")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
});
