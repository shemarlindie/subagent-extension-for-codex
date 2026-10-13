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
import type { Transport } from "../../app/state/types";
import { CommandLine } from "./command-line";

function replaceClipboard(writeText: (text: string) => Promise<void>) {
  const previous = Object.getOwnPropertyDescriptor(navigator, "clipboard");

  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });

  onTestFinished(() => {
    if (previous) Object.defineProperty(navigator, "clipboard", previous);
    else Reflect.deleteProperty(navigator, "clipboard");
  });
}

function setup(label: string, command: string) {
  onTestFinished(cleanup);

  const controller = new Controller(
    { embedded: true, dispose() {} } as unknown as Transport,
    { hidden: () => false, wide: () => false },
  );

  onTestFinished(() => controller.dispose());

  const panel = (command: string) => (
    <ControllerContext.Provider value={controller}>
      <Tooltip.Provider>
        <CommandLine label={label} command={command} />
      </Tooltip.Provider>
    </ControllerContext.Provider>
  );

  const view = render(panel(command));

  return {
    view,
    controller,
    update: (command: string) => view.rerender(panel(command)),
  };
}

test.each([
  ["Branch", `agent/${"long-branch-name".repeat(40)}`],
  ["Worktree", "cd /worktrees/project with spaces"],
  ["Compare", "git diff abc123...agent/review"],
  ["Push", "git push -u origin agent/review"],
])(
  "embedded panels copy the complete %s value and show compact success feedback",
  async (label, command) => {
    const writeText = vi.fn(async () => {});

    replaceClipboard(writeText);
    const { view } = setup(label, command);

    const button = view.getByRole("button", {
      name: `Copy ${label.toLowerCase()}`,
    });

    assert.equal(button.textContent, "");

    assert.equal(
      view.container.querySelector(".command")?.textContent,
      command,
    );

    fireEvent.click(button);

    await view.findByRole("button", {
      name: `Copy ${label.toLowerCase()} — copied`,
    });

    assert.deepEqual(writeText.mock.calls, [[command]]);
    assert.equal(button.textContent, "");
  },
);

test("a blocked embedded clipboard keeps the copy action available and reports manual-copy guidance", async () => {
  replaceClipboard(async () => {
    throw new Error("Clipboard denied");
  });

  const original = Object.getOwnPropertyDescriptor(document, "execCommand");

  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: () => false,
  });

  onTestFinished(() => {
    if (original) Object.defineProperty(document, "execCommand", original);
    else Reflect.deleteProperty(document, "execCommand");
  });

  const { view, controller } = setup("Branch", "agent/review");
  const report = vi.spyOn(controller, "report");

  fireEvent.click(view.getByRole("button", { name: "Copy branch" }));
  await waitFor(() => assert.equal(report.mock.calls.length, 1));
  const [call] = report.mock.calls;
  assert.ok(call);
  assert.match(String(call[0]), /select.*copy|copy.*manually/i);
  assert.ok(view.getByRole("button", { name: "Copy branch" }));

  expect(
    view.queryByRole("button", { name: "Copy branch — copied" }),
  ).toBeNull();

  expect(document.querySelector("textarea")).toBeNull();
});

test("copying again restarts the feedback duration", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  onTestFinished(() => {
    vi.useRealTimers();
  });

  replaceClipboard(async () => {});
  const { view } = setup("Branch", "agent/review");

  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Copy branch" }));
  });

  act(() => {
    vi.advanceTimersByTime(1000);
  });

  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Copy branch — copied" }));
  });

  act(() => {
    vi.advanceTimersByTime(1000);
  });

  assert.ok(view.getByRole("button", { name: "Copy branch — copied" }));

  act(() => {
    vi.advanceTimersByTime(500);
  });

  assert.ok(view.getByRole("button", { name: "Copy branch" }));
});

test("a new command does not inherit the previous command's copied feedback", async () => {
  replaceClipboard(async () => {});
  const { view, update } = setup("Branch", "agent/old");

  fireEvent.click(view.getByRole("button", { name: "Copy branch" }));
  await view.findByRole("button", { name: "Copy branch — copied" });
  update("agent/new");
  assert.ok(view.getByRole("button", { name: "Copy branch" }));

  expect(
    view.queryByRole("button", { name: "Copy branch — copied" }),
  ).toBeNull();
});

test.each(["success", "failure"])(
  "a pending clipboard %s after unmount adds no feedback timer or error report",
  async (outcome) => {
    let resolve!: () => void;
    let reject!: (error: Error) => void;

    const pending = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });

    replaceClipboard(() => pending);
    const { view, controller } = setup("Branch", "agent/review");
    const report = vi.spyOn(controller, "report");

    fireEvent.click(view.getByRole("button", { name: "Copy branch" }));
    view.unmount();
    const timeout = vi.spyOn(globalThis, "setTimeout");

    await act(async () => {
      if (outcome === "success") resolve();
      else reject(new Error("Clipboard denied"));
    });

    assert.equal(timeout.mock.calls.length, 0);
    assert.equal(report.mock.calls.length, 0);
  },
);
