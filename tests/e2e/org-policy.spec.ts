import type { ProviderPolicy } from "../../src/shared/providers/types.js";
import { openAdvancedTask, send, startTask } from "./console-actions";
import { expect, test } from "./fixtures";

const orgPolicy: ProviderPolicy = {
  managed: true,
  blocked: [
    {
      value: "bypassPermissions",
      reason: "Turned off by your organization",
    },
  ],
  available_models: ["fixture-fast"],
  available_models_match: "prefix",
  notes: [],
};

let policy: ProviderPolicy | undefined;

test.use({
  fixtureProvider: {
    turnDelayMs: 0,
    replyPaceMs: 0,
    policy: async () => policy,
  },
});

test("a model an organization excludes later gives way to the default, and the panel shows its limits", async ({
  consolePage: page,
  consoleService,
}) => {
  policy = undefined;

  // A custom model can only be saved through the service, as Settings offers
  // the worker's own models. Settings warns on the provider's row, and new
  // tasks use the profile's.
  const saved = await page.request.post("/api/tools/update_settings", {
    data: {
      set: {
        models: {
          providers: { fixture: { model: "retired-model" } },
          profiles: { implementer: { model: "retired-model" } },
        },
      },
    },
    headers: {
      Origin: consoleService.origin,
      "X-Subagent-Extension-For-Codex": "1",
    },
  });

  await expect(saved).toBeOK();
  await page.reload();

  const history = page.getByRole("region", { name: "Chat history" });
  const limit = "Your organization doesn't allow retired-model.";
  const taskSettings = page.getByRole("list", { name: "Task settings" });

  await startTask(page, "First task");
  await expect(history).toContainText("First task");
  await expect(page.getByRole("note")).toHaveCount(0);
  await expect(taskSettings).toContainText("retired-model");

  // The running task moves to the default on its next turn.
  policy = orgPolicy;
  await send(page, "Follow up");
  await expect(page.getByRole("note")).toContainText(limit);
  await expect(taskSettings).not.toContainText("retired-model");

  // Limits reach the panel with its next read of the worker.
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("tab", { name: "Model defaults", exact: true }).click();

  await expect(
    page
      .getByRole("tabpanel", { name: "Model defaults" })
      .getByText(/doesn't allow this model/),
  ).toBeVisible();

  await page.getByRole("button", { name: "Tasks", exact: true }).click();

  // A typed model outside the allowlist can't start.
  await openAdvancedTask(page, "Advanced task");
  const dialog = page.getByRole("dialog");

  await dialog
    .getByRole("combobox", { name: "Model", exact: true })
    .fill("retired-model");

  await dialog.getByRole("button", { name: "Start task", exact: true }).click();

  await expect(
    dialog.getByText("Your organization doesn't allow this model."),
  ).toBeVisible();

  // A mode policy turns off stays listed, locked with the reason.
  await dialog
    .getByRole("combobox", { name: "Permission mode", exact: true })
    .click();

  const locked = page.getByRole("option", { name: /Bypass/ });
  await expect(locked).toHaveAttribute("aria-disabled", "true");
  await expect(locked).toContainText("Turned off by your organization");
  await page.keyboard.press("Escape");

  await page.keyboard.press("Escape");

  // The composer shows and runs the default, and says why.
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByRole("button", { name: /^Edit Default model/ }).click();

  await page.getByRole("combobox", { name: /^Model: / }).click();

  await expect(
    page.getByText("Your organization limits these models."),
  ).toBeVisible();

  await page.keyboard.press("Escape");

  await page.getByRole("textbox", { name: "Task message" }).fill("Second task");
  await page.getByRole("button", { name: "Start task", exact: true }).click();
  await expect(history).toContainText("Second task");
  await expect(page.getByRole("note")).toContainText(limit);
  await expect(taskSettings).not.toContainText("retired-model");

  await page.getByRole("tab", { name: "Activity", exact: true }).click();

  await expect(
    page.getByRole("tabpanel", { name: "Activity" }).getByText(limit),
  ).toBeVisible();
});
