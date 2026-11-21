// @vitest-environment jsdom
import assert from "node:assert/strict";

import { act, renderHook } from "@testing-library/react";
import { onTestFinished, test } from "vitest";

import { setRowIcons, useRowIcons } from "./row-icons";

test("row icons show by default, and hiding them lasts to the next load", () => {
  onTestFinished(() => setRowIcons(true));
  const { result } = renderHook(() => useRowIcons());

  assert.equal(result.current, true);
  act(() => setRowIcons(false));

  assert.equal(result.current, false);
  assert.equal(localStorage.getItem("dw_hide_task_row_icons"), "true");

  act(() => setRowIcons(true));

  assert.equal(localStorage.getItem("dw_hide_task_row_icons"), null);
});
