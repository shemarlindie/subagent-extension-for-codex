import assert from "node:assert/strict";

import { test } from "vitest";

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

const loaded: DelegateFormDialog = {
  kind: "delegate",
  scope: 1,
  repository: "/repo",
  revision: "main",
  defaults: {
    default_provider: "claude",
    default_worker_profile: "implementer",
    default_workspace_strategy: "worktree",
    max_runtime_minutes: 30,
    max_cost_usd: null,
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

test("loaded settings choose the default worker, workspace and budgets", () => {
  const values = delegateInitialValues({ dialog: loaded, scope, draft: {} });

  assert.equal(values.worker, "claude:implementer");
  assert.equal(values.workspace_strategy, "worktree");
  assert.equal(values.revision, "main");
  assert.equal(values.runtimeMode, "limited");
  assert.equal(values.runtime, 30);
  assert.equal(values.costMode, "none");
  assert.equal(values.reasoning_effort, "default");
});

test("the dialog's preferred worker wins, and the current repo uses HEAD", () => {
  const values = delegateInitialValues({
    dialog: {
      ...loaded,
      preferredWorker: "claude:reviewer",
      defaults: { ...loaded.defaults, default_workspace_strategy: undefined },
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
