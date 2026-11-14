import assert from "node:assert/strict";

import { describe, expect, it } from "vitest";

import type { ModelScope, SettingSection } from "../settings-layout";
import { settingsSearch } from "./settings-search";

const runtime = {
  kind: "budget",
  label: "Runtime limit",
  path: "task.budget.max_runtime_minutes",
  unit: "mins",
  min: 0.01,
} as const;

const task: SettingSection = {
  id: "task",
  title: "Task defaults",
  rows: [runtime],
};

const researcher: ModelScope = {
  id: "researcher",
  label: "Researcher",
  model: {
    path: "models.profiles.researcher.model",
    label: "Researcher model",
  },
  effort: {
    path: "models.profiles.researcher.reasoning_effort",
    label: "Researcher reasoning",
    options: [],
    unsupported: false,
  },
  instructions: {
    path: "profiles.researcher.instructions",
    label: "Researcher custom instructions",
    maxLength: 4000,
  },
};

const profiles: SettingSection = {
  id: "profiles",
  title: "Worker profiles",
  help: ["Model defaults apply to all profiles."],
  rows: [{ kind: "models", scopes: [researcher] }],
};

describe("settings search matching", () => {
  it("requires every query word and ignores blank queries", () => {
    expect(
      settingsSearch("runtime task").rowMatch(task, runtime),
    ).toBeDefined();

    expect(
      settingsSearch("timeout banana").rowMatch(task, runtime),
    ).toBeUndefined();

    expect(settingsSearch("  ").active).toBe(false);
  });

  it("finds budget subfield paths and the words within paths", () => {
    expect(
      settingsSearch("task.budget.max_runtime_minutes.amount").rowMatch(
        task,
        runtime,
      ),
    ).toBeDefined();

    expect(
      settingsSearch("runtime minutes").rowMatch(task, runtime),
    ).toBeDefined();
  });

  it("ranks direct labels ahead of descriptions, choices and section context", () => {
    const row = {
      kind: "select" as const,
      path: "task.worker_profile",
      label: "Worker profile",
      help: ["Pick a researcher."],
      options: [{ value: "researcher", label: "Researcher" }],
    };

    const choice = { ...row, help: [] };

    const section: SettingSection = {
      id: "researcher",
      title: "Researcher defaults",
      rows: [],
    };

    const search = settingsSearch("researcher");

    const labelled = search.rowMatch(section, { ...row, label: "Researcher" });
    const unlabelled = search.rowMatch(section, { ...row, options: [] });
    const plain = search.rowMatch(section, { ...choice, options: [] });
    const chosen = search.rowMatch(section, choice);
    assert.ok(labelled && unlabelled && plain && chosen);

    expect(labelled.score).toBeLessThan(unlabelled.score);
    expect(plain.score).toBeGreaterThan(chosen.score);
  });

  it("finds a read-only facts section as one result", () => {
    const policy: SettingSection = {
      id: "organization-policy",
      title: "Organization policy",
      facts: [
        { label: "Hooks", detail: "Only managed hooks run." },
        { label: "Models", detail: "Limited to opus." },
      ],
      rows: [],
    };

    for (const query of ["policy", "hooks", "opus"]) {
      expect(settingsSearch(query).sectionMatches(policy)).toHaveLength(1);
    }

    expect(settingsSearch("runtime").sectionMatches(policy)).toHaveLength(0);

    expect(
      settingsSearch("policy").sectionMatches({ ...policy, facts: [] }),
    ).toHaveLength(1);
  });

  it("keeps instructions closed for model and profile name queries", () => {
    expect(
      settingsSearch("model").scopeMatch(profiles, researcher)
        ?.expandInstructions,
    ).toBe(false);

    expect(
      settingsSearch("researcher").scopeMatch(profiles, researcher)
        ?.expandInstructions,
    ).toBe(false);
  });
});
