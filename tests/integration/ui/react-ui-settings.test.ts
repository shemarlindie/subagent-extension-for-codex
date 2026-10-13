// @vitest-environment jsdom
import { expect } from "vitest";

import {
  assert,
  assertAbsent,
  budgetRow,
  scope,
  screen,
  serveSettings,
  setup,
  test,
  waitFor,
} from "./react-ui-test-support";

async function waitForSettingsSaved() {
  await waitFor(() =>
    assert.equal(
      (screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
        .disabled,
      true,
    ),
  );
}

test("settings page renders server sections and saves only changed fields", async (t) => {
  const { transport, user } = await setup(t, (transport) =>
    serveSettings(transport, {
      values: {
        default_workspace_strategy: "current_repo",
        claude_subagents: true,
        max_cost_usd: null,
        default_model: "",
        default_reasoning_effort: "default",
      },
      sections: [
        {
          id: "task",
          title: "Task",
          help: ["Used when a task doesn't choose its own."],
          rows: [
            {
              kind: "select",
              key: "default_workspace_strategy",
              label: "Workspace",
              options: [
                { value: "current_repo", label: "Current repository" },
                { value: "worktree", label: "Isolated worktree" },
              ],
            },
            {
              kind: "switch",
              key: "claude_subagents",
              label: "Allow subagents",
            },
            budgetRow,
          ],
        },
        {
          id: "models",
          title: "Models",
          rows: [
            {
              kind: "models",
              scopes: [
                scope("default", "Global", [
                  { value: "", label: "Inherit" },
                  {
                    value: "model-a",
                    label: "Model A",
                    description: "Fast model",
                  },
                ]),
              ],
            },
          ],
        },
      ],
    }),
  );

  await user.click(screen.getByRole("button", { name: "Settings" }));
  await screen.findByRole("heading", { name: "Settings" });
  assertAbsent(screen.queryByRole("dialog"));
  assert.ok(screen.getByText("Used when a task doesn't choose its own."));

  const task = screen.getByRole("tab", { name: "Task" }),
    models = screen.getByRole("tab", { name: "Models" });

  assert.equal(task.getAttribute("aria-selected"), "true");
  assert.equal(models.getAttribute("aria-selected"), "false");

  const save = screen.getByRole("button", { name: "Save" });
  assert.equal((save as HTMLButtonElement).disabled, true);
  await user.click(screen.getByRole("switch", { name: "Allow subagents" }));
  await user.click(screen.getByRole("switch", { name: "Cost limit" }));
  await user.click(models);
  assert.equal(models.getAttribute("aria-selected"), "true");

  // Menu options show the server's description as secondary text.
  await user.click(screen.getByRole("combobox", { name: "Global model" }));
  const option = await screen.findByRole("option", { name: /Model A/ });

  assert.equal(
    option.querySelector(".select-item-description")?.textContent,
    "Fast model",
  );

  await user.click(option);

  // Each tab tracks edits in its own section; the budget counts once.
  assert.deepEqual(
    screen
      .getAllByText(/changed$/, { selector: ".settings-section-tab-badge" })
      .map((b) => b.textContent),
    ["2 changed", "1 changed"],
  );

  await user.click(screen.getByRole("button", { name: "Save 3 changes" }));
  await waitForSettingsSaved();
  assert.ok(screen.getByRole("heading", { name: "Settings" }));

  assert.deepEqual(
    transport.calls.find((call) => call.name === "update_agent_settings")!.args,
    {
      set: {
        claude_subagents: false,
        use_cost_budget: true,
        max_cost_usd: 5,
        default_model: "model-a",
      },
    },
  );
});

test("settings edits made during a save remain as unsaved changes", async (t) => {
  const { transport, user } = await setup(t, (transport) =>
    serveSettings(transport, {
      values: { claude_subagents: true, max_cost_usd: null },
      sections: [
        {
          id: "task",
          title: "Task",
          rows: [
            {
              kind: "switch",
              key: "claude_subagents",
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
    if (name === "update_agent_settings") await updateGate;

    return result;
  };

  await user.click(screen.getByRole("button", { name: "Settings" }));
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
    transport.calls.find((call) => call.name === "update_agent_settings")?.args,
    { set: { claude_subagents: false } },
  );
});

test("settings validates hidden budgets, types uncatalogued models, and flags unsupported effort", async (t) => {
  const { transport, user } = await setup(t, (transport) =>
    serveSettings(transport, {
      values: {
        max_cost_usd: null,
        default_model: "",
        default_reasoning_effort: "high",
        researcher_default_model: "",
        researcher_default_reasoning_effort: "default",
      },
      sections: [
        { id: "budgets", title: "Budgets", rows: [budgetRow] },
        {
          id: "models",
          title: "Models",
          rows: [
            {
              kind: "models",
              scopes: [
                scope(
                  "default",
                  "Global",
                  [{ value: "", label: "Inherit" }],
                  true,
                ),
                scope("researcher_default", "Researcher"),
              ],
            },
          ],
        },
      ],
    }),
  );

  await user.click(screen.getByRole("button", { name: "Settings" }));
  await screen.findByRole("heading", { name: "Settings" });

  // An off limit keeps its amount visible but prevents edits.
  const amount = screen.getByRole("spinbutton", { name: "Cost limit (USD)" });
  assert.ok(amount.closest(".setting-amount")!.hasAttribute("data-off"));
  assert.equal((amount as HTMLInputElement).disabled, true);
  const savedAmount = (amount as HTMLInputElement).value;

  await user.type(amount, "500");
  assert.equal((amount as HTMLInputElement).value, savedAmount);

  assert.equal(
    (screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
      .disabled,
    true,
  );

  assert.equal(
    transport.calls.some((call) => call.name === "update_agent_settings"),
    false,
  );

  await user.click(screen.getByRole("switch", { name: "Cost limit" }));
  assert.equal((amount as HTMLInputElement).disabled, false);
  assert.equal((amount as HTMLInputElement).value, savedAmount);

  assert.equal(
    amount.closest(".setting-amount")!.hasAttribute("data-off"),
    false,
  );

  await user.clear(amount);

  const budgetsTab = screen.getByRole("tab", { name: /^Budgets/ });
  await user.click(screen.getByRole("tab", { name: /^Models/ }));
  assert.equal(budgetsTab.getAttribute("aria-selected"), "false");

  // The server flags an unsupported saved effort.
  assert.ok(
    screen.getByText("The saved effort is not supported by this model."),
  );

  // A model without discovered choices is typed.
  await user.type(
    screen.getByRole("textbox", { name: "Researcher model" }),
    "custom-id",
  );

  // An invalid field switches to its section and receives focus.
  await user.click(screen.getByRole("button", { name: "Save 2 changes" }));
  assert.equal(budgetsTab.getAttribute("aria-selected"), "true");

  await waitFor(() => expect(document.activeElement).toBe(amount));

  assert.equal(
    transport.calls.some((call) => call.name === "update_agent_settings"),
    false,
  );

  await user.type(amount, "8");
  await user.click(screen.getByRole("button", { name: "Save 2 changes" }));
  await waitForSettingsSaved();

  assert.deepEqual(
    transport.calls.find((call) => call.name === "update_agent_settings")!.args,
    {
      set: {
        use_cost_budget: true,
        max_cost_usd: 8,
        researcher_default_model: "custom-id",
      },
    },
  );
});

test("settings explains invalid disabled budgets and lets the user restore editing", async (t) => {
  const { transport, user } = await setup(t, (transport) =>
    serveSettings(transport, {
      values: { max_cost_usd: 5 },
      sections: [{ id: "task", title: "Task", rows: [budgetRow] }],
    }),
  );

  await user.click(screen.getByRole("button", { name: "Settings" }));
  await screen.findByRole("heading", { name: "Settings" });

  const amount = screen.getByRole("spinbutton", { name: "Cost limit (USD)" }),
    toggle = screen.getByRole("switch", { name: "Cost limit" });

  await user.clear(amount);
  await user.type(amount, "500");
  await user.click(toggle);
  await user.click(screen.getByRole("button", { name: "Save 1 change" }));
  await screen.findByText("Enter an amount from 0.01 to 100 USD.");
  assert.equal(amount.getAttribute("aria-invalid"), "true");
  await waitFor(() => expect(document.activeElement).toBe(toggle));

  assert.equal(
    transport.calls.some((call) => call.name === "update_agent_settings"),
    false,
  );

  await user.click(toggle);
  await user.clear(amount);
  await user.type(amount, "8");
  await user.click(toggle);
  await user.click(screen.getByRole("button", { name: "Save 1 change" }));
  await waitForSettingsSaved();

  assert.deepEqual(
    transport.calls.find((call) => call.name === "update_agent_settings")!.args,
    { set: { use_cost_budget: false, max_cost_usd: 8 } },
  );
});

test("settings help links show the setting they name, except within their own section", async (t) => {
  // Section help links by setting key; the trailing "profiles" is plain text,
  // so the link lookups below would fail on a second match.
  const help = [
    "Falls back to ",
    { text: "profiles", setting: "reviewer_default_model" },
    ", then ",
    { text: "defaults", setting: "default_model" },
    ". Not profiles.",
  ];

  const { user } = await setup(t, (transport) =>
    serveSettings(transport, {
      values: {
        default_model: "",
        default_reasoning_effort: "default",
        reviewer_default_model: "",
        reviewer_default_reasoning_effort: "default",
      },
      sections: [
        ["defaults", "Defaults", "default"],
        ["profiles", "Profiles", "reviewer_default"],
      ].map(([id, title, key]) => ({
        id,
        title,
        help,
        rows: [{ kind: "models" as const, scopes: [scope(key, `${key}`)] }],
      })),
    }),
  );

  await user.click(screen.getByRole("button", { name: "Settings" }));
  await screen.findByRole("heading", { name: "Settings" });

  const selected = (name: string) =>
    screen.getByRole("tab", { name }).getAttribute("aria-selected");

  // Links into the selected section stay plain text.
  assertAbsent(screen.queryByRole("button", { name: "defaults" }));
  const link = screen.getByRole("button", { name: "profiles" });
  assert.equal(link.getAttribute("title"), "Show in Profiles");

  // A link opens its setting's section and focuses that setting's field.
  await user.click(link);
  assert.equal(selected("Profiles"), "true");
  assert.equal(selected("Defaults"), "false");

  expect(document.activeElement).toBe(
    screen.getByRole("textbox", { name: "reviewer_default model" }),
  );

  assertAbsent(screen.queryByRole("button", { name: "profiles" }));
  await user.click(screen.getByRole("button", { name: "defaults" }));
  assert.equal(selected("Defaults"), "true");

  expect(document.activeElement).toBe(
    screen.getByRole("textbox", { name: "default model" }),
  );
});

test("settings resets restore defaults only per section", async (t) => {
  const { transport, user } = await setup(t, (transport) =>
    serveSettings(transport, {
      values: {
        claude_subagents: false,
        max_cost_usd: null,
        default_model: "saved-model",
        default_reasoning_effort: "high",
      },
      defaults: {
        claude_subagents: true,
        max_cost_usd: 5,
        default_model: "",
        default_reasoning_effort: "default",
      },
      sections: [
        {
          id: "task",
          title: "Task",
          rows: [
            {
              kind: "switch",
              key: "claude_subagents",
              label: "Allow subagents",
            },
            budgetRow,
          ],
        },
        {
          id: "models",
          title: "Models",
          rows: [{ kind: "models", scopes: [scope("default", "Global")] }],
        },
      ],
    }),
  );

  await user.click(screen.getByRole("button", { name: "Settings" }));
  await screen.findByRole("heading", { name: "Settings" });
  const subagents = screen.getByRole("switch", { name: "Allow subagents" });

  // Resetting Task must preserve another section's saved override and draft.
  await user.click(screen.getByRole("tab", { name: "Models" }));
  const model = screen.getByRole("textbox", { name: "Global model" });
  await user.clear(model);
  await user.type(model, "draft-model");

  assertAbsent(screen.queryByRole("button", { name: "Reset" }));

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

  await user.click(screen.getByRole("button", { name: "Save 3 changes" }));
  await waitForSettingsSaved();

  assert.deepEqual(
    transport.calls.find((call) => call.name === "update_agent_settings")!.args,
    {
      set: {
        claude_subagents: true,
        use_cost_budget: true,
        max_cost_usd: 5,
        default_model: "draft-model",
      },
    },
  );
});

test("leaving settings with unsaved edits asks before discarding them", async (t) => {
  const originalMatchMedia = Object.getOwnPropertyDescriptor(
    window,
    "matchMedia",
  );

  let prefersReducedMotion = false;

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string): MediaQueryList => ({
      matches:
        query === "(prefers-reduced-motion: reduce)" && prefersReducedMotion,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => true,
    }),
  });

  const originalScroll = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "scrollIntoView",
  );

  const scrolls: {
    element: HTMLElement;
    options?: boolean | ScrollIntoViewOptions;
  }[] = [];

  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value(this: HTMLElement, options?: boolean | ScrollIntoViewOptions) {
      if (!this.matches("[data-task]")) {
        scrolls.push({ element: this, options });
      }
    },
  });

  t.onTestFinished(() => {
    if (originalMatchMedia) {
      Object.defineProperty(window, "matchMedia", originalMatchMedia);
    } else {
      delete (window as Partial<Window>).matchMedia;
    }

    if (originalScroll) {
      Object.defineProperty(
        HTMLElement.prototype,
        "scrollIntoView",
        originalScroll,
      );
    } else {
      delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
    }
  });

  const { transport, user } = await setup(t, (transport) =>
    serveSettings(transport, {
      values: { claude_subagents: true },
      sections: [
        {
          id: "task",
          title: "Task",
          rows: [
            {
              kind: "switch",
              key: "claude_subagents",
              label: "Allow subagents",
            },
          ],
        },
      ],
    }),
  );

  await user.click(screen.getByRole("button", { name: "Settings" }));
  await screen.findByRole("heading", { name: "Settings" });
  assertAbsent(screen.queryByRole("dialog"));

  // Without edits, the back button returns to Tasks immediately.
  await user.click(screen.getByRole("button", { name: "Tasks" }));
  await screen.findByRole("button", { name: "Settings" });

  await user.click(screen.getByRole("button", { name: "Settings" }));
  await screen.findByRole("heading", { name: "Settings" });
  await user.click(screen.getByRole("switch", { name: "Allow subagents" }));

  // Returning to Tasks asks first; keeping edits leaves them in place.
  await user.click(screen.getByRole("button", { name: "Tasks" }));

  const assertPromptVisible = (behavior: ScrollBehavior = "smooth") => {
    const prompt = screen.getByText("Discard unsaved changes?"),
      notice = prompt.closest(".notice"),
      anchor = prompt.closest(".settings-discard-anchor");

    assert.equal(notice?.getAttribute("data-tone"), "warning");

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Keep editing" }),
    );

    expect(scrolls.at(-1)?.element).toBe(anchor);
    assert.deepEqual(scrolls.at(-1)?.options, { block: "start", behavior });
  };

  assertPromptVisible();
  assert.equal(scrolls.length, 1);
  await user.click(screen.getByRole("button", { name: "Keep editing" }));

  assert.ok(
    screen
      .getByText("Discard unsaved changes?")
      .closest(".settings-discard-anchor")
      ?.hasAttribute("hidden"),
  );

  assert.ok(screen.getByRole("button", { name: "Save 1 change" }));

  await user.click(screen.getByRole("button", { name: "Tasks" }));
  assertPromptVisible();
  assert.equal(scrolls.length, 2);
  await user.click(screen.getByRole("button", { name: "Keep editing" }));
  prefersReducedMotion = true;
  await user.click(screen.getByRole("button", { name: "Tasks" }));
  assertPromptVisible("instant");
  assert.equal(scrolls.length, 3);
  await user.click(screen.getByRole("button", { name: "Keep editing" }));
  prefersReducedMotion = false;
  await user.click(screen.getByRole("button", { name: "Tasks" }));
  assertPromptVisible();
  assert.equal(scrolls.length, 4);
  await user.click(screen.getByRole("button", { name: "Discard" }));
  await screen.findByRole("button", { name: "Settings" });

  await user.click(screen.getByRole("button", { name: "Settings" }));
  await screen.findByRole("heading", { name: "Settings" });

  assert.equal(
    screen
      .getByRole("switch", { name: "Allow subagents" })
      .getAttribute("aria-checked"),
    "true",
  );

  assert.equal(
    (screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
      .disabled,
    true,
  );

  assert.equal(
    transport.calls.some((call) => call.name === "update_agent_settings"),
    false,
  );
});
