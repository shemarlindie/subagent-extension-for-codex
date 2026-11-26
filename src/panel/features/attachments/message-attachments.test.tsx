// @vitest-environment jsdom
import { cleanup, render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";

import type { MessageAttachment } from "../../../shared/attachments/model.js";
import { Controller } from "../../app/state/controller";
import { ControllerContext } from "../../app/state/controller-context";
import type { Transport } from "../../app/state/types";
import { MessageAttachments } from "./message-attachments";

const note = (position: number): MessageAttachment => ({
  message_id: "request",
  position,
  title: `Note ${position}`,
  summary: `Summary ${position}.`,
  format: "text",
  source: "inline",
  chars: 1,
  lines: 1,
});

/** jsdom has no layout or CSS: chips are 100px, labels 120px, the row 310px and gaps 0. */
function stubLayout() {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      if (this.matches("[data-chip]")) return { width: 100 } as DOMRect;

      return { width: this.matches("[data-label]") ? 120 : 0 } as DOMRect;
    },
  );

  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(310);
}

test("a chip opens its stored file in a host that opens files", async () => {
  onTestFinished(cleanup);
  const openFile = vi.fn(async (_path: string) => {});
  const tool = vi.fn(async () => ({ path: "/data/attachments/task/a.pdf" }));

  const controller = new Controller(
    { embedded: true, dispose() {}, tool, openFile } as unknown as Transport,
    { hidden: () => false, wide: () => false },
  );

  onTestFinished(() => controller.dispose());

  (controller as unknown as { patch(patch: object): void }).patch({
    host: { ...controller.getSnapshot().host, canOpenFiles: true },
  });

  const view = render(
    <ControllerContext.Provider value={controller}>
      <MessageAttachments taskId="task" attachments={[note(2)]} />
    </ControllerContext.Provider>,
  );

  await userEvent.setup().click(view.getByRole("button", { name: /^Note 2/ }));

  expect(tool).toHaveBeenCalledWith(
    "app_get_attachment_path",
    { task_id: "task", message_id: "request", position: 2 },
    undefined,
  );

  await vi.waitFor(() =>
    expect(openFile).toHaveBeenCalledWith("/data/attachments/task/a.pdf"),
  );

  expect(controller.getSnapshot().dialog).toBeUndefined();
});

test("hidden chips fold behind a toggle that keeps focus as the row expands and collapses", async () => {
  onTestFinished(cleanup);
  stubLayout();

  const controller = new Controller(
    { embedded: true, dispose() {} } as unknown as Transport,
    { hidden: () => false, wide: () => false },
  );

  onTestFinished(() => controller.dispose());
  const attachments = [1, 2, 3, 4].map(note);

  const view = render(
    <ControllerContext.Provider value={controller}>
      <MessageAttachments taskId="task" attachments={attachments} />
    </ControllerContext.Provider>,
  );

  const row = within(view.getByRole("group", { name: "Attachments" }));

  const chips = () => row.getAllByRole("button", { name: /^Note/ });

  expect(chips()).toHaveLength(1);

  expect(chips()[0]).toBe(
    row.getByRole("button", { name: "Note 1, 1 line. Summary 1." }),
  );

  const toggle = row.getByRole("button", { name: "Show 3 more attachments" });

  const user = userEvent.setup();
  await user.tab();
  await user.tab();
  expect(document.activeElement).toBe(toggle);

  await user.keyboard("{Enter}");
  expect(chips()).toHaveLength(4);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(document.activeElement).toBe(toggle);

  await user.keyboard("{Enter}");
  expect(chips()).toHaveLength(1);
  expect(document.activeElement).toBe(toggle);
});
