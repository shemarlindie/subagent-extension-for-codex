// @vitest-environment jsdom
import { Tooltip } from "@base-ui/react/tooltip";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import type { ChatVisual } from "../../../../../shared/tasks/conversation/chat.js";
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

test("the menu saves the visual as a page, notes a host that can't save, and copies the latest code", async () => {
  const files: File[] = [];
  let result: SaveResult = "saved";

  const controller = {
    transport: {
      saveFile: async (file: File) => {
        files.push(file);

        return result;
      },
    },
    report: vi.fn(),
  } as unknown as Controller;

  const menu = (visual: ChatVisual) => (
    <ControllerContext.Provider value={controller}>
      <Tooltip.Provider>
        <VisualMenu item={visual} />
      </Tooltip.Provider>
    </ControllerContext.Provider>
  );

  const { rerender } = render(menu(item));
  const user = userEvent.setup();

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
  rerender(menu(latest));
  expect(screen.queryByRole("alert")).toBeNull();

  await choose("Copy code");
  expect(await navigator.clipboard.readText()).toBe(latest.code);
  expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
});
