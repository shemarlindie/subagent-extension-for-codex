// @vitest-environment jsdom
import assert from "node:assert/strict";

import { Tooltip } from "@base-ui/react/tooltip";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { onTestFinished, test, vi } from "vitest";

import { Controller } from "../../app/state/controller";
import { ControllerContext } from "../../app/state/controller-context";
import type { Task, Transport } from "../../app/state/types";
import { ChangesPanel } from "./changes-panel";
import type { Changes, ChangesState } from "./types";

const task: Task = {
  id: "task-1",
  repository: "/repo",
  revision: "HEAD",
  provider: "claude",
  worker_profile: "reviewer",
  title: "Review",
  description: "Review",
  depends_on: [],
  context: [],
  workspace_strategy: "worktree",
  branch: "agent/review",
  workspace: "/repo/worktree",
  budget: { max_runtime_minutes: 20, max_cost_usd: null },
  owner: "owner",
  status: "completed",
  created_at: "",
  updated_at: "",
  instructions: [],
  created_by: "user",
  instructions_sent: 0,
  pending_steers: [],
  queue: [],
  turn: 2,
  runtime_ms: 0,
};

const data: Changes = {
  scope: "task",
  files: [
    {
      path: "src/a.ts",
      status: "modified",
      additions: 1,
      deletions: 1,
      binary: false,
    },
  ],
  additions: 1,
  deletions: 1,
  diff: "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n",
};

const loaded: ChangesState = {
  task: task.id,
  scope: "task",
  key: "completed:2",
  loading: false,
  data,
};

function setup(initial?: ChangesState) {
  onTestFinished(cleanup);

  const controller = new Controller(
    { embedded: true, dispose() {} } as unknown as Transport,
    { hidden: () => false, wide: () => false },
  );

  onTestFinished(() => controller.dispose());

  let snapshot = { ...controller.getSnapshot(), changes: initial };

  vi.spyOn(controller, "getSnapshot").mockImplementation(() => snapshot);

  const panel = () => (
    <ControllerContext.Provider value={controller}>
      <Tooltip.Provider>
        <ChangesPanel task={task} />
      </Tooltip.Provider>
    </ControllerContext.Provider>
  );

  const view = render(panel());

  return {
    view,
    update(changes: ChangesState) {
      snapshot = { ...snapshot, changes };
      view.rerender(panel());
    },
  };
}

test.each([undefined, { ...loaded, data: undefined, loading: true }])(
  "initial reading shows one header progressbar and announces the operation once",
  (changes) => {
    const { view } = setup(changes);
    const progress = view.getByRole("progressbar");

    assert.ok(progress.closest(".changes-header"));
    assert.equal(view.getByRole("status").textContent, "Reading changes…");

    assert.equal(
      view.container
        .querySelector(".changes-content")
        ?.getAttribute("aria-busy"),
      "true",
    );

    assert.equal(view.queryByRole("alert"), null);
  },
);

test("refresh keeps the mounted file and its collapsed state through loading, failure and recovery", async () => {
  const { view, update } = setup(loaded);
  const file = view.container.querySelector<HTMLDetailsElement>(".diff-file");

  assert.ok(file);
  // jsdom has no scrolling.
  file.scrollIntoView = vi.fn();

  await act(async () => {
    file.open = false;
    fireEvent(file, new Event("toggle"));
  });

  assert.equal(file.open, false);

  // A collapsed file whose header was stuck at the top comes back into view.
  assert.deepEqual(vi.mocked(file.scrollIntoView).mock.lastCall, [
    { block: "nearest" },
  ]);

  update({ ...loaded, loading: true });

  assert.equal(view.getAllByRole("progressbar").length, 1);
  assert.equal(view.getByRole("status").textContent, "Refreshing changes…");
  assert.equal(view.container.querySelector(".diff-file"), file);
  assert.equal(file.open, false);

  assert.equal(
    view
      .getByRole("button", { name: "Refresh changes" })
      .hasAttribute("disabled"),
    true,
  );

  update({ ...loaded, error: "Git is temporarily unavailable" });

  assert.match(
    view.getByRole("alert").textContent ?? "",
    /Git is temporarily unavailable/,
  );

  assert.match(view.getByRole("alert").textContent ?? "", /last.*loaded/i);
  assert.equal(view.queryByRole("progressbar"), null);
  assert.equal(view.container.querySelector(".diff-file"), file);
  assert.equal(file.open, false);

  assert.equal(
    view
      .getByRole("button", { name: "Remove worktree" })
      .hasAttribute("disabled"),
    true,
  );

  assert.equal(
    view
      .getByRole("button", { name: "Refresh changes" })
      .hasAttribute("disabled"),
    false,
  );

  update({ ...loaded, data: { ...data } });

  assert.equal(view.container.querySelector(".diff-file"), file);
  assert.equal(file.open, false);
  assert.equal(view.queryByRole("alert"), null);
  assert.equal(view.getByRole("status").textContent, "");

  assert.equal(
    view.container.querySelector(".changes-content")?.getAttribute("aria-busy"),
    "false",
  );
});

test("switching scopes hides old results and a failed initial read stops loading", () => {
  const { view, update } = setup(loaded);

  update({ ...loaded, scope: "turn", loading: true, data: undefined });

  assert.equal(view.container.querySelector(".diff-file"), null);
  assert.equal(view.getAllByRole("progressbar").length, 1);
  assert.equal(view.getByRole("status").textContent, "Reading changes…");

  update({ ...loaded, scope: "turn", data: undefined, error: "Read failed" });

  assert.equal(view.queryByRole("progressbar"), null);
  assert.equal(view.getByRole("alert").textContent, "Read failed");
  assert.equal(view.container.querySelector(".diff-file"), null);
  assert.equal(view.getByRole("status").textContent, "");
});

test("a collapsed file stays collapsed when the tab shows again", async () => {
  const { view, update } = setup(loaded);
  const file = view.container.querySelector<HTMLDetailsElement>(".diff-file");

  assert.ok(file);
  // jsdom has no scrolling.
  file.scrollIntoView = vi.fn();

  await act(async () => {
    file.open = false;
    fireEvent(file, new Event("toggle"));
  });

  // Leaving the tab unmounts the panel; showing it mounts a new one.
  view.rerender(<></>);
  update(loaded);

  const shown = view.container.querySelector<HTMLDetailsElement>(".diff-file");

  assert.notEqual(shown, file);
  assert.equal(shown?.open, false);
});
