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

test("settings dialog renders server sections and saves only changed fields", async (t) => {
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
  await screen.findByRole("dialog");
  assert.ok(screen.getByText("Used when a task doesn't choose its own."));

  // Collapsed sections summarize with the server's labels.
  const models = screen.getByRole("button", { name: /^Models/ });
  assert.equal(models.getAttribute("aria-expanded"), "false");

  assert.equal(
    models.querySelector(".settings-group-summary")?.textContent,
    "All inherit",
  );

  const save = screen.getByRole("button", { name: "Save settings" });
  assert.equal((save as HTMLButtonElement).disabled, true);
  await user.click(screen.getByRole("switch", { name: "Allow subagents" }));
  await user.click(screen.getByRole("switch", { name: "Cost limit" }));
  await user.click(models);

  // Menu options show the server's description as secondary text.
  await user.click(screen.getByRole("combobox", { name: "Global model" }));
  const option = await screen.findByRole("option", { name: /Model A/ });

  assert.equal(
    option.querySelector(".select-item-description")?.textContent,
    "Fast model",
  );

  await user.click(option);

  assert.equal(
    models.querySelector(".settings-group-summary")?.textContent,
    "Global: Model A",
  );

  // One badge per section with edits; the budget counts once.
  assert.deepEqual(
    screen
      .getAllByText(/changed$/, { selector: ".settings-group-badge" })
      .map((b) => b.textContent),
    ["2 changed", "1 changed"],
  );

  await user.click(screen.getByRole("button", { name: "Save 3 changes" }));
  await waitFor(() => assertAbsent(screen.queryByRole("dialog")));

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

test("settings dialog validates hidden budgets, types uncatalogued models, and flags unsupported effort", async (t) => {
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
  await screen.findByRole("dialog");

  // An off limit keeps its amount visible but prevents edits.
  const amount = screen.getByRole("spinbutton", { name: "Cost limit (USD)" });
  assert.ok(amount.closest(".setting-amount")!.hasAttribute("data-off"));
  assert.equal((amount as HTMLInputElement).disabled, true);
  const savedAmount = (amount as HTMLInputElement).value;

  await user.type(amount, "500");
  assert.equal((amount as HTMLInputElement).value, savedAmount);

  assert.equal(
    (screen.getByRole("button", { name: "Save settings" }) as HTMLButtonElement)
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

  await user.click(screen.getByRole("button", { name: /^Models/ }));

  assert.equal(
    screen
      .getByRole("button", { name: /^Budgets/ })
      .getAttribute("aria-expanded"),
    "true",
  );

  // The server flags an unsupported saved effort.
  assert.ok(
    screen.getByText("The saved effort is not supported by this model."),
  );

  // A model without discovered choices is typed.
  await user.type(
    screen.getByRole("textbox", { name: "Researcher model" }),
    "custom-id",
  );

  // Collapse Budgets to verify saving reopens it and focuses an invalid amount.
  await user.click(screen.getByRole("button", { name: /^Budgets/ }));

  assert.equal(
    screen
      .getByRole("button", { name: /^Budgets/ })
      .getAttribute("aria-expanded"),
    "false",
  );

  await user.click(screen.getByRole("button", { name: "Save 2 changes" }));

  assert.equal(
    screen
      .getByRole("button", { name: /^Budgets/ })
      .getAttribute("aria-expanded"),
    "true",
  );

  await waitFor(() => expect(document.activeElement).toBe(amount));

  assert.equal(
    transport.calls.some((call) => call.name === "update_agent_settings"),
    false,
  );

  await user.type(amount, "8");
  await user.click(screen.getByRole("button", { name: "Save 2 changes" }));
  await waitFor(() => assertAbsent(screen.queryByRole("dialog")));

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

test("settings explain invalid disabled budgets and let the user restore editing", async (t) => {
  const { transport, user } = await setup(t, (transport) =>
    serveSettings(transport, {
      values: { max_cost_usd: 5 },
      sections: [{ id: "task", title: "Task", rows: [budgetRow] }],
    }),
  );

  await user.click(screen.getByRole("button", { name: "Settings" }));
  await screen.findByRole("dialog");

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
  await waitFor(() => assertAbsent(screen.queryByRole("dialog")));

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
  await screen.findByRole("dialog");

  const expanded = (name: RegExp) =>
    screen.getByRole("button", { name }).getAttribute("aria-expanded");

  // Links into the open section stay plain text.
  assertAbsent(screen.queryByRole("button", { name: "defaults" }));
  const link = screen.getByRole("button", { name: "profiles" });
  assert.equal(link.getAttribute("title"), "Show in Profiles");

  // A link opens its setting's section and focuses that setting's field.
  await user.click(link);
  assert.equal(expanded(/^Profiles/), "true");
  assert.equal(expanded(/^Defaults/), "false");

  expect(document.activeElement).toBe(
    screen.getByRole("textbox", { name: "reviewer_default model" }),
  );

  assertAbsent(screen.queryByRole("button", { name: "profiles" }));
  await user.click(screen.getByRole("button", { name: "defaults" }));
  assert.equal(expanded(/^Defaults/), "true");

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
  await screen.findByRole("dialog");
  const subagents = screen.getByRole("switch", { name: "Allow subagents" });

  // Resetting Task must preserve another section's saved override and draft.
  await user.click(screen.getByRole("button", { name: /^Models/ }));
  const model = screen.getByRole("textbox", { name: "Global model" });
  await user.clear(model);
  await user.type(model, "draft-model");

  assertAbsent(screen.queryByRole("button", { name: "Reset" }));

  await user.click(
    screen.getAllByRole("button", { name: "Reset to defaults" })[0],
  );

  assert.equal(subagents.getAttribute("aria-checked"), "true");

  assert.equal(
    screen
      .getByRole("switch", { name: "Cost limit" })
      .getAttribute("aria-checked"),
    "true",
  );

  assert.equal(screen.getAllByRole("button", { name: /^Reset/ }).length, 1);

  assert.equal((model as HTMLInputElement).value, "draft-model");

  assert.equal(
    screen.getByRole("combobox", { name: "Global effort" }).textContent,
    "high",
  );

  await user.click(screen.getByRole("button", { name: "Save 3 changes" }));
  await waitFor(() => assertAbsent(screen.queryByRole("dialog")));

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

test("closing settings with unsaved edits asks before discarding them", async (t) => {
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
      if (!this.matches("[data-task]"))
        scrolls.push({ element: this, options });
    },
  });

  t.onTestFinished(() => {
    if (originalMatchMedia)
      Object.defineProperty(window, "matchMedia", originalMatchMedia);
    else delete (window as Partial<Window>).matchMedia;

    if (originalScroll)
      Object.defineProperty(
        HTMLElement.prototype,
        "scrollIntoView",
        originalScroll,
      );
    else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
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
  await screen.findByRole("dialog");

  // Without edits, Cancel closes at once.
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => assertAbsent(screen.queryByRole("dialog")));

  await user.click(screen.getByRole("button", { name: "Settings" }));
  await screen.findByRole("dialog");
  await user.click(screen.getByRole("switch", { name: "Allow subagents" }));

  // Cancel and Escape both ask first; keeping edits leaves them in place.
  await user.click(screen.getByRole("button", { name: "Cancel" }));

  const assertPromptVisible = (behavior: ScrollBehavior = "smooth") => {
    const prompt = screen.getByText("Discard unsaved changes?"),
      notice = prompt.closest(".notice"),
      anchor = prompt.closest(".settings-discard-anchor");

    assert.equal(notice?.getAttribute("data-tone"), "warning");

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Keep editing" }),
    );

    expect(scrolls.at(-1)?.element).toBe(anchor);
    assert.deepEqual(scrolls.at(-1)?.options, { block: "end", behavior });
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

  await user.keyboard("{Escape}");
  assert.ok(screen.getByRole("dialog"));
  assertPromptVisible();
  assert.equal(scrolls.length, 2);
  await user.click(screen.getByRole("button", { name: "Keep editing" }));
  prefersReducedMotion = true;
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  assertPromptVisible("instant");
  assert.equal(scrolls.length, 3);
  await user.click(screen.getByRole("button", { name: "Keep editing" }));
  prefersReducedMotion = false;
  await user.keyboard("{Escape}");
  assertPromptVisible();
  assert.equal(scrolls.length, 4);
  await user.click(screen.getByRole("button", { name: "Discard" }));
  await waitFor(() => assertAbsent(screen.queryByRole("dialog")));

  await user.click(screen.getByRole("button", { name: "Settings" }));
  await screen.findByRole("dialog");

  assert.equal(
    screen
      .getByRole("switch", { name: "Allow subagents" })
      .getAttribute("aria-checked"),
    "true",
  );

  assert.equal(
    (screen.getByRole("button", { name: "Save settings" }) as HTMLButtonElement)
      .disabled,
    true,
  );

  assert.equal(
    transport.calls.some((call) => call.name === "update_agent_settings"),
    false,
  );
});
