// @vitest-environment jsdom
import assert from "node:assert/strict";

import { Tooltip } from "@base-ui/react/tooltip";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { expect, onTestFinished, test, vi } from "vitest";

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

    expect(view.queryByRole("alert")).toBeNull();
  },
);

test("scrolling changes shows a control that returns to the top", () => {
  const { view } = setup(loaded);
  const scroller = view.container.querySelector<HTMLElement>(".changes");

  assert.ok(scroller);
  scroller.style.overflowY = "auto";

  Object.defineProperties(scroller, {
    scrollHeight: { configurable: true, value: 1000 },
    clientHeight: { configurable: true, value: 200 },
  });

  scroller.scrollTop = 120;
  fireEvent.scroll(scroller);

  const scrollToTop = view.getByRole("button", { name: "Scroll to top" });
  fireEvent.click(scrollToTop);

  assert.equal(scroller.scrollTop, 0);
  expect(view.queryByRole("button", { name: "Scroll to top" })).toBeNull();
});

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
  expect(view.container.querySelector(".diff-file")).toBe(file);
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
  expect(view.queryByRole("progressbar")).toBeNull();
  expect(view.container.querySelector(".diff-file")).toBe(file);
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

  expect(view.container.querySelector(".diff-file")).toBe(file);
  assert.equal(file.open, false);
  expect(view.queryByRole("alert")).toBeNull();
  assert.equal(view.getByRole("status").textContent, "");

  assert.equal(
    view.container.querySelector(".changes-content")?.getAttribute("aria-busy"),
    "false",
  );
});

test("switching scopes hides old results and a failed initial read stops loading", () => {
  const { view, update } = setup(loaded);

  update({ ...loaded, scope: "turn", loading: true, data: undefined });

  expect(view.container.querySelector(".diff-file")).toBeNull();
  assert.equal(view.getAllByRole("progressbar").length, 1);
  assert.equal(view.getByRole("status").textContent, "Reading changes…");

  update({ ...loaded, scope: "turn", data: undefined, error: "Read failed" });

  expect(view.queryByRole("progressbar")).toBeNull();
  assert.equal(view.getByRole("alert").textContent, "Read failed");
  expect(view.container.querySelector(".diff-file")).toBeNull();
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

  expect(shown).not.toBe(file);
  assert.equal(shown?.open, false);
});

const twoFiles: Changes = {
  ...data,
  files: [
    ...data.files,
    {
      path: "src/b.ts",
      status: "added",
      additions: 1,
      deletions: 0,
      binary: false,
    },
  ],
  diff:
    data.diff +
    "diff --git a/src/b.ts b/src/b.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/b.ts\n@@ -0,0 +1 @@\n+added\n",
};

test("marking a file viewed collapses it until its changes change", async () => {
  const { view, update } = setup({ ...loaded, data: twoFiles });

  const [file] =
    view.container.querySelectorAll<HTMLDetailsElement>(".diff-file");

  const toggle = view.getByRole("checkbox", { name: "Viewed src/a.ts" });

  // jsdom has no scrolling.
  file.scrollIntoView = vi.fn();
  assert.equal(file.open, true);

  await act(async () => fireEvent.click(toggle));

  assert.equal(toggle.getAttribute("aria-checked"), "true");
  assert.equal(file.open, false);
  assert.equal(file.dataset.viewed, "true");

  assert.equal(
    view.container.querySelector(".changes-viewed")?.textContent,
    "1 of 2 viewed",
  );

  // A refresh with the same changes keeps the mark.
  update({ ...loaded, data: { ...twoFiles } });
  assert.equal(toggle.getAttribute("aria-checked"), "true");

  const shownFile = () =>
    view.container.querySelector<HTMLDetailsElement>(
      '[data-changed-file="src/a.ts"]',
    );

  // Showing the tab again keeps a viewed file collapsed.
  view.rerender(<></>);
  update({ ...loaded, data: { ...twoFiles } });
  assert.equal(shownFile()?.open, false);

  // Changed since, the file needs reading again, here and after a remount.
  const changed = {
    ...loaded,
    data: { ...twoFiles, diff: twoFiles.diff.replace("+new", "+newer") },
  };

  update(changed);
  assert.equal(shownFile()?.dataset.viewed, "false");
  assert.equal(shownFile()?.open, true);

  view.rerender(<></>);
  update(changed);
  assert.equal(shownFile()?.open, true);
});

test("Preview all resumes at the first file not yet viewed", async () => {
  const { view } = setup({ ...loaded, data: twoFiles });

  const open = vi
    .spyOn(Controller.prototype, "open")
    .mockImplementation(() => {});

  const previewAll = view.getByRole("button", { name: "Preview all changes" });

  fireEvent.click(previewAll);

  assert.deepEqual(open.mock.lastCall?.[0], {
    kind: "file",
    task,
    path: "src/a.ts",
  });

  const [file] =
    view.container.querySelectorAll<HTMLDetailsElement>(".diff-file");

  file.scrollIntoView = vi.fn();

  await act(async () =>
    fireEvent.click(view.getByRole("checkbox", { name: "Viewed src/a.ts" })),
  );

  fireEvent.click(previewAll);

  assert.deepEqual(open.mock.lastCall?.[0], {
    kind: "file",
    task,
    path: "src/b.ts",
  });
});

test("in a long list, a file changed since viewed stays open after a remount", async () => {
  const paths = Array.from({ length: 9 }, (_, index) => `src/${index}.ts`);

  const long = (line: string): Changes => ({
    ...data,
    files: paths.map((path) => ({ ...data.files[0], path })),
    diff: paths
      .map(
        (path) =>
          `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+${line}\n`,
      )
      .join(""),
  });

  const { view, update } = setup({ ...loaded, data: long("new") });

  const first = () =>
    view.container.querySelector<HTMLDetailsElement>(
      '[data-changed-file="src/0.ts"]',
    )!;

  // Past eight files, files start collapsed.
  assert.equal(first().open, false);

  first().scrollIntoView = vi.fn();

  await act(async () =>
    fireEvent.click(view.getByRole("checkbox", { name: "Viewed src/0.ts" })),
  );

  const changed = { ...loaded, data: long("newer") };

  update(changed);
  assert.equal(first().open, true);

  view.rerender(<></>);
  update(changed);
  assert.equal(first().open, true);

  // Unviewed files keep the long list's default.
  assert.equal(
    view.container.querySelector<HTMLDetailsElement>(
      '[data-changed-file="src/1.ts"]',
    )?.open,
    false,
  );
});

test("a file missing from the diff still has a section to read and mark", () => {
  // The diff has no part for src/b.ts.
  const { view } = setup({ ...loaded, data: { ...twoFiles, diff: data.diff } });

  const sections = view.container.querySelectorAll(".diff-file"),
    missing = view.container.querySelector<HTMLDetailsElement>(
      '[data-changed-file="src/b.ts"]',
    );

  assert.equal(sections.length, 2);

  assert.equal(
    view.container.querySelector(".changes-viewed")?.textContent,
    "0 of 2 viewed",
  );

  assert.match(missing?.textContent ?? "", /Diff unavailable/);
  assert.ok(view.getByRole("checkbox", { name: "Viewed src/b.ts" }));
});
