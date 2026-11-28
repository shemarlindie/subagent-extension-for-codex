import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";

import { errorCategory } from "./error-metadata.js";
import { JsonlWriter } from "./jsonl-writer.js";

type Fields = Record<string, string | number | boolean | undefined>;

type Level = "debug" | "info" | "warn" | "error";

const levels: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const context = new AsyncLocalStorage<Fields>();
let writer: JsonlWriter | undefined;
let threshold: Level = "info";
let instanceId = randomUUID();
let secrets: string[] = [];

export function configureLogging(
  path: string | undefined,
  level: string = "info",
) {
  if (!Object.hasOwn(levels, level)) {
    throw new Error("Log level must be debug, info, warn or error");
  }

  writer = path ? new JsonlWriter(path) : undefined;
  threshold = level as Level;
  instanceId = randomUUID();
  secrets = [];
}

/** Exact configured credentials also get removed from otherwise curated metadata. */
export function setLogSecrets(values: (string | undefined)[]) {
  secrets = values.filter((value): value is string => !!value);
}

function safeText(value: string) {
  let result = value;

  for (const secret of secrets) {
    result = result.replaceAll(secret, "[redacted]");
  }

  return result.replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]").slice(0, 512);
}

export function withLogContext<T>(
  fields: Fields,
  run: () => T,
  options: { inherit?: boolean } = {},
): T {
  return context.run(
    {
      ...(options.inherit === false ? undefined : context.getStore()),
      ...fields,
    },
    run,
  );
}

/**
 * Lets other structured files join service records: the logger's instance ID
 * and the current HTTP request's service-generated ID, when there is one.
 */
export function logCorrelation() {
  const requestId = context.getStore()?.request_id;

  return {
    instance_id: instanceId,
    ...(typeof requestId === "string" ? { request_id: requestId } : {}),
  };
}

/** Only curated scalar metadata belongs here. Never pass bodies, prompts or credentials. */
export function logEvent(level: Level, event: string, fields: Fields = {}) {
  if (!writer || levels[level] < levels[threshold]) return;

  const safe = Object.fromEntries(
    Object.entries({ ...context.getStore(), ...fields }).map(([key, value]) => {
      if (
        /token|secret|password|authorization|cookie|prompt|body/i.test(key) &&
        !(
          typeof value === "number" &&
          [
            "input_tokens",
            "output_tokens",
            "cache_read_tokens",
            "cache_creation_tokens",
          ].includes(key)
        )
      ) {
        return [key, "[redacted]"];
      }

      return [key, typeof value === "string" ? safeText(value) : value];
    }),
  );

  writer.write({
    ...safe,
    timestamp: new Date().toISOString(),
    level,
    event,
    pid: process.pid,
    instance_id: instanceId,
  });
}

/** Error messages can contain prompts, tokens or SDK payloads. Capture classification and frames only. */
export function logError(event: string, error: unknown, fields: Fields = {}) {
  const cause = error instanceof Error ? error : undefined;
  const code = cause && "code" in cause ? cause.code : undefined;

  logEvent("error", event, {
    ...fields,
    error_type: cause?.name ?? "NonError",
    error_category: errorCategory(error),
    error_code:
      typeof code === "string" && /^[A-Z_0-9]+$/.test(code) ? code : undefined,
    stack: cause?.stack
      ?.replaceAll(homedir(), "~")
      .split("\n")
      .filter((line) => /^\s+at /.test(line))
      .slice(0, 8)
      .join("\n"),
    cause_type: cause?.cause instanceof Error ? cause.cause.name : undefined,
  });
}

export function flushLogs() {
  return writer?.flush() ?? Promise.resolve();
}
