// @vitest-environment jsdom
import assert from "node:assert/strict";

import { Tooltip } from "@base-ui/react/tooltip";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { expect, onTestFinished, test, vi } from "vitest";

import { Controller } from "../../app/state/controller";
import { ControllerContext } from "../../app/state/controller-context";
import type { Task, Transport } from "../../app/state/types";
import { LOADING_SKELETON_CONFIG } from "../../shared/components/loading-skeleton/loading-skeleton-config";
import { MOTION } from "../../shared/components/motion/motion-utils";
import { getElement } from "../../shared/utils/dom-test-harness";
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
  workspace_strategy: "worktree",
  branch: "agent/review",
  workspace: "/repo/worktree",
  budget: { max_runtime_minutes: 20, max_cost_usd: null },
  owner: "owner",
  status: "completed",
  created_at: "",
  updated_at: "",
  created_by: "user",
  instructions_sent: 0,
  pending_steers: [],
  queue: [],
  turn: 2,
  runtime_ms: 0,
};

const changedFile: Changes["files"][number] = {
  path: "src/a.ts",
  status: "modified",
  additions: 1,
  deletions: 1,
  source: "tool",
  incomplete: false,
};

const data: Changes = {
  scope: "task",
  files: [changedFile],
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

test("keeps the Changes header and content placeholders together through the first-read cross-fade", () => {
  vi.useFakeTimers();

  try {
    const { view, update } = setup();

    act(() => {
      vi.advanceTimersByTime(LOADING_SKELETON_CONFIG.delay);
    });

    expect(view.container.querySelector(".changes-skeleton")).not.toBeNull();

    expect(
      view.container.querySelector(".changes-header-skeleton"),
    ).not.toBeNull();

    update(loaded);

    act(() => {
      vi.advanceTimersByTime(LOADING_SKELETON_CONFIG.minimumVisible);
    });

    expect(view.container.querySelector(".changes-skeleton")).not.toBeNull();

    expect(
      view.container.querySelector(".changes-header-skeleton"),
    ).not.toBeNull();

    expect(view.container.querySelector(".diff-file")).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(MOTION.loadingCrossfade - 1);
    });

    expect(view.container.querySelector(".changes-skeleton")).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(view.container.querySelector(".changes-skeleton")).toBeNull();
    expect(view.container.querySelector(".changes-header-skeleton")).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

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

test("a collapsed file stays collapsed through loading, failure, recovery and a remount", async () => {
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

  // Leaving the tab unmounts the panel; showing it mounts a new one.
  view.rerender(<></>);
  update(loaded);

  const shown = view.container.querySelector<HTMLDetailsElement>(".diff-file");

  expect(shown).not.toBe(file);
  assert.equal(shown?.open, false);
});

test("switching scopes hides old results and a failed initial read stops loading", () => {
  const { view, update } = setup(loaded);

  update({ ...loaded, scope: "turn", loading: true, data: undefined });

  expect(view.container.querySelector(".diff-file")).toBeNull();

  update({ ...loaded, scope: "turn", data: undefined, error: "Read failed" });

  expect(view.queryByRole("progressbar")).toBeNull();
  assert.equal(view.getByRole("alert").textContent, "Read failed");
  expect(view.container.querySelector(".diff-file")).toBeNull();
  assert.equal(view.getByRole("status").textContent, "");
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
      source: "tool",
      incomplete: false,
    },
  ],
  diff:
    data.diff +
    "diff --git a/src/b.ts b/src/b.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/b.ts\n@@ -0,0 +1 @@\n+added\n",
};

test("viewed files stay collapsed across refresh and remount until their changes change", async () => {
  const { view, update } = setup({ ...loaded, data: twoFiles });

  const [file] =
    view.container.querySelectorAll<HTMLDetailsElement>(".diff-file");

  assert.ok(file);

  const toggle = view.getByRole("checkbox", { name: "Viewed src/a.ts" });

  // jsdom has no scrolling.
  file.scrollIntoView = vi.fn();
  assert.equal(file.open, true);

  await act(async () => fireEvent.click(toggle));

  assert.equal(toggle.getAttribute("aria-checked"), "true");
  assert.equal(file.open, false);
  assert.equal(file.dataset.viewed, "true");

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

test("a file missing from the diff still has a section to read and mark", () => {
  // The diff has no part for src/b.ts.
  const { view } = setup({ ...loaded, data: { ...twoFiles, diff: data.diff } });

  const sections = view.container.querySelectorAll(".diff-file");

  const missing = view.container.querySelector<HTMLDetailsElement>(
    '[data-changed-file="src/b.ts"]',
  );

  assert.equal(sections.length, 2);

  assert.match(missing?.textContent ?? "", /Diff unavailable/);
  assert.ok(view.getByRole("checkbox", { name: "Viewed src/b.ts" }));
});

test("picking the last collapsed file finishes its jump after diff rows render", async () => {
  const paths = Array.from({ length: 9 }, (_, index) => `src/file-${index}.ts`);

  const changes: Changes = {
    ...data,
    files: paths.map((path) => ({ ...changedFile, path })),
    diff: paths
      .map(
        (path) =>
          `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+new\n`,
      )
      .join(""),
  };

  const { view } = setup({ ...loaded, data: changes });
  const scroller = getElement<HTMLElement>(view.container, ".changes");

  const last = getElement<HTMLDetailsElement>(
    view.container,
    '[data-changed-file="src/file-8.ts"]',
  );

  scroller.style.overflowY = "auto";
  let scrollTop = 0;

  // The collapsed tail limits scrolling to 900px. Its deferred rows add enough
  // height to reach the last file's header at 1000px.
  Object.defineProperties(scroller, {
    clientHeight: { configurable: true, value: 200 },
    scrollHeight: {
      configurable: true,
      get: () => (last.querySelector(".diff-table") ? 1300 : 1100),
    },
    scrollTop: {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = Math.max(
          0,
          Math.min(value, scroller.scrollHeight - scroller.clientHeight),
        );
      },
    },
  });

  vi.spyOn(scroller, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(0, 0, 500, 200),
  );

  vi.spyOn(last, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(0, 1000 - scrollTop, 500, 100),
  );

  expect(last.open).toBe(false);
  fireEvent.click(view.getByRole("button", { name: "Files" }));

  fireEvent.click(view.getByRole("button", { name: "src/file-8.ts" }));

  await waitFor(() => expect(last.querySelector(".diff-table")).not.toBeNull());
  expect(last.open).toBe(true);
  expect(scroller.scrollTop).toBe(1000);

  // Later manual toggles preserve the reader's new position.
  last.scrollIntoView = vi.fn();
  scroller.scrollTop = 850;

  await act(async () => {
    last.open = false;
    fireEvent(last, new Event("toggle"));
  });

  expect(last.querySelector(".diff-table")).toBeNull();

  await act(async () => {
    last.open = true;
    fireEvent(last, new Event("toggle"));
  });

  await waitFor(() => expect(last.querySelector(".diff-table")).not.toBeNull());
  expect(scroller.scrollTop).toBe(850);
});
