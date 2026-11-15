import { startTask } from "./console-actions";
import { expect, test } from "./fixtures";

test("the composer suggests slash commands and leaves other keys to the textarea", async ({
  consolePage: page,
}) => {
  await startTask(page, "Start with a reply");
  const history = page.getByRole("region", { name: "Chat history" });
  await expect(history).toContainText("Fixture session turn: 1.");
  // The textarea is a combobox while it suggests commands.
  const composer = page.getByLabel("Message", { exact: true });
  const options = page.getByRole("option");

  // Name matches come first, then alias matches such as /usage for /cost.
  await composer.pressSequentially("/co");
  await expect(options).toHaveText([/^\/compact/, /^\/context/, /^\/usage/]);

  await composer.press("ArrowDown");
  await composer.press("Enter");
  await expect(composer).toHaveValue("/context ");
  await expect(options).toHaveCount(0);
  // The textarea's text is transparent over the highlight that paints it.
  await expect(page.locator(".command-highlight")).toHaveText("/context ");

  // Escape hides the menu and keeps the draft.
  await composer.fill("/u");
  await expect(options).toHaveText([/^\/usage/]);
  await composer.press("Escape");
  await expect(options).toHaveCount(0);
  await expect(composer).toHaveValue("/u");

  // A command with text after it completes in place.
  await composer.fill("/co keep the plan");
  await expect(options).toHaveCount(0);
  for (const _ of " keep the plan") await composer.press("ArrowLeft");
  await expect(options).toHaveText([/^\/compact/, /^\/context/, /^\/usage/]);
  await composer.press("Tab");
  await expect(composer).toHaveValue("/compact keep the plan");

  expect(
    await composer.evaluate((input: HTMLTextAreaElement) => input.selectionEnd),
  ).toBe("/compact ".length);

  // A closed menu leaves line navigation to the textarea.
  await composer.fill("first line\nsecond");
  await composer.press("ArrowUp");

  expect(
    await composer.evaluate((input: HTMLTextAreaElement) => input.selectionEnd),
  ).toBeLessThanOrEqual("first line".length);

  // Enter with the menu closed sends.
  await composer.fill("/context ");
  await composer.press("Enter");

  await expect(
    history
      .getByRole("article", { name: "You", exact: true })
      .locator(".chat-bubble"),
  ).toHaveText(["Start with a reply", "/context"]);
});
