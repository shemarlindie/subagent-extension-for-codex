import assert from "node:assert/strict";

import { test } from "vitest";

import {
  activeSection,
  changes,
  editCount,
  rowForm,
  sectionsForm,
  type SettingRow,
  type SettingSection,
} from "./settings-layout";

const budget: SettingRow = {
  kind: "budget",
  path: "task.budget.max_cost_usd",
  label: "Cost limit",
  unit: "USD",
  min: 0.01,
};

const models: SettingRow = {
  kind: "models",
  scopes: [
    {
      id: "global",
      label: "Global",
      model: {
        path: "models.global.model",
        label: "Global model",
        options: [
          { value: "", label: "Inherit" },
          { value: "sonnet", label: "Sonnet" },
        ],
      },
      effort: {
        path: "models.global.reasoning_effort",
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

const taskSection: SettingSection = {
  id: "task",
  title: "Task",
  rows: [
    {
      kind: "select",
      path: "task.workspace_strategy",
      label: "Workspace",
      options: [
        { value: "current_repo", label: "Project folder" },
        { value: "worktree", label: "Isolated worktree" },
      ],
    },
    {
      kind: "switch",
      path: "providers.claude.subagents",
      label: "Allow subagents",
    },
    budget,
  ],
};

const modelsSection: SettingSection = {
  id: "models",
  title: "Models",
  rows: [models],
};

const sections = [taskSection, modelsSection];

const saved = {
  task: {
    workspace_strategy: "current_repo",
    budget: { max_cost_usd: { enabled: false, amount: 7 } },
  },
  providers: { claude: { subagents: true } },
  models: { global: { model: "", reasoning_effort: "default" } },
};

// Form fields are flat. Each name is its path with dots replaced.
const field = {
  workspace: "task-workspace_strategy",
  subagents: "providers-claude-subagents",
  costOn: "task-budget-max_cost_usd-enabled",
  cost: "task-budget-max_cost_usd-amount",
  model: "models-global-model",
  effort: "models-global-reasoning_effort",
};

test("form state holds strings, and a limit that is off keeps its amount", () => {
  assert.deepEqual(sectionsForm(sections, saved), {
    [field.workspace]: "current_repo",
    [field.subagents]: "true",
    [field.costOn]: "false",
    [field.cost]: "7",
    [field.model]: "",
    [field.effort]: "default",
  });

  assert.deepEqual(
    rowForm(budget, {
      task: { budget: { max_cost_usd: { enabled: true, amount: 3 } } },
    }),
    { [field.costOn]: "true", [field.cost]: "3" },
  );
});

test("updates hold only edits, typed and nested, with budgets as switch and amount", () => {
  const initial = sectionsForm(sections, saved);
  assert.deepEqual(changes(sections, initial, initial), {});

  // Turning a limit on keeps its saved amount.
  assert.deepEqual(
    changes(
      sections,
      {
        ...initial,
        [field.subagents]: "false",
        [field.costOn]: "true",
        [field.model]: "sonnet",
      },
      initial,
    ),
    {
      providers: { claude: { subagents: false } },
      task: { budget: { max_cost_usd: { enabled: true } } },
      models: { global: { model: "sonnet" } },
    },
  );

  // Changing only the amount while off keeps the limit off.
  assert.deepEqual(
    changes(sections, { ...initial, [field.cost]: "9" }, initial),
    { task: { budget: { max_cost_usd: { amount: 9 } } } },
  );

  // Clearing the amount keeps the saved one.
  assert.deepEqual(
    changes(sections, { ...initial, [field.cost]: "" }, initial),
    {},
  );
});

test("edit counts treat a budget and a model scope as one row each", () => {
  const initial = sectionsForm(sections, saved);

  const edited = {
    ...initial,
    [field.cost]: "9",
    [field.costOn]: "true",
    [field.model]: "sonnet",
    [field.effort]: "high",
  };

  assert.equal(editCount(taskSection, edited, initial), 1);
  assert.equal(editCount(modelsSection, edited, initial), 1);
});

test("saved section selection falls back to a valid section", () => {
  assert.equal(activeSection("models", sections), "models");
  assert.equal(activeSection("gone", sections), "task");
  assert.equal(activeSection("gone", []), undefined);
});
