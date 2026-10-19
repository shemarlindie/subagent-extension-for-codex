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

  expect(settled).toHaveBeenCalledExactlyOnceWith(expect.any(Number), {
    outcome: "success",
    ui_timed_out: true,
  });

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

test("a failing observer keeps the call's own response and error", async () => {
  const response = { accepted: true };
  const failure = new Error("Rejected");

  const settled = vi.fn(() => {
    throw new Error("Observer failed");
  });

  await expect(
    boundedRequest(async () => response, "Late", settled),
  ).resolves.toBe(response);

  await expect(
    boundedRequest(() => Promise.reject(failure), "Late", settled),
  ).rejects.toBe(failure);

  expect(settled).toHaveBeenLastCalledWith(expect.any(Number), {
    outcome: "error",
    ui_timed_out: false,
  });
});
