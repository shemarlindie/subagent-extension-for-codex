// @vitest-environment jsdom
import { expect } from "vitest";

import {
  assert,
  budgetRow,
  pasteText,
  scope,
  screen,
  serveSettings,
  setupSettings,
  test,
  waitFor,
} from "./panel-test-support";

async function waitForSettingsSaved() {
  await waitFor(() =>
    assert.equal(
      screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled,
      true,
    ),
  );
}

test("settings edits made during a save remain as unsaved changes", async (t) => {
  const { transport, user } = await setupSettings(t, (transport) =>
    serveSettings(transport, {
      values: {
        providers: { claude: { subagents: true } },
        task: { budget: { max_cost_usd: { enabled: false, amount: 5 } } },
      },
      sections: [
        {
          id: "task",
          title: "Task",
          rows: [
            {
              kind: "switch",
              path: "providers.claude.subagents",
              label: "Allow subagents",
            },
            budgetRow,
          ],
        },
      ],
    }),
  );

  let releaseUpdate!: () => void;

  const updateGate = new Promise<void>((resolve) => {
    releaseUpdate = resolve;
  });

  t.onTestFinished(() => releaseUpdate());

  const original = transport.tool.bind(transport);

  transport.tool = async <T>(name: string, args = {}) => {
    const result = await original<T>(name, args);
    if (name === "update_settings") await updateGate;

    return result;
  };

  await screen.findByRole("heading", { name: "Settings" });
  await user.click(screen.getByRole("switch", { name: "Allow subagents" }));
  await user.click(screen.getByRole("button", { name: "Save 1 change" }));
  await screen.findByRole("button", { name: "Working…" });

  await user.click(screen.getByRole("switch", { name: "Cost limit" }));
  releaseUpdate();

  await screen.findByRole("button", { name: "Save 1 change" });

  expect(
    screen
      .getByRole("switch", { name: "Cost limit" })
      .getAttribute("aria-checked"),
  ).toBe("true");

  assert.deepEqual(
    transport.calls.find((call) => call.name === "update_settings")?.args,
    { set: { providers: { claude: { subagents: false } } } },
  );
});

test("settings reveals an invalid budget in another section and saves typed models", async (t) => {
  const { transport, user } = await setupSettings(t, (transport) =>
    serveSettings(transport, {
      values: {
        task: { budget: { max_cost_usd: { enabled: false, amount: 5 } } },
      },
      sections: [
        { id: "budgets", title: "Budgets", rows: [budgetRow] },
        {
          id: "models",
          title: "Models",
          rows: [
            {
              kind: "models",
              scopes: [scope("models.profiles.researcher", "Researcher")],
            },
          ],
        },
      ],
    }),
  );

  await screen.findByRole("heading", { name: "Settings" });

  // An off limit keeps its amount visible but prevents edits.
  const amount = screen.getByRole("spinbutton", { name: "Cost limit (USD)" });
  assert.equal((amount as HTMLInputElement).disabled, true);
  const savedAmount = (amount as HTMLInputElement).value;

  assert.equal(
    screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled,
    true,
  );

  assert.equal(
    transport.calls.some((call) => call.name === "update_settings"),
    false,
  );

  await user.click(screen.getByRole("switch", { name: "Cost limit" }));
  assert.equal((amount as HTMLInputElement).disabled, false);
  assert.equal((amount as HTMLInputElement).value, savedAmount);

  await user.clear(amount);

  const budgetsTab = screen.getByRole("tab", { name: /^Budgets/ });
  await user.click(screen.getByRole("tab", { name: /^Models/ }));
  assert.equal(budgetsTab.getAttribute("aria-selected"), "false");

  // A model without discovered choices is typed.
  await pasteText(
    user,
    screen.getByRole("textbox", { name: "Researcher model" }),
    "custom-id",
  );

  // An invalid field switches to its section and receives focus.
  await user.click(screen.getByRole("button", { name: "Save 2 changes" }));
  assert.equal(budgetsTab.getAttribute("aria-selected"), "true");

  await waitFor(() => expect(document.activeElement).toBe(amount));

  assert.equal(
    transport.calls.some((call) => call.name === "update_settings"),
    false,
  );

  await pasteText(user, amount, "8");
  await user.click(screen.getByRole("button", { name: "Save 2 changes" }));
  await waitForSettingsSaved();

  assert.deepEqual(
    transport.calls.find((call) => call.name === "update_settings")!.args,
    {
      set: {
        task: { budget: { max_cost_usd: { enabled: true, amount: 8 } } },
        models: { profiles: { researcher: { model: "custom-id" } } },
      },
    },
  );
});

test("settings explains invalid disabled budgets and lets the user restore editing", async (t) => {
  const { transport, user } = await setupSettings(t, (transport) =>
    serveSettings(transport, {
      values: {
        task: { budget: { max_cost_usd: { enabled: true, amount: 5 } } },
      },
      sections: [{ id: "task", title: "Task", rows: [budgetRow] }],
    }),
  );

  await screen.findByRole("heading", { name: "Settings" });

  const amount = screen.getByRole("spinbutton", { name: "Cost limit (USD)" }),
    toggle = screen.getByRole("switch", { name: "Cost limit" });

  await user.clear(amount);
  await pasteText(user, amount, "500");
  await user.click(toggle);
  await user.click(screen.getByRole("button", { name: "Save 1 change" }));
  await screen.findByText("Enter an amount from 0.01 to 100 USD.");
  assert.equal(amount.getAttribute("aria-invalid"), "true");
  await waitFor(() => expect(document.activeElement).toBe(toggle));

  assert.equal(
    transport.calls.some((call) => call.name === "update_settings"),
    false,
  );

  await user.click(toggle);
  await user.clear(amount);
  await pasteText(user, amount, "8");
  await user.click(toggle);
  await user.click(screen.getByRole("button", { name: "Save 1 change" }));
  await waitForSettingsSaved();

  assert.deepEqual(
    transport.calls.find((call) => call.name === "update_settings")!.args,
    {
      set: {
        task: { budget: { max_cost_usd: { enabled: false, amount: 8 } } },
      },
    },
  );
});

test("settings resets preserve another section's draft and saved override", async (t) => {
  const { user } = await setupSettings(t, (transport) =>
    serveSettings(transport, {
      values: {
        providers: { claude: { subagents: false } },
        task: { budget: { max_cost_usd: { enabled: false, amount: 5 } } },
        models: { global: { model: "saved-model", reasoning_effort: "high" } },
      },
      defaults: {
        providers: { claude: { subagents: true } },
        task: { budget: { max_cost_usd: { enabled: true, amount: 5 } } },
        models: { global: { model: "", reasoning_effort: "default" } },
      },
      sections: [
        {
          id: "task",
          title: "Task",
          rows: [
            {
              kind: "switch",
              path: "providers.claude.subagents",
              label: "Allow subagents",
            },
            budgetRow,
          ],
        },
        {
          id: "models",
          title: "Models",
          rows: [
            { kind: "models", scopes: [scope("models.global", "Global")] },
          ],
        },
      ],
    }),
  );

  await screen.findByRole("heading", { name: "Settings" });
  const subagents = screen.getByRole("switch", { name: "Allow subagents" });

  // Resetting Task must preserve another section's saved override and draft.
  await user.click(screen.getByRole("tab", { name: "Models" }));
  const model = screen.getByRole("textbox", { name: "Global model" });
  await user.clear(model);
  await pasteText(user, model, "draft-model");

  await user.click(screen.getByRole("tab", { name: "Task" }));
  await user.click(screen.getByRole("button", { name: "Reset to defaults" }));

  assert.equal(subagents.getAttribute("aria-checked"), "true");

  assert.equal(
    screen
      .getByRole("switch", { name: "Cost limit" })
      .getAttribute("aria-checked"),
    "true",
  );

  assert.equal(screen.queryAllByRole("button", { name: /^Reset/ }).length, 0);

  await user.click(screen.getByRole("tab", { name: /^Models/ }));
  assert.equal((model as HTMLInputElement).value, "draft-model");
  assert.equal(screen.getAllByRole("button", { name: /^Reset/ }).length, 1);

  assert.equal(
    screen.getByRole("combobox", { name: "Global effort" }).textContent,
    "high",
  );
});

test("the service saves an export only when the host or browser can't, and never after a refusal", async (t) => {
  const { transport, user } = await setupSettings(t, (transport) => {
    serveSettings(transport, { sections: [] });
    const original = transport.tool.bind(transport);

    transport.tool = async <T>(name: string, args = {}) => {
      if (name === "app_export_settings") return { document: "{}" } as T;

      if (name === "app_save_settings_file") {
        transport.calls.push({ name, args });

        return { path: "/home/person/settings.json" } as T;
      }

      return original<T>(name, args);
    };
  });

  const serviceSaves = () =>
    transport.calls.filter((call) => call.name === "app_save_settings_file");

  await user.click(
    await screen.findByRole("tab", { name: "Import and export" }),
  );

  const exportFile = screen.getByRole("button", { name: "Export file" });

  // Without a host or browser save, the service saves and reports where.
  await user.click(exportFile);
  await screen.findByText("/home/person/settings.json");
  assert.equal(serviceSaves().length, 1);

  // A host that declines has no download, and the service must not save instead.
  transport.saveJson = async () => {
    throw new Error("The host didn't save the file.");
  };

  await user.click(exportFile);
  await screen.findByText(/didn't save the file\. Use Copy JSON instead\./);
  assert.equal(serviceSaves().length, 1);
});
