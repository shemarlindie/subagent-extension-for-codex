import { expect, test, vi } from "vitest";

import { withCleanup } from "./capture-cleanup";

test("preserves the recording error when cleanup also fails", async () => {
  const error = new Error("Action failed");
  const cleanup = vi.fn(() => Promise.reject(new Error("Target closed")));

  await expect(withCleanup(() => Promise.reject(error), cleanup)).rejects.toBe(
    error,
  );

  expect(cleanup).toHaveBeenCalledOnce();
});

test("reports a cleanup failure after a successful recording", async () => {
  const error = new Error("Target closed");

  await expect(
    withCleanup(
      () => Promise.resolve("recording"),
      () => Promise.reject(error),
    ),
  ).rejects.toBe(error);
});
