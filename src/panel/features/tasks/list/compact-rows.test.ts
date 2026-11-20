// @vitest-environment jsdom
import assert from "node:assert/strict";

import { act, renderHook } from "@testing-library/react";
import { onTestFinished, test } from "vitest";

import { setCompactRows, useCompactRows } from "./compact-rows";

test("compact rows apply at once and are saved for the next load", () => {
  onTestFinished(() => setCompactRows(false));
  const { result } = renderHook(() => useCompactRows());

  assert.equal(result.current, false);
  act(() => setCompactRows(true));

  assert.equal(result.current, true);
  assert.equal(localStorage.getItem("dw_compact_task_rows"), "true");

  act(() => setCompactRows(false));

  assert.equal(localStorage.getItem("dw_compact_task_rows"), null);
});
