import assert from "node:assert/strict";

import { test } from "vitest";

import {
  changes,
  editCount,
  onKey,
  openSections,
  rowForm,
  sectionKeys,
  sectionsForm,
  type SettingRow,
  type SettingSection,
  summary,
} from "./settings-layout";

const budget: SettingRow = {
  kind: "budget",
  key: "max_cost_usd",
  toggle: "use_cost_budget",
  label: "Cost limit",
  unit: "USD",
  min: 0.01,
  amount: 7,
};

const models: SettingRow = {
  kind: "models",
  scopes: [
    {
      label: "Global",
      model: {
        key: "default_model",
        label: "Global model",
        options: [
          { value: "", label: "Inherit" },
          { value: "sonnet", label: "Sonnet" },
        ],
      },
      effort: {
        key: "default_reasoning_effort",
        label: "Global reasoning effort",
        options: [
          { value: "default", label: "Inherit" },
          { value: "high", label: "high" },
        ],
        unsupported: false,
      },
    },
  ],
};

const sections: SettingSection[] = [
  {
    id: "task",
    title: "Task",
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
      { kind: "switch", key: "claude_subagents", label: "Allow subagents" },
      budget,
    ],
  },
  { id: "models", title: "Models", rows: [models] },
];

const saved = {
  default_workspace_strategy: "current_repo",
  claude_subagents: true,
  max_cost_usd: null,
  default_model: "",
  default_reasoning_effort: "default",
};

test("form state holds strings, and a limit that is off keeps its amount", () => {
  assert.deepEqual(sectionsForm(sections, saved), {
    default_workspace_strategy: "current_repo",
    claude_subagents: "true",
    max_cost_usd: "7",
    [onKey("max_cost_usd")]: "false",
    default_model: "",
    default_reasoning_effort: "default",
  });

  assert.deepEqual(rowForm(budget, { max_cost_usd: 3 }), {
    max_cost_usd: "3",
    [onKey("max_cost_usd")]: "true",
  });

  assert.deepEqual(sectionKeys(sections[1]), [
    "default_model",
    "default_reasoning_effort",
  ]);
});

test("updates hold only edits, typed, with budgets sent as switch and amount", () => {
  const initial = sectionsForm(sections, saved);
  assert.deepEqual(changes(sections, initial, initial), {});

  // Turning a limit on sends its amount too, even when the amount is unchanged.
  assert.deepEqual(
    changes(
      sections,
      {
        ...initial,
        claude_subagents: "false",
        [onKey("max_cost_usd")]: "true",
        default_model: "sonnet",
      },
      initial,
    ),
    {
      claude_subagents: false,
      use_cost_budget: true,
      max_cost_usd: 7,
      default_model: "sonnet",
    },
  );

  // Changing only the amount while off keeps the limit off.
  assert.deepEqual(
    changes(sections, { ...initial, max_cost_usd: "9" }, initial),
    { max_cost_usd: 9 },
  );

  // Clearing the amount while off keeps the saved one.
  assert.deepEqual(
    changes(sections, { ...initial, max_cost_usd: "" }, initial),
    {},
  );
});

test("edit counts treat a budget and a model scope as one row each", () => {
  const initial = sectionsForm(sections, saved);

  const edited = {
    ...initial,
    max_cost_usd: "9",
    [onKey("max_cost_usd")]: "true",
    default_model: "sonnet",
    default_reasoning_effort: "high",
  };

  assert.equal(editCount(sections[0], edited, initial), 1);
  assert.equal(editCount(sections[1], edited, initial), 1);
});

test("summaries use option labels, units, and only model overrides", () => {
  const form = sectionsForm(sections, saved);

  assert.deepEqual(
    sections[0].rows.flatMap((row) => summary(row, form)),
    ["Current repository", "On", "No limit"],
  );

  assert.deepEqual(
    summary(budget, { ...form, [onKey("max_cost_usd")]: "true" }),
    ["7 USD"],
  );

  assert.deepEqual(summary(models, form), ["All inherit"]);

  assert.deepEqual(
    summary(models, {
      ...form,
      default_model: "sonnet",
      default_reasoning_effort: "high",
    }),
    ["Global: Sonnet, high effort"],
  );
});

test("text rows send their string as typed and summarize a blank value", () => {
  const prefix: SettingRow = {
    kind: "text",
    key: "worktree_branch_prefix",
    label: "Worktree branch prefix",
    maxLength: 100,
    pattern: "[\\w./-]*",
  };

  const text: SettingSection[] = [
      { id: "task", title: "Task", rows: [prefix] },
    ],
    initial = sectionsForm(text, { worktree_branch_prefix: "agent/" });

  assert.deepEqual(initial, { worktree_branch_prefix: "agent/" });

  assert.deepEqual(changes(text, { worktree_branch_prefix: "" }, initial), {
    worktree_branch_prefix: "",
  });

  assert.deepEqual(summary(prefix, initial), ["agent/"]);
  assert.deepEqual(summary(prefix, { worktree_branch_prefix: "" }), ["None"]);
});

test("open sections fall back to the first when none exists, but may all be closed", () => {
  assert.deepEqual(openSections(["models"], sections), ["models"]);
  assert.deepEqual(openSections(["gone"], sections), ["task"]);
  assert.deepEqual(openSections([], sections), []);
});
