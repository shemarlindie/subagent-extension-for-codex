import { expect, onTestFinished, test, vi } from "vitest";

import { deferred, flush } from "../../../app/state/controller-test-harness";
import { boundedRequest } from "./bounded-request";

test("a stalled send reports uncertain delivery without cancelling its write", async () => {
  vi.useFakeTimers();

  onTestFinished(() => {
    vi.useRealTimers();
  });

  const write = deferred<string>();
  const settled = vi.fn();

  const request = boundedRequest(
    () => write.promise,
    "Delivery could not be confirmed",
    settled,
    25,
  );

  const failure = expect(request).rejects.toThrow(
    "Delivery could not be confirmed",
  );

  await vi.advanceTimersByTimeAsync(25);
  await failure;
  expect(settled).not.toHaveBeenCalled();

  write.resolve("private message text");
  await flush();

  expect(settled).toHaveBeenCalledExactlyOnceWith(expect.any(Number));
  expect(vi.getTimerCount()).toBe(0);
});

test("an acknowledged send returns its response and clears the deadline", async () => {
  vi.useFakeTimers();

  onTestFinished(() => {
    vi.useRealTimers();
  });

  const response = { accepted: true };

  await expect(
    boundedRequest(
      async () => response,
      "Late",
      () => {},
    ),
  ).resolves.toBe(response);

  expect(vi.getTimerCount()).toBe(0);
});
