import assert from "node:assert/strict";

import { test } from "vitest";

import { settingsDefaults } from "../../../shared/settings/settings-schema";
import type { Worker } from "../../app/state/types";
import {
  type DelegateFormDialog,
  delegateInitialValues,
  delegateTarget,
} from "./delegate-initial-values";

const workers: Worker[] = [
  {
    provider: "claude",
    profiles: ["reviewer", "implementer"],
    capabilities: {},
  },
];

const scope = {
  workers,
  scopeKnown: true,
  repository: "/repo",
  revision: "main",
};

const loading: DelegateFormDialog = {
  kind: "delegate-loading",
  scope: 1,
  request: 1,
  statuses: {
    context: "ready",
    settings: "loading",
    projects: "ready",
    workers: "ready",
  },
};

const initial = settingsDefaults("claude");

const loaded: DelegateFormDialog = {
  kind: "delegate",
  scope: 1,
  repository: "/repo",
  revision: "main",
  defaults: {
    ...initial,
    task: {
      ...initial.task,
      worker_profile: "implementer",
      workspace_strategy: "worktree",
      budget: {
        ...initial.task.budget,
        max_runtime_minutes: { enabled: true, amount: 30 },
      },
    },
  },
};

test("settings-dependent values stay blank while settings load", () => {
  const values = delegateInitialValues({
    dialog: loading,
    scope,
    draft: { runtime: 12, cost: "not a number" },
  });

  assert.equal(values.repository, "/repo");
  assert.equal(values.revision, "");
  assert.equal(values.workspace_strategy, "");
  assert.equal(values.worker, "");
  assert.equal(values.runtimeMode, "");
  assert.equal(values.costMode, "");
  assert.equal(values.reasoning_effort, "");
  // A saved draft's amounts show until settings supply theirs.
  assert.equal(values.runtime, 12);
  assert.equal(values.cost, "");
});

test("the dialog's preferred worker wins, and the current repo uses HEAD", () => {
  const values = delegateInitialValues({
    dialog: {
      ...loaded,
      preferredWorker: "claude:reviewer",
      defaults: {
        ...loaded.defaults,
        task: { ...loaded.defaults.task, workspace_strategy: "current_repo" },
      },
    },
    scope,
    draft: {},
  });

  assert.equal(values.worker, "claude:reviewer");
  assert.equal(values.workspace_strategy, "current_repo");
  assert.equal(values.revision, "HEAD");
});

test("a loading dialog targets the panel scope only once it is known", () => {
  assert.deepEqual(delegateTarget(loading, scope), {
    repository: "/repo",
    revision: "main",
  });

  assert.deepEqual(delegateTarget(loading, { ...scope, scopeKnown: false }), {
    repository: undefined,
    revision: "HEAD",
  });
});
