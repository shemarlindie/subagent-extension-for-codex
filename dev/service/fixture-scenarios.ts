import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

export type FixtureStreamFrame = Extract<
  SDKMessage,
  { type: "stream_event" }
>["event"]["type"];

const sdkStreamFrames: Record<FixtureStreamFrame, true> = {
  message_start: true,
  content_block_start: true,
  content_block_delta: true,
  content_block_stop: true,
  message_delta: true,
  message_stop: true,
};

export const fixtureStreamFrameTypes = Object.keys(
  sdkStreamFrames,
) as FixtureStreamFrame[];

interface FixtureActivityScenario {
  type: string;
  fields: Record<string, unknown>;
}

interface FixtureStreamScenario {
  frame: FixtureStreamFrame;
  fields: Record<string, unknown>;
}

export interface FixtureContentScenario {
  role: "user" | "assistant";
  kind: string;
  outcome?: string;
  name?: string;
  fields?: Record<string, unknown>;
}

export interface FixtureScenarios {
  questionCount: number;
  permissionTools: string[];
  assistantErrors: string[];
  toolNames: string[];
  toolErrorNames: string[];
  subagent: boolean;
  content: FixtureContentScenario[];
  thinking: boolean;
  subagentCount: number;
  subagentOutcome: string;
  fail: boolean;
  change: boolean;
  slow: boolean;
  late: boolean;
  waitMs?: number;
  costUsd?: number;
  completionSubtype?: string;
  completionIsError: boolean;
  failStage?: string;
  invalidateSession: boolean;
  streamLifecycle: boolean;
  activities: FixtureActivityScenario[];
  streams: FixtureStreamScenario[];
  restrictions: string[];
}

const defaultScenarios = (): FixtureScenarios => ({
  questionCount: 0,
  permissionTools: [],
  assistantErrors: [],
  toolNames: [],
  toolErrorNames: [],
  subagent: false,
  content: [],
  thinking: false,
  subagentCount: 0,
  subagentOutcome: "success",
  fail: false,
  change: false,
  slow: false,
  late: false,
  completionIsError: false,
  invalidateSession: false,
  streamLifecycle: false,
  activities: [],
  streams: [],
  restrictions: [],
});

function parseValue(value: string): unknown {
  let decoded = value;

  try {
    decoded = decodeURIComponent(value);
  } catch {}

  if (decoded === "true") return true;
  if (decoded === "false") return false;
  if (decoded === "null") return null;

  const number = Number(decoded);
  if (decoded.trim() && Number.isFinite(number)) return number;

  if (decoded.startsWith("{") || decoded.startsWith("[")) {
    try {
      return JSON.parse(decoded);
    } catch {}
  }

  return decoded;
}

function parseFields(value: string) {
  const fields: Record<string, unknown> = {};
  const expression = /(?:^|\s)([A-Za-z][A-Za-z0-9_.-]*)=([^\s]+)/g;

  for (const [, key, raw] of value.matchAll(expression)) {
    if (["__proto__", "prototype", "constructor"].includes(key)) continue;
    fields[key] = parseValue(raw);
  }

  return fields;
}

function field(fields: Record<string, unknown>, key: string) {
  const value = fields[key];

  if (value === undefined) return undefined;
  if (typeof value === "string") return value;

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value);
}

function scenarioCount(fields: Record<string, unknown>, fallback = 1) {
  const count = Number(field(fields, "count") ?? fallback);

  return Number.isSafeInteger(count)
    ? Math.max(1, Math.min(count, 5))
    : fallback;
}

export function safeToolName(value: string | undefined, fallback: string) {
  return value && /^[A-Za-z][A-Za-z0-9_-]{0,49}$/.test(value)
    ? value
    : fallback;
}

/** Parse explicit scenario keys while preserving the original short test markers. */
export function readScenarios(prompt: string): FixtureScenarios {
  const scenarios = defaultScenarios();
  const markers = prompt.matchAll(/\[fixture:([^\]]+)\]/gi);

  for (const [, raw] of markers) {
    const marker = raw.trim();
    const [head, ...rest] = marker.split(/\s+/);
    let kind = head;
    const args = parseFields(rest.join(" "));

    // Preserve the original compact forms while supporting named arguments.
    if (/^wait=/.test(head)) {
      kind = "wait";
      args.ms = parseValue(head.slice("wait=".length));
    } else if (/^cost=/.test(head)) {
      kind = "cost";
      args.usd = parseValue(head.slice("cost=".length));
    }

    if (kind === "question" || kind === "input") {
      scenarios.questionCount += scenarioCount(args);
    } else if (kind === "permission") {
      scenarios.permissionTools.push(
        ...Array.from({ length: scenarioCount(args) }, () =>
          safeToolName(field(args, "tool"), "Bash"),
        ),
      );
    } else if (kind === "assistant-error") {
      scenarios.assistantErrors.push(field(args, "type") ?? "unknown");
    } else if (kind === "tool-error") {
      scenarios.toolErrorNames.push(
        ...Array.from({ length: scenarioCount(args) }, () =>
          safeToolName(field(args, "name"), "Read"),
        ),
      );
    } else if (kind === "tool") {
      scenarios.toolNames.push(
        ...Array.from({ length: scenarioCount(args) }, () =>
          safeToolName(field(args, "name"), "Read"),
        ),
      );
    } else if (kind === "subagent") {
      scenarios.subagent = true;
      scenarios.subagentCount = Math.min(scenarioCount(args), 4);
      scenarios.subagentOutcome = field(args, "outcome") ?? "success";
    } else if (kind === "content") {
      const fields = Object.fromEntries(
        Object.entries(args).filter(
          ([key]) => !["role", "type", "outcome", "name"].includes(key),
        ),
      );

      scenarios.content.push({
        role: field(args, "role") === "user" ? "user" : "assistant",
        kind: field(args, "type") ?? "text",
        outcome: field(args, "outcome"),
        name: field(args, "name"),
        ...(Object.keys(fields).length ? { fields } : {}),
      });
    } else if (kind === "thinking") {
      scenarios.thinking = true;
    } else if (kind === "change") {
      scenarios.change = true;
    } else if (kind === "fail") {
      scenarios.fail = true;
      scenarios.failStage = field(args, "stage") ?? "complete";
    } else if (kind === "completion") {
      scenarios.completionSubtype =
        field(args, "subtype") ?? "error_during_execution";

      scenarios.completionIsError =
        field(args, "is_error") === "true" ||
        field(args, "outcome") === "error";
    } else if (kind === "slow") {
      scenarios.slow = true;
    } else if (kind === "late") {
      scenarios.late = true;
    } else if (kind === "session" && field(args, "state") === "invalid") {
      scenarios.invalidateSession = true;
    } else if (kind === "restriction") {
      const name = field(args, "name");

      if (name && /^[A-Za-z][A-Za-z0-9_-]{0,49}$/.test(name)) {
        scenarios.restrictions.push(name);
      }
    } else if (kind === "activity") {
      const type = field(args, "type");

      if (type && /^[A-Za-z][A-Za-z0-9_.-]{0,99}$/.test(type)) {
        scenarios.activities.push({
          type,
          fields: Object.fromEntries(
            Object.entries(args).filter(([key]) => key !== "type"),
          ),
        });
      }
    } else if (kind === "stream") {
      const frame = field(args, "frame") ?? "content_block_delta";

      if (Object.keys(args).length === 0) {
        scenarios.streamLifecycle = true;
      } else if (
        fixtureStreamFrameTypes.includes(frame as FixtureStreamFrame)
      ) {
        scenarios.streams.push({
          frame: frame as FixtureStreamFrame,
          fields: Object.fromEntries(
            Object.entries(args).filter(([key]) => key !== "frame"),
          ),
        });
      }
    } else if (kind === "wait") {
      const value = Number(field(args, "ms") ?? 0);

      if (Number.isSafeInteger(value) && value >= 0) {
        scenarios.waitMs = Math.min(value, 60_000);
      }
    } else if (kind === "cost") {
      const value = Number(field(args, "usd") ?? 0);

      if (Number.isFinite(value) && value >= 0) {
        scenarios.costUsd = Math.min(value, 1_000_000);
      }
    }
  }

  // Existing tests and demo instructions can continue using these concise keys.
  if (prompt.includes("[input]")) {
    scenarios.questionCount = Math.max(scenarios.questionCount, 1);
  }

  scenarios.fail ||= prompt.includes("[fail]");
  scenarios.slow ||= prompt.includes("[slow]");
  scenarios.late ||= prompt.includes("[late]");

  return scenarios;
}
