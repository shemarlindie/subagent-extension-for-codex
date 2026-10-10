// @vitest-environment jsdom
import assert from "node:assert/strict";

import { Tooltip } from "@base-ui/react/tooltip";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { onTestFinished, test, vi } from "vitest";

import { Controller } from "../../app/state/controller";
import { ControllerContext } from "../../app/state/controller-context";
import type { Task, Transport } from "../../app/state/types";
import { ChangedFileNav } from "./changed-file-nav";
import { ChangedFilePreview } from "./changed-file-preview";
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

function setup(path: string, changes: Changes = data) {
  onTestFinished(cleanup);

  const controller = new Controller(
    { embedded: true, dispose() {} } as unknown as Transport,
    { hidden: () => false, wide: () => false },
  );

  onTestFinished(() => controller.dispose());

  const initial = controller.getSnapshot(),
    snapshot = {
      ...initial,
      host: { ...initial.host, canShare: true },
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
  ) =>
    args.path === "b.ts"
      ? new Promise(() => {})
      : args.path === "gone.ts"
        ? ({
            path: args.path,
            state: "deleted",
            size: 0,
          } satisfies ChangedFileContent)
        : ({
            path: args.path,
            state: "present",
            size: 0,
            content: `${args.path} content`,
          } satisfies ChangedFileContent)) as typeof controller.tool);

  const show = vi
    .spyOn(controller, "showChangedFile")
    .mockImplementation(() => {});

  vi.spyOn(controller, "share").mockResolvedValue(undefined);

  const preview = (path: string) => (
    <ControllerContext.Provider value={controller}>
      <Tooltip.Provider>
        {/* As the dialog places them: the nav in its title row. */}
        <ChangedFileNav task={task} path={path} />
        <ChangedFilePreview task={task} path={path} />
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

test("the preview steps through the changed files in order", async () => {
  const { view, show, moveTo } = setup("a.ts");

  await act(async () => {});

  const position = () =>
    view.container.querySelector(".changed-file-position")?.textContent;

  const previous = view.getByRole("button", { name: "Previous file" }),
    next = view.getByRole("button", { name: "Next file" });

  assert.equal(position(), "1 / 3");
  // Still focusable at the ends, so stepping there doesn't drop focus.
  assert.equal(previous.getAttribute("aria-disabled"), "true");
  fireEvent.click(previous);
  assert.equal(show.mock.calls.length, 0);

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
  assert.equal(next.getAttribute("aria-disabled"), "true");

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

test("every file holds the view switcher's place, so the toolbar keeps its shape", async () => {
  // Plain text outside the loaded changes offers one view, and no Diff.
  const { view, moveTo } = setup("notes.txt");

  await act(async () => {});

  const switcher = () =>
    view.container.querySelector<HTMLElement>(
      ".file-preview-toolbar .view-switch",
    );

  assert.equal(switcher()?.textContent, "Source");

  assert.ok(
    view.getByRole("button", { name: "Source" }).hasAttribute("data-pressed"),
  );

  // A deleted file has no views; a hidden stand-in takes the switcher's place.
  await moveTo("gone.ts");
  await act(async () => {});

  assert.match(view.container.textContent ?? "", /Deleted/);
  assert.ok(switcher()?.classList.contains("view-switch-placeholder"));
  assert.equal(switcher()?.getAttribute("aria-hidden"), "true");
});

test("the toolbar starts with Ask Codex and ends with Viewed", async () => {
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

  const actions = () =>
    [...view.container.querySelectorAll(".toolbar-actions > button")].map(
      (button) => button.getAttribute("aria-label") ?? button.textContent,
    );

  await act(async () => {});
  assert.deepEqual(actions(), ["Ask Codex about this file", "Viewed a.ts"]);

  // A deleted file's toolbar keeps the same order.
  await moveTo("gone.ts");
  assert.deepEqual(actions(), ["Ask Codex about this file", "Viewed gone.ts"]);
});

test("sharing one file doesn't mark the next one shared", async () => {
  const { view, moveTo } = setup("a.ts");

  await act(async () => {});

  await act(async () =>
    fireEvent.click(
      view.getByRole("button", { name: "Ask Codex about this file" }),
    ),
  );

  assert.ok(view.getByRole("button", { name: "Shared with Codex" }));

  await moveTo("c.ts");
  assert.ok(view.getByRole("button", { name: "Ask Codex about this file" }));
});
