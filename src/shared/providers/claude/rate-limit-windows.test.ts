import { expect, test } from "vitest";

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

test("included-model windows preserve an epoch reset time", () => {
  expect(
    claudeRateLimitWindows(
      rateLimitInfo({
        rateLimitType: "seven_day_overage_included",
        utilization: 0.8,
        resetsAt: 0,
      }),
    ),
  ).toMatchObject([
    {
      id: "seven_day_overage_included",
      utilization: 0.8,
      resetsAt: 0,
    },
  ]);
});
