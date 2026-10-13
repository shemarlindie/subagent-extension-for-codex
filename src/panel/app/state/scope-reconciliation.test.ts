import assert from "node:assert/strict";

import { test } from "vitest";

import { defaults } from "./controller-test-harness";
import { initialState } from "./initial-state";
import { projectRemovalReset } from "./scope-reconciliation";
import type { Project, Snapshot } from "./types";

const kept: Project = { repository: "/repo/kept", kind: "repository" };
const gone: Project = { repository: "/repo/gone", kind: "repository" };
const parent: Project = { repository: "/work", kind: "parent" };

function state(patch: Partial<Snapshot>): Snapshot {
  return { ...initialState(), scopeVersion: 3, ...patch };
}

test("removing the panel's project resets its repository", () => {
  assert.equal(
    projectRemovalReset(
      state({ repository: gone.repository }),
      [kept],
      [gone],
      undefined,
    ),
    "repository",
  );

  // A chat scope keeps its repository; the chat chooses it.
  assert.equal(
    projectRemovalReset(
      state({ repository: gone.repository, conversation: "chat" }),
      [kept],
      [gone],
      undefined,
    ),
    undefined,
  );
});

test("an open removal dialog resets the scope once its project is gone", () => {
  const dialog = { kind: "remove-project" as const, project: gone, scope: 3 };

  assert.equal(
    projectRemovalReset(state({ dialog }), [kept], [gone], undefined),
    "scope",
  );

  // A dialog from an older scope is already stale.
  assert.equal(
    projectRemovalReset(
      state({ dialog: { ...dialog, scope: 2 } }),
      [kept],
      [gone],
      undefined,
    ),
    undefined,
  );
});

test("a New Task draft resets the scope when its project loses approval", () => {
  const dialog = {
    kind: "delegate" as const,
    defaults,
    repository: kept.repository,
    revision: "HEAD",
    scope: 3,
  };

  // The draft's project wins over the dialog's.
  assert.equal(
    projectRemovalReset(state({ dialog }), [kept], [gone], gone.repository),
    "scope",
  );

  assert.equal(
    projectRemovalReset(state({ dialog }), [kept], [gone], undefined),
    undefined,
  );

  // A repository inside a removed parent loses approval too, unless still approved.
  assert.equal(
    projectRemovalReset(state({ dialog }), [kept], [parent], "/work/app"),
    "scope",
  );

  assert.equal(
    projectRemovalReset(
      state({ dialog }),
      [kept, { repository: "/work/app", kind: "repository" }],
      [parent],
      "/work/app",
    ),
    undefined,
  );
});
