import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

// Turns a task recorded from a real run into a preview fixture: its task
// record and events, with everything specific to the machine and account it
// ran on replaced, so the file can be committed. See
// docs/development.md#recorded-fixtures.
import { claudeMessageNormalizer } from "../../../src/service/features/providers/claude/events/normalize";
import type { RunContext } from "../../../src/service/features/providers/types";
import type { EventEnvelope } from "../../../src/shared/events/event-contract";
import { originalResponseLookup } from "../../../src/shared/providers/claude/responses";
import type { Task } from "../../../src/shared/tasks/model";

/** A recorded run, as `dev/panel/recorded/*.json` stores it. */
export type RecordedFixture = { task: Task; events: EventEnvelope[] };

export type RecordingOptions = {
  /** The fixture task's id; `preview-recorded-<name>` by convention. */
  id: string;
  title?: string;
  /** When the recording starts; later events keep their spacing. */
  start: string;
  /** The first event id; ids must not overlap other fixtures'. */
  firstId: number;
  conversationId?: string;
  /** Paths and names to replace, besides the task's own (longest first). */
  replace?: [from: string, to: string][];
};

/** Where recorded tasks appear to run. */
const FIXTURE_REPOSITORY = "/demo/project";
const FIXTURE_HOME = "/demo/home";
const FIXTURE_HOST = "preview-host";
const FIXTURE_SESSION = "preview-session";

/** Fields of a system/init message that describe the user's own setup. */
const INIT_SCRUB: Record<string, unknown> = {
  skills: [],
  plugins: [],
  mcp_servers: [],
  slash_commands: [],
  terminal_slash_commands: [],
  agents: ["general-purpose"],
};

const INIT_DROP = ["memory_paths", "messaging_socket_path", "scratchpad_path"];

/** Task fields that point at the recording machine's checkout. */
const WORKSPACE_FIELDS = [
  "workspace",
  "branch",
  "base_commit",
  "session_state_ref",
] as const;

/** Claude names a session's project directory after its path this way. */
const projectDirectory = (path: string) => path.replace(/[^a-zA-Z0-9]/g, "-");

/** Events the Claude provider derives from an SDK message. */
const PROVIDER_EVENTS = new Set([
  "claude.activity",
  "agent.started",
  "agent.completed",
  "agent.message",
  "agent.content",
  "tool.started",
  "tool.completed",
]);

/**
 * Sanitizes a recorded task and its events into a fixture:
 *
 * - paths (the repository, the workspace and its parent, the home
 *   directory), the host and user names, the task and session ids and API request ids
 *   become fixture values, including Claude's dash-encoded project paths;
 * - system/init messages lose the user's skills, plugins, MCP servers and
 *   commands, and their local paths; rate-limit events keep only their
 *   status and window, without the account's usage or overage policy;
 * - thinking blocks and streamed signature deltas use a placeholder signature;
 * - events are renumbered from `firstId` and moved to `start`;
 * - the task belongs to the preview owner, has no workspace (its Changes tab
 *   is empty), and is renamed when `title` is given.
 *
 * Provider events are derived again from the sanitized original response,
 * so they match what the provider records today.
 */
export function recordFixture(
  task: Task,
  events: EventEnvelope[],
  options: RecordingOptions & { home: string; host: string; username: string },
): RecordedFixture {
  const replacements: [string, string][] = [
    ...(options.replace ?? []),
    [task.id, options.id],
    ...(task.session_id
      ? [[task.session_id, FIXTURE_SESSION] as [string, string]]
      : []),
    // A current_repo task's workspace is the repository itself.
    ...(task.workspace && task.workspace !== task.repository
      ? [
          [task.workspace, `/demo/data/worktrees/${options.id}`] as [
            string,
            string,
          ],
        ]
      : []),
    [task.repository, FIXTURE_REPOSITORY],
    // The run's directory, unless it is a top-level one such as /tmp, which
    // would also match unrelated text.
    ...(parent(task.repository).split("/").length > 2
      ? [[parent(task.repository), "/demo/data"] as [string, string]]
      : []),
    [options.home, FIXTURE_HOME],
    [options.host, FIXTURE_HOST],
    [options.username, "demo-user"],
  ];

  // Encoded project directories first, since they contain no slashes.
  const pairs = [
    ...replacements
      .filter(([from]) => projectDirectory(from) !== from)
      .map(
        ([from, to]) =>
          [projectDirectory(from), projectDirectory(to)] as [string, string],
      ),
    ...replacements,
  ]
    .filter(([from]) => from.length > 0)
    .sort(([a], [b]) => b.length - a.length);

  let requests = 0;
  const requestIds = new Map<string, string>();

  const sanitizeText = (value: string): string => {
    let text = value;
    for (const [from, to] of pairs) text = text.split(from).join(to);

    text = text.replace(/req_[A-Za-z0-9]{8,}/g, (id) => {
      if (!requestIds.has(id)) {
        requestIds.set(
          id,
          `req_preview_${String(++requests).padStart(4, "0")}`,
        );
      }

      return requestIds.get(id)!;
    });

    return text;
  };

  // Replace decoded strings and keys so quotes, newlines and backslashes
  // stay valid JSON and literal replacement values keep their spelling.
  const sanitizeValue = (value: unknown): unknown => {
    if (typeof value === "string") return sanitizeText(value);
    if (Array.isArray(value)) return value.map(sanitizeValue);

    if (value && typeof value === "object") {
      const block = value as Record<string, unknown>;

      const hasThinkingSignature =
        block.type === "thinking" || block.type === "signature_delta";

      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [
          sanitizeText(key),
          hasThinkingSignature &&
          key === "signature" &&
          typeof child === "string"
            ? "preview-signature"
            : sanitizeValue(child),
        ]),
      );
    }

    return value;
  };

  const sanitize = <T>(value: T): T =>
    sanitizeValue(JSON.parse(JSON.stringify(value))) as T;

  const sorted = [...events].sort((a, b) => a.id - b.id);
  const origin = Date.parse(sorted[0]?.timestamp ?? task.created_at);
  const shift = Date.parse(options.start) - origin;

  const moved = (time?: string) =>
    time && new Date(Date.parse(time) + shift).toISOString();

  const lookup = originalResponseLookup(sorted);
  const responseRefs = new Map<string, string>();
  const derivedEvents = new Map<string, DerivedEvent[]>();
  const normalize = claudeMessageNormalizer();
  const identityFor = recordingResponseRefs();

  const recorded = sorted.map((event, index) => {
    const { raw_response: _raw, response_ref: _ref, ...fields } = event.data;
    const original = lookup(event);
    const identity = identityFor(event, original);
    let data: Record<string, unknown>;

    if (PROVIDER_EVENTS.has(event.type) && !original) {
      throw new Error(
        `Original response unavailable for ${event.task_id}#${event.id}. Run the task with SUBAGENT_EXTENSION_FOR_CODEX_FULL_EVENTS=1 before recording.`,
      );
    }

    if (identity) {
      const first = !responseRefs.has(identity);
      let raw: SDKMessage | undefined;

      if (first) {
        raw = sanitize(original!);

        if (raw.type === "system" && raw.subtype === "init") {
          Object.assign(raw, INIT_SCRUB);

          for (const key of INIT_DROP) {
            delete (raw as unknown as Record<string, unknown>)[key];
          }
        }

        scrubRateLimits(raw, options.start);
        responseRefs.set(identity, `response-${options.firstId + index}`);
        derivedEvents.set(identity, derivedFrom(raw, normalize));
      }

      const derived = derivedEvents.get(identity)!.shift();

      if (derived?.type !== event.type) {
        throw new Error(
          `${event.task_id}#${event.id} differs from what the provider derives from its original response`,
        );
      }

      data = {
        ...derived.data,
        response_ref: responseRefs.get(identity),
        ...(raw ? { raw_response: raw } : {}),
      };
    } else {
      data = sanitize(fields);
      scrubRateLimits(data, options.start);
    }

    return {
      id: options.firstId + index,
      task_id: options.id,
      type: event.type,
      timestamp: moved(event.timestamp)!,
      data,
    };
  });

  const clean = sanitize(task) as Task & Record<string, unknown>;

  for (const field of WORKSPACE_FIELDS) delete clean[field];

  return {
    task: {
      ...clean,
      id: options.id,
      owner: "preview",
      ...(options.title ? { title: options.title } : {}),
      ...(options.conversationId
        ? { conversation_id: options.conversationId }
        : {}),
      created_at: moved(task.created_at)!,
      updated_at: moved(task.updated_at)!,
      ...(task.started_at ? { started_at: moved(task.started_at) } : {}),
      ...(task.completed_at ? { completed_at: moved(task.completed_at) } : {}),
      ...(task.run_started_at
        ? { run_started_at: moved(task.run_started_at) }
        : {}),
    },
    events: recorded,
  };
}

type DerivedEvent = { type: string; data: Record<string, unknown> };

/** The events the provider derives from an original response today. */
function derivedFrom(
  original: SDKMessage,
  normalize: ReturnType<typeof claudeMessageNormalizer>,
) {
  const events: DerivedEvent[] = [];

  const emit = (type: string, data: Record<string, unknown>) =>
    events.push({ type, data });

  normalize({ emit, emitOpaque: emit } as unknown as RunContext, original);

  return events;
}

const parent = (path: string) => path.replace(/\/[^/]+\/?$/, "");

/**
 * The values from `values` that a recording's text still contains, as they
 * are or dash-encoded as Claude's project directories.
 */
export function leftovers(text: string, values: string[]) {
  return values.filter(
    (value) =>
      value.length > 1 &&
      (text.includes(value) || text.includes(projectDirectory(value))),
  );
}

/**
 * Usage levels and overage policy describe the account, so every
 * `rate_limit_info`, in the SDK message and the event's copy of its fields,
 * keeps only its status and window, resetting five hours after `start`.
 */
function scrubRateLimits(value: unknown, start: string) {
  if (!value || typeof value !== "object") return;

  for (const [key, child] of Object.entries(value)) {
    if (key === "rate_limit_info" && child && typeof child === "object") {
      const info = child as Record<string, unknown>;

      (value as Record<string, unknown>)[key] = {
        status: info.status,
        rateLimitType: info.rateLimitType,
        resetsAt: Math.floor(Date.parse(start) / 1000) + 5 * 3600,
      };
    } else {
      scrubRateLimits(child, start);
    }
  }
}

/** Old recordings encode siblings as consecutive copies of one response. */
function recordingResponseRefs() {
  let remaining = 0;
  let identity = "";

  return (event: EventEnvelope, original?: SDKMessage) => {
    if (typeof event.data.response_ref === "string") {
      remaining = 0;

      return event.data.response_ref;
    }

    if (!original) {
      remaining = 0;

      return undefined;
    }

    if (!remaining) {
      identity = `legacy-${event.id}`;
      // Only the count matters, which needs no earlier tool calls.
      remaining = derivedFrom(original, claudeMessageNormalizer()).length;
    }

    remaining--;

    return identity;
  };
}
