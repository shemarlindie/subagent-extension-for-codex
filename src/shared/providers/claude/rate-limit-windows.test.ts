import { expect, test } from "vitest";

import type { Event } from "../../events/types.js";
import { activityPresentation } from "../activity/presentation.js";
import { claudeRateLimitWindows } from "./rate-limit-windows.js";

test("unified windows take precedence over duplicate top-level window data", () => {
  expect(
    claudeRateLimitWindows({
      rateLimitType: "five_hour",
      utilization: 0.9,
      resetsAt: 300,
      unifiedWindows: {
        five_hour: { utilization: 0.25, resetsAt: 100 },
        seven_day: { utilization: 0.5, resetsAt: 200 },
      },
    }),
  ).toEqual([
    {
      id: "five_hour",
      label: "5-hour window",
      utilization: 0.25,
      resetsAt: 100,
    },
    {
      id: "seven_day",
      label: "7-day window",
      utilization: 0.5,
      resetsAt: 200,
    },
  ]);
});

test("legacy top-level data supplies a window absent from unified windows", () => {
  expect(
    claudeRateLimitWindows({
      rateLimitType: "five_hour",
      utilization: 0,
      resetsAt: 100,
    }),
  ).toEqual([
    {
      id: "five_hour",
      label: "5-hour window",
      utilization: 0,
      resetsAt: 100,
    },
  ]);

  expect(
    claudeRateLimitWindows({
      rateLimitType: "five_hour",
      utilization: 0.25,
      unifiedWindows: { seven_day: { utilization: 0.5 } },
    }).map((window) => window.id),
  ).toEqual(["seven_day", "five_hour"]);
});

test("missing or invalid utilization and overage entries are excluded", () => {
  expect(
    claudeRateLimitWindows({
      unifiedWindows: {
        five_hour: {},
        seven_day: { utilization: "0.5" },
        seven_day_opus: { utilization: Number.NaN },
        seven_day_sonnet: { utilization: Number.POSITIVE_INFINITY },
        overage: { utilization: 0.5 },
        unknown: null,
      },
    }),
  ).toEqual([]);

  expect(
    claudeRateLimitWindows({ rateLimitType: "overage", utilization: 0.5 }),
  ).toEqual([]);

  expect(claudeRateLimitWindows(null)).toEqual([]);
});

test.each([undefined, "100", Number.NaN, Number.POSITIVE_INFINITY, 1e20])(
  "invalid reset time %s does not discard valid utilization",
  (resetsAt) => {
    expect(
      claudeRateLimitWindows({
        rateLimitType: "five_hour",
        utilization: 0.4,
        resetsAt,
      }),
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
    claudeRateLimitWindows({
      unifiedWindows: {
        seven_day_overage_included: { utilization: 0.8, resetsAt: 0 },
      },
    }),
  ).toEqual([
    {
      id: "seven_day_overage_included",
      label: "7-day included-model window",
      utilization: 0.8,
      resetsAt: 0,
    },
  ]);
});

test("saved rate-limit metadata gains windows without replacing normalized presentation", () => {
  const saved: Event = {
    id: 1,
    task_id: "task",
    timestamp: "2026-10-13T00:00:00.000Z",
    type: "agent.rate_limit_event",
    data: {
      activity: { kind: "rate_limit_event", title: "Rate limit updated" },
      rate_limit_info: { rateLimitType: "five_hour", utilization: 0.25 },
    },
  };

  const presentation = activityPresentation(saved);

  expect(presentation).toEqual({
    kind: "rate_limit_event",
    title: "Rate limit updated",
    rateLimitWindows: [
      {
        id: "five_hour",
        label: "5-hour window",
        utilization: 0.25,
        resetsAt: undefined,
      },
    ],
  });

  expect(saved.data.activity).toEqual({
    kind: "rate_limit_event",
    title: "Rate limit updated",
  });

  const normalized = {
    ...presentation,
    rateLimitWindows: [],
  };

  expect(
    activityPresentation({
      ...saved,
      data: { ...saved.data, activity: normalized },
    }),
  ).toBe(normalized);
});
