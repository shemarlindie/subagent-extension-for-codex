import { openAdvancedTask, send } from "./console-actions";
import { expect, test } from "./fixtures";

test.use({ reducedMotion: "no-preference" });

test("review several changed files across scopes, viewed marks and previews", async ({
  consolePage: page,
}) => {
  await page.setViewportSize({ width: 1280, height: 640 });
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
  const diffs = changes.locator(".diff-view");
  const first = diffs.getByText(/^fixture-scenario-.*-turn-1\.md$/);
  const second = diffs.getByText(/^fixture-scenario-.*-turn-2\.md$/);
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
  const viewed = changes.getByRole("checkbox", {
    name: /^Viewed .*turn-1\.md$/,
  });

  await viewed.check();
  await expect(changes).toContainText("1 of 2 viewed");
  await viewed.press("ControlOrMeta+z");
  await expect(changes).toContainText("0 of 2 viewed");
  await viewed.press("ControlOrMeta+Shift+z");
  await expect(changes).toContainText("1 of 2 viewed");

  // The picker remains reachable while reading below the Changes header.
  const picker = changes.getByRole("button", { name: "Files", exact: true });

  const files = page.getByRole("navigation", {
    name: "Changed files by folder",
  });

  const firstPath = (await first.textContent())!;
  const firstDiff = changes.locator(`[data-changed-file="${firstPath}"]`);
  await expect(files).toHaveCount(0);
  await expect(firstDiff).not.toHaveAttribute("open");
  await page.setViewportSize({ width: 1280, height: 560 });

  await changes.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });

  await expect
    .poll(() => changes.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);

  await expect
    .poll(async () => {
      const [button, viewport] = await Promise.all([
        picker.boundingBox(),
        changes.boundingBox(),
      ]);

      return Boolean(
        button &&
        viewport &&
        button.y >= viewport.y &&
        button.y + button.height <= viewport.y + viewport.height,
      );
    })
    .toBe(true);

  // Picking a viewed file opens it and leaves navigation available.
  await picker.click();
  await files.getByRole("button", { name: firstPath, exact: true }).click();
  await expect(firstDiff).toHaveAttribute("open");
  await expect(firstDiff.locator(".diff-table")).toBeVisible();
  await expect(files).toBeVisible();

  await page
    .getByRole("button", { name: "Collapse file navigator", exact: true })
    .click();

  await expect(files).toHaveCount(0);
  await expect(picker).toBeFocused();

  // Picking the same file again reopens it after a manual collapse.
  await first.click();
  await expect(firstDiff).not.toHaveAttribute("open");
  await picker.press("Enter");
  await files.getByRole("button", { name: firstPath, exact: true }).click();
  await expect(firstDiff).toHaveAttribute("open");
  await expect(files).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(files).toHaveCount(0);
  await expect(picker).toBeFocused();

  // The last file reaches the top, clear of the navigator, and reads as current.
  const secondPath = (await second.textContent())!;

  const secondPick = files.getByRole("button", {
    name: secondPath,
    exact: true,
  });

  await picker.click();
  await secondPick.click();
  await expect(secondPick).toHaveAttribute("aria-current", "location");

  await expect
    .poll(async () => {
      const [diff, viewport] = await Promise.all([
        changes.locator(`[data-changed-file="${secondPath}"]`).boundingBox(),
        changes.boundingBox(),
      ]);

      return diff && viewport && Math.round(diff.y - viewport.y);
    })
    .toBe(0);

  await page.keyboard.press("Escape");

  await changes
    .getByRole("button", { name: "Preview all changes", exact: true })
    .click();

  // The undo toast is a dialog too, so match the preview by its controls.
  const preview = page.getByRole("dialog").filter({
    has: page.getByRole("button", { name: "File preview options" }),
  });

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
