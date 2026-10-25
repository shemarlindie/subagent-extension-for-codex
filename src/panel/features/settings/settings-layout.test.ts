import assert from "node:assert/strict";

import { test } from "vitest";

import {
  activeSection,
  changes,
  editCount,
  onKey,
  rowForm,
  sectionsForm,
  type SettingRow,
  type SettingSection,
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

const taskSection: SettingSection = {
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
};

const modelsSection: SettingSection = {
  id: "models",
  title: "Models",
  rows: [models],
};

const sections = [taskSection, modelsSection];

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

  assert.equal(editCount(taskSection, edited, initial), 1);
  assert.equal(editCount(modelsSection, edited, initial), 1);
});

test("saved section selection falls back to a valid section", () => {
  assert.equal(activeSection("models", sections), "models");
  assert.equal(activeSection("gone", sections), "task");
  assert.equal(activeSection("gone", []), undefined);
});
