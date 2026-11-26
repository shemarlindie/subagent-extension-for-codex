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
import { parseFileDiff } from "./changed-files";
import { ChangesPanel } from "./changes-panel";
import type {
  ChangeList,
  ChangesState,
  FileDiff,
  FileDiffsState,
  ListedChange,
} from "./types";

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

const changedFile: ListedChange = {
  path: "src/a.ts",
  status: "modified",
  additions: 1,
  deletions: 1,
  source: "tool",
  incomplete: false,
  signature: "a1",
};

const data: ChangeList = {
  scope: "task",
  files: [changedFile],
  additions: 1,
  deletions: 1,
  revision: "r1",
};

const modified = (path: string, line = "new") =>
  `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+${line}\n`;

/** The diffs read for a list, each ready unless given as a read state. */
function diffs(
  list: ChangeList,
  files: Record<string, string | FileDiff>,
): FileDiffsState {
  return {
    task: task.id,
    scope: list.scope,
    revision: list.revision,
    files: new Map(
      Object.entries(files).map(([path, diff]) => [
        path,
        typeof diff === "string"
          ? { status: "ready", diff: parseFileDiff(diff) }
          : diff,
      ]),
    ),
  };
}

const readDiffs = diffs(data, { "src/a.ts": modified("src/a.ts") });

const loaded: ChangesState = {
  task: task.id,
  scope: "task",
  key: "completed:2",
  loading: false,
  data,
};

function setup(initial?: ChangesState, changeDiffs = readDiffs) {
  onTestFinished(cleanup);

  const controller = new Controller(
    { embedded: true, dispose() {} } as unknown as Transport,
    { hidden: () => false, wide: () => false },
  );

  onTestFinished(() => controller.dispose());

  let snapshot = { ...controller.getSnapshot(), changes: initial, changeDiffs };

  vi.spyOn(controller, "getSnapshot").mockImplementation(() => snapshot);

  const loadDiff = vi
    .spyOn(controller.changes, "loadDiff")
    .mockResolvedValue(undefined);

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
    loadDiff,
    update(changes: ChangesState, changeDiffs = snapshot.changeDiffs) {
      snapshot = { ...snapshot, changes, changeDiffs };
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

const twoFiles: ChangeList = {
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
      signature: "b1",
    },
  ],
};

const twoDiffs = diffs(twoFiles, {
  "src/a.ts": modified("src/a.ts"),
  "src/b.ts":
    "diff --git a/src/b.ts b/src/b.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/b.ts\n@@ -0,0 +1 @@\n+added\n",
});

test("viewed files stay collapsed and unread across refresh and remount until their changes change", async () => {
  const { view, update, loadDiff } = setup(
    { ...loaded, data: twoFiles },
    twoDiffs,
  );

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

  // Showing the tab again keeps a viewed file collapsed, without reading it.
  view.rerender(<></>);
  loadDiff.mockClear();
  const unread = diffs(twoFiles, {});
  update({ ...loaded, data: { ...twoFiles } }, unread);
  assert.equal(shownFile()?.open, false);
  expect(loadDiff.mock.calls).toEqual([["src/b.ts"]]);

  // Changed since, the file needs reading again, here and after a remount.
  const changedList = {
    ...twoFiles,
    revision: "r2",
    files: twoFiles.files.map((file) =>
      file.path === "src/a.ts" ? { ...file, signature: "a2" } : file,
    ),
  };

  const changed = { ...loaded, data: changedList };
  const changedDiffs = diffs(changedList, {});

  update(changed, changedDiffs);
  assert.equal(shownFile()?.dataset.viewed, "false");
  assert.equal(shownFile()?.open, true);
  expect(loadDiff).toHaveBeenLastCalledWith("src/a.ts");

  view.rerender(<></>);
  update(changed, changedDiffs);
  assert.equal(shownFile()?.open, true);
});

test("a long list shows every file at once and reads a diff only when its file opens", async () => {
  const paths = Array.from({ length: 9 }, (_, index) => `src/file-${index}.ts`);

  const list: ChangeList = {
    ...data,
    files: paths.map((path) => ({ ...changedFile, path })),
  };

  const { view, update, loadDiff } = setup(
    { ...loaded, data: list },
    diffs(list, {}),
  );

  const section = (path: string) =>
    getElement<HTMLDetailsElement>(
      view.container,
      `[data-changed-file="${path}"]`,
    );

  expect(view.container.querySelectorAll(".diff-file")).toHaveLength(9);
  expect(loadDiff.mock.calls).toEqual([["src/file-0.ts"]]);

  update(
    { ...loaded, data: list },
    diffs(list, { "src/file-0.ts": { status: "loading" } }),
  );

  expect(
    view.getByRole("progressbar", { name: "Loading src/file-0.ts" }),
  ).toBeTruthy();

  update(
    { ...loaded, data: list },
    diffs(list, {
      "src/file-0.ts": { status: "error", error: "Read failed" },
    }),
  );

  assert.equal(view.getByRole("alert").textContent, "Read failed");
  fireEvent.click(view.getByRole("button", { name: "Retry" }));
  expect(loadDiff).toHaveBeenLastCalledWith("src/file-0.ts");

  const third = section("src/file-3.ts");

  await act(async () => {
    third.open = true;
    fireEvent(third, new Event("toggle"));
  });

  expect(loadDiff).toHaveBeenLastCalledWith("src/file-3.ts");

  update(
    { ...loaded, data: list },
    diffs(list, { "src/file-3.ts": modified("src/file-3.ts") }),
  );

  await waitFor(() =>
    expect(third.querySelector(".diff-row.add")?.textContent).toContain("new"),
  );
});

test("picking a file whose diff read fails scrolls to its Retry", async () => {
  const paths = Array.from({ length: 9 }, (_, index) => `src/file-${index}.ts`);

  const list: ChangeList = {
    ...data,
    files: paths.map((path) => ({ ...changedFile, path })),
  };

  const { view, update, loadDiff } = setup(
    { ...loaded, data: list },
    diffs(list, {}),
  );

  const scroller = getElement<HTMLElement>(view.container, ".changes");

  const last = getElement<HTMLDetailsElement>(
    view.container,
    '[data-changed-file="src/file-8.ts"]',
  );

  scroller.style.overflowY = "auto";
  let scrollTop = 0;

  Object.defineProperties(scroller, {
    clientHeight: { configurable: true, value: 200 },
    scrollHeight: { configurable: true, value: 2000 },
    scrollTop: {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => (scrollTop = value),
    },
  });

  vi.spyOn(scroller, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(0, 0, 500, 200),
  );

  vi.spyOn(last, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(0, 1000 - scrollTop, 500, 100),
  );

  fireEvent.click(view.getByRole("button", { name: "Files" }));
  fireEvent.click(view.getByRole("button", { name: "src/file-8.ts" }));

  await waitFor(() =>
    expect(loadDiff).toHaveBeenLastCalledWith("src/file-8.ts"),
  );

  expect(scroller.scrollTop).toBe(0);

  update(
    { ...loaded, data: list },
    diffs(list, {
      "src/file-8.ts": { status: "error", error: "Read failed" },
    }),
  );

  await waitFor(() => expect(scroller.scrollTop).toBe(1000));
  assert.ok(last.contains(view.getByRole("button", { name: "Retry" })));
});

test("a diff that can't be parsed still has a section to read and mark", () => {
  const { view } = setup(
    { ...loaded, data: twoFiles },
    diffs(twoFiles, {
      "src/a.ts": modified("src/a.ts"),
      "src/b.ts": { status: "ready" },
    }),
  );

  const missing = view.container.querySelector<HTMLDetailsElement>(
    '[data-changed-file="src/b.ts"]',
  );

  assert.equal(view.container.querySelectorAll(".diff-file").length, 2);
  assert.match(missing?.textContent ?? "", /Diff unavailable/);
  assert.ok(view.getByRole("checkbox", { name: "Viewed src/b.ts" }));
});

test("picking the last collapsed file finishes its jump after its diff is read and its rows render", async () => {
  const paths = Array.from({ length: 9 }, (_, index) => `src/file-${index}.ts`);

  const changes: ChangeList = {
    ...data,
    files: paths.map((path) => ({ ...changedFile, path })),
  };

  const { view, update, loadDiff } = setup(
    { ...loaded, data: changes },
    diffs(changes, {}),
  );

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

  await waitFor(() =>
    expect(loadDiff).toHaveBeenLastCalledWith("src/file-8.ts"),
  );

  expect(last.querySelector(".diff-table")).toBeNull();
  expect(scroller.scrollTop).toBe(0);

  update(
    { ...loaded, data: changes },
    diffs(changes, { "src/file-8.ts": modified("src/file-8.ts") }),
  );

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
