// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { ChatSkeleton } from "./chat-skeleton";

afterEach(cleanup);

test("shapes the user prompt as a bubble and the worker reply as plain lines", () => {
  const view = render(<ChatSkeleton />);
  const user = view.container.querySelector('[data-side="user"]');
  const worker = view.container.querySelector('[data-side="worker"]');

  expect(user?.querySelector(".chat-skeleton-bubble")).not.toBeNull();
  expect(user?.querySelectorAll(".skeleton-shape")).toHaveLength(3);
  expect(worker?.querySelector(".chat-skeleton-bubble")).toBeNull();
  expect(worker?.querySelector(".chat-skeleton-worker-text")).not.toBeNull();
  expect(worker?.querySelectorAll(".skeleton-shape")).toHaveLength(5);

  const richReply = view.container.querySelectorAll('[data-side="worker"]')[2];

  expect(
    richReply?.querySelector(".chat-skeleton-rich-heading"),
  ).not.toBeNull();

  expect(
    richReply?.querySelectorAll(".chat-skeleton-rich-list-item"),
  ).toHaveLength(3);
});
