// @vitest-environment jsdom
import { Tooltip } from "@base-ui/react/tooltip";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import type { ChatVisual } from "../../../../../core/shared/tasks/conversation/chat.js";
import type { Controller } from "../../../../app/state/controller";
import { ControllerContext } from "../../../../app/state/controller-context";
import type { SaveResult } from "../../../../app/state/types";
import { VisualMenu } from "./visual-menu";

afterEach(cleanup);

const item: ChatVisual = {
  kind: "visual",
  id: "visual-2",
  event_id: 1,
  timestamp: "",
  visual: 2,
  title: "Monthly signups",
  code: "<svg><text>Jan</text></svg>",
};

/** Renders the menu with the host's save, and rerenders it with a version. */
function renderMenu(
  saveFile: (file: File) => Promise<SaveResult>,
  visual: ChatVisual = item,
) {
  const controller = {
    transport: { saveFile },
    report: vi.fn(),
  } as unknown as Controller;

  const menu = (next: ChatVisual) => (
    <ControllerContext.Provider value={controller}>
      <Tooltip.Provider>
        <VisualMenu item={next} />
      </Tooltip.Provider>
    </ControllerContext.Provider>
  );

  const { rerender } = render(menu(visual));

  return {
    rerender: (next: ChatVisual) => rerender(menu(next)),
    user: userEvent.setup(),
  };
}

test("the menu saves the visual as a page, notes a host that can't save, and copies the latest code", async () => {
  const files: File[] = [];
  let result: SaveResult = "saved";

  const { rerender, user } = renderMenu(async (file) => {
    files.push(file);

    return result;
  });

  const choose = async (name: string) => {
    await user.click(screen.getByRole("button", { name: /Download|Copied/ }));
    await user.click(await screen.findByRole("menuitem", { name }));
  };

  await choose("Download HTML page");
  expect(files[0]?.name).toBe("monthly-signups.html");
  expect(files[0]?.type).toBe("text/html");
  expect(await files[0]?.text()).toContain(item.code);

  // A cancelled dialog looks like a refusal, so neither shows anything.
  result = "declined";
  await choose("Download HTML page");
  expect(screen.queryByRole("alert")).toBeNull();

  result = "unsupported";
  await choose("Download HTML page");

  expect((await screen.findByRole("alert")).textContent).toBe(
    "This host can't save files.",
  );

  const latest = { ...item, code: "<svg><text>Feb</text></svg>" };
  rerender(latest);
  expect(screen.queryByRole("alert")).toBeNull();

  await choose("Copy code");
  expect(await navigator.clipboard.readText()).toBe(latest.code);
  expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
});

test("an open menu offers a PNG when the current version can draw one", async () => {
  const sized = {
    ...item,
    code: '<svg viewBox="0 0 4 2"><text>Jan</text></svg>',
  };

  const { rerender, user } = renderMenu(vi.fn(), sized);
  await user.click(screen.getByRole("button", { name: /Download/ }));
  await screen.findByRole("menuitem", { name: /PNG/ });

  rerender(item);
  expect(screen.queryByRole("menuitem", { name: /PNG/ })).toBeNull();
  expect(screen.getByRole("menuitem", { name: /HTML/ })).toBeTruthy();

  rerender(sized);
  expect(await screen.findByRole("menuitem", { name: /PNG/ })).toBeTruthy();
});

test("a save that finishes after a later one leaves the later outcome in place", async () => {
  const pending: ((result: SaveResult) => void)[] = [];

  const { rerender, user } = renderMenu(
    () => new Promise<SaveResult>((resolve) => pending.push(resolve)),
  );

  const save = async () => {
    await user.click(screen.getByRole("button", { name: /Download/ }));

    await user.click(
      await screen.findByRole("menuitem", { name: "Download HTML page" }),
    );
  };

  await save();
  rerender({ ...item, code: "<svg><text>Feb</text></svg>" });
  await save();
  await act(async () => pending[1]?.("unsupported"));
  await act(async () => pending[0]?.("unsupported"));

  expect(screen.getByRole("alert").textContent).toBe(
    "This host can't save files.",
  );
});
