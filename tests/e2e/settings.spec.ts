import { readFile } from "node:fs/promises";

import { expect, test } from "./fixtures";

test("About loads diagnostics on demand and rechecks the CLI", async ({
  consolePage: page,
}) => {
  let requests = 0;
  const refreshes: boolean[] = [];

  await page.route("**/api/tools/app_get_about", async (route) => {
    requests++;
    refreshes.push(route.request().postDataJSON().refresh as boolean);

    if (requests === 1) {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Diagnostics unavailable" }),
      });
    } else {
      await route.continue();
    }
  });

  await page.getByRole("button", { name: "Settings", exact: true }).click();

  expect(requests).toBe(0);
  await page.getByRole("tab", { name: "About", exact: true }).click();

  await expect(page.getByRole("alert")).toContainText(
    "Diagnostics unavailable",
  );

  await page.getByRole("button", { name: "Retry", exact: true }).click();

  const upgrade = page.getByRole("button", {
    name: "CLI upgrade instructions",
    exact: true,
  });

  await expect(upgrade).toHaveAttribute("aria-expanded", "false");
  await upgrade.click();
  await expect(upgrade).toHaveAttribute("aria-expanded", "true");

  await page
    .getByRole("button", { name: "Recheck version", exact: true })
    .click();

  await expect(
    page.getByRole("button", { name: "Recheck version", exact: true }),
  ).toBeEnabled();

  expect(refreshes).toEqual([false, true, true]);

  await upgrade.click();

  await expect(
    page.getByRole("button", { name: "Recheck version", exact: true }),
  ).toHaveCount(0);
});

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

  // The section's tab counts its unsaved edits.
  await expect(page.getByRole("tab", { name: /^Task defaults/ })).toContainText(
    "2 changed",
  );

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

  const keepEditing = leave.getByRole("button", {
    name: "Keep editing",
    exact: true,
  });

  await expect(keepEditing).toBeFocused();
  await keepEditing.click();
  await expect(leave).toHaveCount(0);
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
  await expect(workspace).toHaveText("Project folder");

  await page
    .getByRole("button", { name: "Save 2 changes", exact: true })
    .click();

  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();

  await page.reload();
  await expect(prefix).toHaveValue("agent/");
  await expect(workspace).toHaveText("Project folder");
});

test("advanced task options set the task's model and permission policy", async ({
  consolePage: page,
}) => {
  await page.getByRole("button", { name: "More ways to start a task" }).click();
  await page.getByRole("menuitem", { name: /Advanced task/ }).click();
  const dialog = page.getByRole("dialog");

  await dialog
    .getByLabel("Description", { exact: true })
    .fill("Ask nothing [fixture:permission tool=Bash]");

  await dialog.getByRole("combobox", { name: "Model", exact: true }).click();
  await page.getByRole("option", { name: /Fixture Fast/ }).click();

  await dialog
    .getByRole("combobox", { name: "Permission mode", exact: true })
    .click();

  await page.getByRole("option", { name: /^Don't ask/ }).click();
  await dialog.getByRole("button", { name: "Start task", exact: true }).click();

  // Don't ask mode denies the tool without asking.
  const history = page.getByRole("region", { name: "Chat history" });
  await expect(history).toContainText("Fixture Bash request denied");
  await expect(page.getByRole("button", { name: "Deny" })).toHaveCount(0);
  await page.reload();
  const settings = page.getByRole("list", { name: "Task settings" });
  // Only Claude reports a permission mode for this list. The denial shows the fixture's.
  await expect(settings).toContainText("Fixture Fast");
});

test("custom instructions save under a worker profile and stay with the tasks it starts", async ({
  consolePage: page,
}) => {
  const text = "Cite file paths.\nKeep it short.";

  await page.getByRole("button", { name: "More ways to start a task" }).click();
  await page.getByRole("menuitem", { name: /Advanced task/ }).click();

  await expect(
    page
      .getByRole("dialog")
      .getByRole("combobox", { name: "Worker", exact: true }),
  ).toHaveText("fixture · implementer");

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Settings", exact: true }).click();

  await page
    .getByRole("combobox", { name: "Worker profile", exact: true })
    .click();

  await page.getByRole("option", { name: "Reviewer", exact: true }).click();

  await page.getByRole("tab", { name: "Worker profiles", exact: true }).click();

  // Each profile's name opens its custom instructions under its models.
  const open = page.getByRole("button", {
    name: "Reviewer custom instructions",
    exact: true,
  });

  await expect(open).toHaveAttribute("aria-expanded", "false");
  await open.click();

  const reviewer = page.getByRole("textbox", {
    name: "Reviewer custom instructions",
    exact: true,
  });

  await reviewer.fill(text);

  await page
    .getByRole("button", { name: "Save 2 changes", exact: true })
    .click();

  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();

  await page.reload();
  await expect(open).toHaveAttribute("aria-expanded", "false");
  await open.click();
  await expect(reviewer).toHaveValue(text);
  await page.getByRole("button", { name: "Tasks", exact: true }).click();

  await page.getByRole("button", { name: "New task", exact: true }).click();

  await expect(
    page.getByRole("combobox", { name: "Profile: Reviewer", exact: true }),
  ).toBeVisible();

  await page.getByRole("textbox", { name: "Task message" }).press("Escape");
  await page.getByRole("button", { name: "More ways to start a task" }).click();
  await page.getByRole("menuitem", { name: /Advanced task/ }).click();
  const dialog = page.getByRole("dialog");

  await expect(
    dialog.getByRole("combobox", { name: "Worker", exact: true }),
  ).toHaveText("fixture · reviewer");

  await dialog.getByLabel("Description", { exact: true }).fill("Review");
  await dialog.getByRole("button", { name: "Start task", exact: true }).click();

  await page.getByRole("tab", { name: "Details" }).click();

  const fact = page
    .locator(".fact")
    .filter({ has: page.getByText("Custom instructions", { exact: true }) });

  await expect(fact.locator("dd")).toHaveText(text);
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
  const first = Promise.withResolvers<void>();
  const retry = Promise.withResolvers<void>();

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

test("exporting settings reports failures, then downloads the file in the browser", async ({
  consolePage: page,
}) => {
  const pending = Promise.withResolvers<void>();
  let exports = 0;

  await page.route("**/api/tools/app_export_settings", async (route) => {
    exports++;

    if (exports === 1) {
      await pending.promise;

      await route.fulfill({
        status: 400,
        json: { error: "The export failed." },
      });
    } else {
      await route.fallback();
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
  expect(exports).toBe(1);
  pending.resolve();

  await expect(page.getByRole("alert")).toContainText("The export failed.");
  await expect(page.getByRole("alert")).toContainText("Use Copy JSON instead.");

  await expect(copy).toBeEnabled();
  await expect(importButton).toBeEnabled();
  await expect(paste).toHaveValue("{}");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    saveFile.click(),
  ]);

  expect(download.suggestedFilename()).toBe("delegated-work-settings.json");

  expect(
    JSON.parse(await readFile(await download.path(), "utf8")),
  ).toMatchObject({ format: 2 });

  await expect(
    page.getByRole("status").filter({ hasText: "Exported" }),
  ).toBeVisible();

  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("settings search keeps hidden drafts and reveals invalid fields on save", async ({
  consolePage: page,
}) => {
  await page.getByRole("button", { name: "Settings", exact: true }).click();

  const search = page.getByRole("searchbox", { name: "Search settings" });

  const prefix = page.getByRole("textbox", {
    name: "Worktree branch prefix",
    exact: true,
  });

  // Opening settings focuses search once it loads. The hidden tasks page keeps
  // its search mounted, but "/" focuses this one.
  await expect(search).toBeFocused();
  await search.blur();
  await page.keyboard.press("/");
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("");

  await prefix.fill("bad prefix!");
  await search.fill("  RESEARCHER instructions  ");

  await expect(
    page.getByRole("button", {
      name: "Researcher custom instructions",
      exact: true,
    }),
  ).toBeVisible();

  await expect(
    page.getByRole("button", {
      name: "Reviewer custom instructions",
      exact: true,
    }),
  ).toBeHidden();

  await expect(prefix).toBeHidden();
  await search.press("Enter");
  await expect(search).toHaveValue("  RESEARCHER instructions  ");

  await page
    .getByRole("button", { name: "Save 1 change", exact: true })
    .click();

  await expect(search).toHaveValue("");
  await expect(prefix).toBeFocused();
  await expect(prefix).toHaveValue("bad prefix!");
  await prefix.fill("search-draft/");

  await search.fill("task.worktree_branch_prefix");
  await expect(prefix).toBeVisible();

  await expect(
    page.getByRole("combobox", { name: "Workspace", exact: true }),
  ).toBeHidden();

  await expect(
    page.getByRole("button", { name: "Reset to defaults", exact: true }),
  ).toBeHidden();

  await search.fill("no-such-setting");

  await expect(page.getByRole("status")).toHaveText(
    "No settings match “no-such-setting”.",
  );

  await search.fill("JSON");

  await expect(
    page.getByRole("button", { name: "Copy JSON", exact: true }),
  ).toBeVisible();
});

test("settings search groups all matches, explains choices and keeps saved edits visible", async ({
  consolePage: page,
}) => {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("tab", { name: "Worker profiles", exact: true }).click();
  const search = page.getByRole("searchbox", { name: "Search settings" });
  await search.fill("model");

  await expect(
    page.getByRole("region", { name: "Model defaults", exact: true }),
  ).toBeVisible();

  await expect(
    page.getByRole("region", { name: "Worker profiles", exact: true }),
  ).toBeVisible();

  await expect(
    page.getByRole("tablist", { name: "Settings sections" }),
  ).toBeHidden();

  await expect(page.getByRole("status")).toHaveText(
    /\d+ results across 2 sections/,
  );

  await expect(
    page.locator("mark").filter({ hasText: /model/i }).first(),
  ).toBeVisible();

  await search.fill("researcher");

  await expect(
    page.getByText("Includes Researcher", { exact: true }),
  ).toBeVisible();

  await search.fill("timeout");

  await expect(
    page.getByRole("spinbutton", { name: "Runtime limit (mins)" }),
  ).toBeVisible();

  await expect(
    page.getByText("Related to timeout", { exact: true }),
  ).toBeVisible();

  await search.fill("researcher instructions");

  const instructions = page.getByRole("textbox", {
    name: "Researcher custom instructions",
    exact: true,
  });

  await expect(instructions).toBeVisible();
  const node = await instructions.elementHandle();
  await instructions.fill("Keep citations short.");
  await expect(instructions).toBeFocused();
  await expect(search).toHaveValue("researcher instructions");

  await expect(page.getByRole("status")).toHaveText(
    "1 result across 1 section",
  );

  await page
    .getByRole("button", { name: "Save 1 change", exact: true })
    .click();

  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();

  await expect(search).toHaveValue("researcher instructions");
  await expect(instructions).toHaveValue("Keep citations short.");

  expect(
    await instructions.evaluate(
      (element, original) => element === original,
      node,
    ),
  ).toBe(true);

  await page
    .getByRole("button", {
      name: "Researcher custom instructions",
      exact: true,
    })
    .click();

  await expect(instructions).toBeHidden();
  await page.getByRole("button", { name: "Clear settings search" }).click();
  await expect(search).toBeFocused();

  // Search expansion leaves the previous browsing expansion state intact.
  await expect(instructions).toBeHidden();

  await search.fill("researcher instructions");
  await expect(instructions).toBeVisible();
  await expect(instructions).toHaveValue("Keep citations short.");

  await search.fill("profiles.researcher.instructions");
  await expect(instructions).toBeVisible();

  await expect(
    page.getByLabel("Researcher model", { exact: true }),
  ).toHaveAccessibleDescription(/Setting: profiles\.researcher\.instructions/);
});

test.describe("with motion", () => {
  // The open instructions panel animates back in after search clears.
  test.use({ reducedMotion: "no-preference" });

  test("clearing settings search restores browsing position and expanded drafts", async ({
    consolePage: page,
  }) => {
    await page.setViewportSize({ width: 1000, height: 430 });
    await page.getByRole("button", { name: "Settings", exact: true }).click();

    await page
      .getByRole("tab", { name: "Worker profiles", exact: true })
      .click();

    await page
      .getByRole("button", {
        name: "Researcher custom instructions",
        exact: true,
      })
      .click();

    const instructions = page.getByRole("textbox", {
      name: "Researcher custom instructions",
      exact: true,
    });

    await expect
      .poll(() =>
        page
          .locator(".profile-instructions", { has: instructions })
          .evaluate(
            (panel) =>
              !panel.hasAttribute("data-starting-style") &&
              panel.getAnimations().length === 0,
          ),
      )
      .toBe(true);

    await instructions.fill("Preserve this draft.");
    const pageFrame = page.locator(".settings-page");
    const search = page.getByRole("searchbox", { name: "Search settings" });
    await search.focus();

    const focusedPosition = await pageFrame.evaluate(
      (element) => element.scrollTop,
    );

    await pageFrame.evaluate((element) => {
      element.scrollTop += 120;
    });

    const position = await pageFrame.evaluate((element) => element.scrollTop);
    expect(position).toBeGreaterThan(focusedPosition);
    await search.fill("timeout");
    await expect(instructions).toBeHidden();
    await search.press("Escape");
    await expect(search).toBeFocused();
    await expect(instructions).toHaveValue("Preserve this draft.");
    await expect(instructions).toBeVisible();

    await expect(
      page.getByRole("tab", { name: /^Worker profiles/ }),
    ).toHaveAttribute("aria-selected", "true");

    await expect
      .poll(() => pageFrame.evaluate((element) => element.scrollTop))
      .toBe(position);

    // Sticky controls stay separate with narrow panels and host font sizes.
    await page.setViewportSize({ width: 360, height: 600 });

    await page.evaluate(() => {
      document.documentElement.style.setProperty("--font-text-sm-size", "28px");
    });

    await pageFrame.evaluate((element) => {
      element.scrollTop = 300;
    });

    await expect(async () => {
      const bounds = await pageFrame.evaluate((element) => ({
        headerBottom: element
          .querySelector(".page-frame-heading")!
          .getBoundingClientRect().bottom,
        searchTop: element
          .querySelector(".settings-search")!
          .getBoundingClientRect().top,
        searchBottom: element
          .querySelector(".settings-search")!
          .getBoundingClientRect().bottom,
        tabsTop: element
          .querySelector(".settings-section-tabs-list")!
          .getBoundingClientRect().top,
      }));

      expect(bounds.searchTop).toBeGreaterThanOrEqual(bounds.headerBottom);
      expect(bounds.tabsTop).toBeGreaterThanOrEqual(bounds.searchBottom);
    }).toPass();
  });
});
