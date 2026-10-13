import { expect, test } from "vitest";

import { decodedEvent } from "../../events/decode.js";
import type { Event } from "../../events/types.js";
import { activityPresentation } from "../activity/presentation.js";
import {
  type ClaudeRateLimitInfo,
  decodeClaudeRateLimitWindowInfo,
} from "./events.js";
import { claudeRateLimitWindows } from "./rate-limit-windows.js";

const rateLimitInfo = (
  fields: Partial<ClaudeRateLimitInfo> = {},
): ClaudeRateLimitInfo => ({ status: "allowed", ...fields });

test("serialized rate-limit metadata validates current SDK fields", () => {
  expect(
    decodeClaudeRateLimitWindowInfo({
      status: "allowed_warning",
      rateLimitType: "seven_day",
      utilization: 0.75,
      resetsAt: 100,
    }),
  ).toEqual({
    status: "allowed_warning",
    rateLimitType: "seven_day",
    utilization: 0.75,
    resetsAt: 100,
  });

  expect(
    decodeClaudeRateLimitWindowInfo({
      status: "allowed",
      rateLimitType: "future_window",
      utilization: 0.75,
    }),
  ).toBeUndefined();
});

test("current SDK metadata maps its reported window", () => {
  expect(
    claudeRateLimitWindows(
      rateLimitInfo({
        rateLimitType: "five_hour",
        utilization: 0.25,
        resetsAt: 100,
      }),
    ),
  ).toEqual([
    {
      id: "five_hour",
      label: "5-hour window",
      utilization: 0.25,
      resetsAt: 100,
    },
  ]);
});

test("missing windows and overage do not produce utilization windows", () => {
  expect(claudeRateLimitWindows(rateLimitInfo())).toEqual([]);

  expect(
    claudeRateLimitWindows(
      rateLimitInfo({ rateLimitType: "overage", utilization: 0.5 }),
    ),
  ).toEqual([]);
});

test.each([undefined, Number.NaN, Number.POSITIVE_INFINITY, 1e20])(
  "invalid reset time %s does not discard valid utilization",
  (resetsAt) => {
    expect(
      claudeRateLimitWindows(
        rateLimitInfo({
          rateLimitType: "five_hour",
          utilization: 0.4,
          resetsAt,
        }),
      ),
    ).toEqual([
      {
        id: "five_hour",
        label: "5-hour window",
        utilization: 0.4,
        resetsAt: undefined,
      },
    ]);
  },
);

test("included-model windows keep a distinct label and epoch reset time", () => {
  expect(
    claudeRateLimitWindows(
      rateLimitInfo({
        rateLimitType: "seven_day_overage_included",
        utilization: 0.8,
        resetsAt: 0,
      }),
    ),
  ).toEqual([
    {
      id: "seven_day_overage_included",
      label: "7-day included-model window",
      utilization: 0.8,
      resetsAt: 0,
    },
  ]);
});

test("normalized rate-limit presentation exposes its provider windows", () => {
  const saved: Event = decodedEvent({
    id: 1,
    task_id: "task",
    timestamp: "2026-10-13T00:00:00.000Z",
    type: "agent.rate_limit_event",
    data: {
      activity: {
        kind: "rate_limit_event",
        title: "Rate limit updated",
        rateLimitWindows: [
          {
            id: "five_hour",
            label: "5-hour window",
            utilization: 0.25,
          },
        ],
      },
    },
  });

  const presentation = activityPresentation(saved);

  expect(presentation).toEqual({
    kind: "rate_limit_event",
    title: "Rate limit updated",
    rateLimitWindows: [
      {
        id: "five_hour",
        label: "5-hour window",
        utilization: 0.25,
      },
    ],
  });

  expect(saved.data.activity).toEqual(saved.presentation);

  const normalized = {
    ...presentation,
    rateLimitWindows: [],
  };

  const normalizedEvent = decodedEvent({
    ...saved,
    data: { ...saved.data, activity: normalized },
  });

  expect(activityPresentation(normalizedEvent)).toBe(
    normalizedEvent.presentation,
  );
});
