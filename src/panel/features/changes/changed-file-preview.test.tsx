// @vitest-environment jsdom
import assert from "node:assert/strict";

import { Tooltip } from "@base-ui/react/tooltip";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";

import { Controller } from "../../app/state/controller";
import { ControllerContext } from "../../app/state/controller-context";
import type { Task, Transport } from "../../app/state/types";
import { changedFileDialog, ChangedFilePreview } from "./changed-file-preview";
import type { ChangedFileContent, Changes } from "./types";

const task = { id: "task-1" } as Task;

const diffOf = (path: string, line: string) =>
  `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+${line}\n`;

const paths = ["a.ts", "b.ts", "c.ts"];

const data: Changes = {
  scope: "task",
  files: paths.map((path) => ({
    path,
    status: "modified",
    additions: 1,
    deletions: 1,
    binary: false,
  })),
  additions: 3,
  deletions: 3,
  diff: paths.map((path) => diffOf(path, `${path} content`)).join(""),
};

function setup(
  path: string,
  changes: Changes = data,
  conversation: string | undefined = "thread-one",
) {
  onTestFinished(cleanup);

  const controller = new Controller(
    { embedded: true, dispose() {} } as unknown as Transport,
    { hidden: () => false, wide: () => false },
  );

  onTestFinished(() => controller.dispose());

  const initial = controller.getSnapshot(),
    snapshot = {
      ...initial,
      conversation,
      changes: {
        task: task.id,
        scope: "task" as const,
        key: "",
        loading: false,
        data: changes,
      },
    };

  vi.spyOn(controller, "getSnapshot").mockImplementation(() => snapshot);

  // Each file reads as its own content; b.ts never finishes, gone.ts is deleted.
  vi.spyOn(controller, "tool").mockImplementation((async (
    _name: string,
    args: { path: string },
  ) => {
    if (args.path === "b.ts") return new Promise(() => {});

    if (args.path === "gone.ts") {
      return {
        path: args.path,
        state: "deleted",
        size: 0,
      } satisfies ChangedFileContent;
    }

    return {
      path: args.path,
      state: "present",
      size: 0,
      content: `${args.path} content`,
    } satisfies ChangedFileContent;
  }) as typeof controller.tool);

  const show = vi
    .spyOn(controller, "showChangedFile")
    .mockImplementation(() => {});

  const preview = (path: string) => (
    <ControllerContext.Provider value={controller}>
      <Tooltip.Provider>
        <div className="dialog" data-kind="file">
          <div className="dialog-heading">
            <h2>
              {changedFileDialog.title({ kind: "file", task, path, scope: 0 })}
            </h2>
            {/* Mirror DialogHost: views and navigation share the title row. */}
            {changedFileDialog.headingActions?.({
              kind: "file",
              task,
              path,
              scope: 0,
            })}
          </div>
          <ChangedFilePreview task={task} path={path} />
        </div>
      </Tooltip.Provider>
    </ControllerContext.Provider>
  );

  const view = render(preview(path));

  return {
    view,
    show,
    async moveTo(path: string) {
      await act(async () => view.rerender(preview(path)));
    },
  };
}

test("the preview steps through the changed files in order, wrapping at the ends", async () => {
  const { view, show, moveTo } = setup("a.ts");

  await act(async () => {});

  const position = () =>
    view.container.querySelector(".changed-file-position")?.textContent;

  const previous = view.getByRole("button", { name: "Previous file" }),
    next = view.getByRole("button", { name: "Next file" });

  assert.equal(position(), "1 / 3");
  // Back from the first file goes round to the last.
  fireEvent.click(previous);
  assert.deepEqual(show.mock.lastCall, ["c.ts"]);

  fireEvent.click(next);
  assert.deepEqual(show.mock.lastCall, ["b.ts"]);

  // The chosen view carries over to the next file.
  fireEvent.click(view.getByRole("button", { name: "Diff" }));
  await moveTo("b.ts");

  // The last file stays until the next is read, marked as stale.
  const root = view.container.querySelector(".changed-file-preview");

  assert.equal(position(), "2 / 3");
  assert.ok(view.getByRole("progressbar", { name: "Loading b.ts" }));
  assert.equal(root?.getAttribute("data-stale"), "true");
  assert.match(view.container.textContent ?? "", /a\.ts content/);

  await moveTo("c.ts");
  assert.equal(position(), "3 / 3");
  assert.equal(root?.getAttribute("data-stale"), "false");
  assert.match(view.container.textContent ?? "", /c\.ts content/);
  // On from the last file goes round to the first.
  fireEvent.click(next);
  assert.deepEqual(show.mock.lastCall, ["a.ts"]);

  assert.equal(
    view.getByRole("button", { name: "Diff" }).hasAttribute("data-pressed"),
    true,
  );

  fireEvent.click(previous);
  assert.deepEqual(show.mock.lastCall, ["b.ts"]);
});

test("marking a file viewed moves on to the next unread one", async () => {
  const { view, show, moveTo } = setup("a.ts");

  await act(async () => {});

  const toggle = (path: string) =>
    view.getByRole("checkbox", { name: `Viewed ${path}` });

  await act(async () => fireEvent.click(toggle("a.ts")));
  assert.equal(toggle("a.ts").getAttribute("aria-checked"), "true");
  assert.deepEqual(show.mock.lastCall, ["b.ts"]);

  // From the last file, it wraps to the first one still unread.
  await moveTo("c.ts");
  await act(async () => fireEvent.click(toggle("c.ts")));
  assert.deepEqual(show.mock.lastCall, ["b.ts"]);

  // Unmarking stays put.
  const calls = show.mock.calls.length;

  await act(async () => fireEvent.click(toggle("c.ts")));
  assert.equal(toggle("c.ts").getAttribute("aria-checked"), "false");
  assert.equal(show.mock.calls.length, calls);
});

test("moving on from Viewed keeps focus on Viewed, unless the user moved it", async () => {
  // A deleted file among them, so moving on remounts the toolbar.
  const { view, moveTo } = setup("gone.ts", {
    ...data,
    files: [
      ...data.files,
      {
        path: "gone.ts",
        status: "deleted",
        additions: 0,
        deletions: 1,
        binary: false,
      },
    ],
    diff: `${data.diff}diff --git a/gone.ts b/gone.ts\ndeleted file mode 100644\n--- a/gone.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-gone\n`,
  });

  await act(async () => {});

  const toggle = (path: string) =>
      view.getByRole("checkbox", { name: `Viewed ${path}` }),
    // By name, so a failure prints the name rather than the whole element.
    focused = () => document.activeElement?.getAttribute("aria-label");

  toggle("gone.ts").focus();
  await act(async () => fireEvent.click(toggle("gone.ts")));
  await moveTo("c.ts");
  await act(async () => {});
  assert.equal(focused(), "Viewed c.ts");

  // Focus taken to Previous while the next file loads stays there.
  await act(async () => fireEvent.click(toggle("c.ts")));

  const previous = view.getByRole("button", { name: "Previous file" });

  previous.focus();
  await moveTo("a.ts");
  await act(async () => {});
  assert.equal(focused(), "Previous file");
});

test("the view switcher takes the title's place when the file has views", async () => {
  // Plain text outside the loaded changes offers one view, and no Diff.
  const { view, moveTo } = setup("notes.txt");

  await act(async () => {});

  const switcher = () =>
    view.container.querySelector<HTMLElement>(
      ".changed-file-view-switcher-target .view-switch",
    );

  assert.equal(switcher()?.textContent, "Source");

  expect(
    view.container.querySelector(".file-preview-toolbar .view-switch"),
  ).toBeNull();

  assert.ok(
    view.getByRole("button", { name: "Source" }).hasAttribute("data-pressed"),
  );

  // A deleted file has no views, so the title slot contains no switcher.
  await moveTo("gone.ts");
  await act(async () => {});

  assert.match(view.container.textContent ?? "", /Deleted/);
  expect(switcher()).toBeNull();
});

test("view tabs replace the title while Ask Codex and Viewed stay in the toolbar", async () => {
  const { view, moveTo } = setup("a.ts", {
    ...data,
    files: [
      ...data.files,
      {
        path: "gone.ts",
        status: "deleted",
        additions: 0,
        deletions: 1,
        binary: false,
      },
    ],
  });

  const toolbarActions = () =>
    [...view.container.querySelectorAll(".toolbar-actions > button")].map(
      (button) => button.getAttribute("aria-label") ?? button.textContent,
    );

  await act(async () => {});

  const heading = view.container.querySelector<HTMLElement>(
    ".changed-file-heading-actions",
  );

  assert.ok(
    heading?.querySelector(".changed-file-view-switcher-target .view-switch"),
  );

  assert.ok(heading?.querySelector(".changed-file-nav"));

  expect(
    heading?.lastElementChild?.querySelector(
      '[aria-label="File preview options"]',
    ),
  ).not.toBeNull();

  assert.deepEqual(toolbarActions(), [
    "Ask Codex about this file",
    "Viewed a.ts",
  ]);

  // A deleted file still keeps its actions in the toolbar.
  await moveTo("gone.ts");

  expect(
    heading?.querySelector(".changed-file-view-switcher-target .view-switch"),
  ).toBeNull();

  assert.deepEqual(toolbarActions(), [
    "Ask Codex about this file",
    "Viewed gone.ts",
  ]);
});

test("a lone changed file shows its position without step buttons", async () => {
  const { view } = setup("a.ts", { ...data, files: data.files.slice(0, 1) });

  await act(async () => {});

  assert.equal(
    view.container.querySelector(".changed-file-position")?.textContent,
    "1 / 1",
  );

  // Counted, not compared: a failing compare of elements exhausts memory.
  assert.equal(view.container.querySelectorAll(".changed-file-step").length, 0);

  expect(
    view.getByRole("button", { name: "File preview options" }),
  ).toBeTruthy();
});

test("the options menu toggles wrapping and keeps the choice across views and files", async () => {
  const { view, moveTo } = setup("a.ts"),
    user = userEvent.setup();

  await act(async () => {});

  const options = view.getByRole("button", { name: "File preview options" }),
    next = view.getByRole("button", { name: "Next file" }),
    wrapping = () =>
      view.container
        .querySelector(".file-preview")
        ?.getAttribute("data-wrap-lines");

  expect(
    next.compareDocumentPosition(options) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();

  // Wrapping is off by default.
  expect(wrapping()).toBe("false");

  await user.click(options);

  const toggle = await view.findByRole("menuitemcheckbox", {
    name: "Wrap lines",
  });

  expect(toggle.getAttribute("aria-checked")).toBe("false");
  const indicator = toggle.querySelector(".file-preview-option-check");
  expect(indicator?.hasAttribute("data-unchecked")).toBe(true);

  await user.click(toggle);
  expect(wrapping()).toBe("true");
  expect(toggle.getAttribute("aria-checked")).toBe("true");
  expect(toggle.querySelector(".file-preview-option-check")).toBe(indicator);
  expect(indicator?.hasAttribute("data-unchecked")).toBe(false);
  await user.keyboard("{Escape}");
  expect(document.activeElement).toBe(options);

  await user.click(view.getByRole("button", { name: "Diff" }));
  expect(wrapping()).toBe("true");
  await moveTo("b.ts");
  expect(wrapping()).toBe("true");
  await moveTo("c.ts");
  expect(wrapping()).toBe("true");
  await moveTo("gone.ts");
  expect(wrapping()).toBe("true");

  options.focus();
  await user.keyboard("{ArrowDown}");
  await view.findByRole("menuitemcheckbox", { name: "Wrap lines" });
  await user.keyboard("{Enter}");
  expect(wrapping()).toBe("false");
});

test("global mode omits the file handoff from the preview toolbar", async () => {
  const { view } = setup("a.ts", data, "");
  await act(async () => {});
  expect(view.container.querySelector(".file-action-label")).toBeNull();
  assert.ok(view.container.querySelector('[aria-label="Viewed a.ts"]'));
});

test("does not reuse another task's preview when the path matches", async () => {
  let resolveFirst!: (file: ChangedFileContent) => void,
    resolveSecond!: (file: ChangedFileContent) => void;

  const reads = new Map([
    [
      "task-a",
      new Promise<ChangedFileContent>((resolve) => (resolveFirst = resolve)),
    ],
    [
      "task-b",
      new Promise<ChangedFileContent>((resolve) => (resolveSecond = resolve)),
    ],
  ]);

  const controller = new Controller(
    {
      embedded: true,
      async tool<T>(_name: string, args: Record<string, unknown>) {
        return (await reads.get(String(args.task_id))) as T;
      },
      dispose() {},
    } as unknown as Transport,
    { hidden: () => false, wide: () => false },
  );

  onTestFinished(cleanup);
  onTestFinished(() => controller.dispose());

  const panel = (id: string) => (
    <ControllerContext.Provider value={controller}>
      <ChangedFilePreview task={{ ...task, id }} path="src/shared.txt" />
    </ControllerContext.Provider>
  );

  const view = render(panel("task-a"));

  await act(async () =>
    resolveFirst({
      path: "src/shared.txt",
      state: "present",
      size: 15,
      content: "Task A content",
    }),
  );

  expect(view.container.textContent).toContain("Task A content");

  view.rerender(panel("task-b"));

  expect(
    view.getByRole("status", { name: "Loading file preview" }),
  ).toBeTruthy();

  expect(view.container.querySelector(".loading-spinner")).not.toBeNull();
  expect(view.container.querySelector(".skeleton-shape")).toBeNull();

  expect(view.container.textContent).not.toContain("Task A content");

  await act(async () =>
    resolveSecond({
      path: "src/shared.txt",
      state: "present",
      size: 15,
      content: "Task B content",
    }),
  );

  expect(view.container.textContent).toContain("Task B content");

  expect(
    view.queryByRole("status", { name: "Loading file preview" }),
  ).toBeNull();
});
