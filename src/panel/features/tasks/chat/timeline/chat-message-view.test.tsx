// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  writable: true,
  value: true,
});

import { cleanup, render } from "@testing-library/react";

import type { ConversationMessage } from "../../../../../shared/tasks/conversation/messages.js";
import { ChatMessageView } from "./chat-message-view";

afterEach(cleanup);

const message = (from: ConversationMessage["from"]): ConversationMessage => ({
  id: from,
  event_id: 1,
  timestamp: "2026-10-10T00:00:00Z",
  turn: 1,
  from,
  kind: "request",
  text: "**Fix** `a<b>`\n\n- one",
});

test("the parent agent's brief renders as Markdown; the user's text stays literal", () => {
  const parent = render(
    <ChatMessageView message={message("parent")} worker="Claude" />,
  ).container;

  expect(parent.querySelector(".chat-bubble strong")?.textContent).toBe("Fix");
  expect(parent.querySelector(".chat-bubble li")?.textContent).toBe("one");
  cleanup();

  const user = render(
    <ChatMessageView message={message("user")} worker="Claude" />,
  ).container;

  expect(user.querySelector("strong")).toBeNull();

  expect(user.querySelector(".chat-bubble")?.textContent).toBe(
    "**Fix** `a<b>`\n\n- one",
  );
});
