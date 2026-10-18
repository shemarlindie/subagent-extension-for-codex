import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, type TestContext, vi } from "vitest";

import {
  claudeActivityPresentation,
  decodeClaudeActivityContent,
} from "../../../../service/features/providers/claude/events/activity";
import { decodedEvent } from "../../../../shared/events/decode";
import type { Event as ActivityEvent } from "../../../app/state/types";
import { EventDetails as EventList } from "./event-list";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  writable: true,
  value: true,
});

function parseHtml(html: string) {
  return new DOMParser().parseFromString(html, "text/html");
}

/** A trigger's hover tooltip, closed again afterward. */
async function tooltipText(trigger: Element) {
  const user = userEvent.setup();
  await user.hover(trigger);
  const text = (await screen.findByRole("tooltip")).textContent;
  await user.unhover(trigger);
  await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());

  return text;
}

const eventIds = new Map<string, number>();

function normalizeContent(content: unknown) {
  if (content === undefined || typeof content === "string") return content;

  if (Array.isArray(content)) {
    return content.flatMap((value) => {
      const decoded = decodeClaudeActivityContent(value);

      return decoded === undefined ? [] : [decoded];
    });
  }

  return decodeClaudeActivityContent(content);
}

function event(
  type: string,
  data: Record<string, unknown>,
  id = "one",
): ActivityEvent {
  if (!eventIds.has(id)) eventIds.set(id, eventIds.size + 1);

  const messageData =
    type === "agent.message" || type === "agent.content"
      ? {
          role: "assistant",
          ...data,
          ...(type === "agent.content" &&
          data.content === undefined &&
          typeof data.text === "string"
            ? { content: data.text }
            : {}),
        }
      : data;

  const content = messageData.content;

  const normalizedContent = normalizeContent(content);

  const normalizedData =
    content === undefined
      ? messageData
      : { ...messageData, content: normalizedContent };

  return decodedEvent({
    id: eventIds.get(id)!,
    task_id: "task",
    timestamp: "2026-10-02T12:00:00.000Z",
    type,
    data:
      type === "claude.activity" || data.raw_response
        ? {
            ...normalizedData,
            activity: claudeActivityPresentation({
              type,
              data: normalizedData,
            }),
          }
        : normalizedData,
  });
}

// assert.equal(element, null) diffs the whole jsdom object graph on failure,
// which never finishes and starves waitFor's timeout.
function assertAbsent(element: Element | null, message = "Unexpected element") {
  expect(element, message).toBeNull();
}

function markup(events: ActivityEvent[]) {
  const html = renderToStaticMarkup(createElement(EventList, { events }));

  return parseHtml(html);
}

type ScrollSize = { scrollHeight: number; clientHeight: number };

function groupCount(element: HTMLElement) {
  return element.querySelectorAll("[data-activity-id]").length;
}

// jsdom has no layout, so give scroll containers their content and visible heights.
function mockScrollSize(
  size: (element: HTMLElement) => ScrollSize | undefined,
) {
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return size(this)?.scrollHeight ?? 0;
    },
  );

  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return size(this)?.clientHeight ?? 0;
    },
  );
}

// Model real document flow: each activity occupies 100px after the status row,
// and the viewport shows 200px, so its end is at 40 + groups * 100 - 200.
// Reordering, adding or removing DOM nodes changes their measured position automatically.
function mockActivityGeometry() {
  mockScrollSize((element) =>
    element.matches(".activity-viewport")
      ? { scrollHeight: 40 + groupCount(element) * 100, clientHeight: 200 }
      : undefined,
  );

  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      let top = 100;
      let height = 300;

      if (this.matches("[data-activity-id]")) {
        const viewport = this.closest(".activity-viewport") as HTMLElement;

        const groups = Array.from(
          viewport.querySelectorAll("[data-activity-id]"),
        );

        top += 40 + groups.indexOf(this) * 100 - viewport.scrollTop;
        height = 100;
      }

      return {
        top,
        bottom: top + height,
        left: 0,
        right: 400,
        width: 400,
        height,
        x: 0,
        y: top,
        toJSON: () => ({}),
      };
    },
  );
}

/** Replaces a property for one test and restores the original afterward. */
function stubProperty(
  t: TestContext,
  target: object,
  key: PropertyKey,
  value: unknown,
) {
  const previous = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, value });

  t.onTestFinished(() => {
    if (previous) Object.defineProperty(target, key, previous);
    else Reflect.deleteProperty(target, key);
  });
}

function activityMessages(prefix: string, count = 4) {
  return Array.from({ length: count }, (_, i) =>
    event(
      "agent.message",
      { text: `${prefix} message ${i}` },
      `${prefix}-${i}`,
    ),
  );
}

export {
  activityMessages,
  assertAbsent,
  event,
  groupCount,
  markup,
  mockActivityGeometry,
  mockScrollSize,
  parseHtml,
  stubProperty,
  tooltipText,
};
