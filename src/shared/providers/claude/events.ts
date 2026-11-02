import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

type RateLimitMessage = Extract<SDKMessage, { type: "rate_limit_event" }>;

/** The native diagnostic frame retained by Claude-derived project events. */
export type ClaudeRawResponse = SDKMessage;

export type ClaudeRateLimitInfo = RateLimitMessage["rate_limit_info"];

export type ClaudeRateLimitWindowInfo = Pick<
  ClaudeRateLimitInfo,
  "status" | "rateLimitType" | "utilization" | "resetsAt"
>;

/** Validates only the current SDK fields needed to present utilization windows. */
export function decodeClaudeRateLimitWindowInfo(
  value: unknown,
): ClaudeRateLimitWindowInfo | undefined {
  if (!isRecord(value)) return undefined;

  const { status, rateLimitType, utilization, resetsAt } = value;

  if (
    status !== "allowed" &&
    status !== "allowed_warning" &&
    status !== "rejected"
  ) {
    return undefined;
  }

  if (
    rateLimitType !== undefined &&
    rateLimitType !== "five_hour" &&
    rateLimitType !== "seven_day" &&
    rateLimitType !== "seven_day_opus" &&
    rateLimitType !== "seven_day_sonnet" &&
    rateLimitType !== "seven_day_overage_included" &&
    rateLimitType !== "overage"
  ) {
    return undefined;
  }

  if (
    (utilization !== undefined && typeof utilization !== "number") ||
    (resetsAt !== undefined && typeof resetsAt !== "number")
  ) {
    return undefined;
  }

  return {
    status,
    ...(rateLimitType !== undefined ? { rateLimitType } : {}),
    ...(utilization !== undefined ? { utilization } : {}),
    ...(resetsAt !== undefined ? { resetsAt } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
