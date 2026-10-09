// @vitest-environment jsdom
import assert from "node:assert/strict";

import { Tooltip } from "@base-ui/react/tooltip";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { onTestFinished, test, vi } from "vitest";

import { Controller } from "../../app/state/controller";
import { ControllerContext } from "../../app/state/controller-context";
import type { Task, Transport } from "../../app/state/types";
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

function setup(path: string) {
  onTestFinished(cleanup);

  const controller = new Controller(
    { embedded: true, dispose() {} } as unknown as Transport,
    { hidden: () => false, wide: () => false },
  );

  onTestFinished(() => controller.dispose());

  const snapshot = {
    ...controller.getSnapshot(),
    changes: {
      task: task.id,
      scope: "task" as const,
      key: "",
      loading: false,
      data,
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

  const preview = (path: string) => (
    <ControllerContext.Provider value={controller}>
      <Tooltip.Provider>
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

test("marking a file viewed from its preview counts it", async () => {
  const { view } = setup("a.ts");

  await act(async () => {});

  const toggle = view.getByRole("checkbox", { name: "Viewed a.ts" });

  assert.equal(
    view.container.querySelector(".changed-file-viewed-count")?.textContent,
    "0 of 3 viewed",
  );

  await act(async () => fireEvent.click(toggle));

  assert.equal(toggle.getAttribute("aria-checked"), "true");

  assert.equal(
    view.container.querySelector(".changed-file-viewed-count")?.textContent,
    "1 of 3 viewed",
  );
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
