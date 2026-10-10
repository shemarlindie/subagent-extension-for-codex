// @vitest-environment jsdom
import assert from "node:assert/strict";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test } from "vitest";

import { TooltipWrapper } from "./tooltip";

test("scrolling closes an open tooltip at once, even inside a nested container", async () => {
  onTestFinished(cleanup);

  const view = render(
    <div data-testid="scroller">
      <TooltipWrapper label="Copy path">
        <button type="button">Copy</button>
      </TooltipWrapper>
    </div>,
  );

  await userEvent.setup().hover(view.getByRole("button"));
  await waitFor(() => assert.ok(screen.queryByRole("tooltip")));

  // Scroll events do not bubble, so this checks the capture listener on the document.
  fireEvent.scroll(view.getByTestId("scroller"));

  expect(screen.queryByRole("tooltip")).toBeNull();
});
