// Checks the preview fixtures against the real Claude SDK and provider: the
// fixtures' SDK messages are type-checked at build time (see
// dev/panel/scenarios/fixtures.ts), and here they are replayed through the
// provider's own normalization to prove the derived events match.
import assert from "node:assert/strict";

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { test } from "vitest";

import { claudeMessageNormalizer } from "../../../src/service/features/providers/claude/events/normalize.js";
import type { RunContext } from "../../../src/service/features/providers/types.js";
import { decodeEventView } from "../../../src/shared/events/decode.js";
import { eventPayloadMapSchema } from "../../../src/shared/events/event-contract.generated.js";
import {
  normalizedClaudeFields,
  originalResponseLookup,
} from "../../../src/shared/providers/claude/responses.js";
import { previewEvents } from "./fixtures";

type Kind<T> = T extends { type: "system"; subtype: infer S extends string }
  ? `system:${S}`
  : T extends { type: infer U extends string }
    ? U
    : never;

// Adding a message kind to the SDK makes this fail to compile until a fixture
// covers it (and the test below keeps the fixtures honest).
const sdkKinds: Record<Kind<SDKMessage>, true> = {
  assistant: true,
  user: true,
  result: true,
  stream_event: true,
  tool_progress: true,
  auth_status: true,
  tool_use_summary: true,
  rate_limit_event: true,
  prompt_suggestion: true,
  conversation_reset: true,
  "system:init": true,
  "system:compact_boundary": true,
  "system:status": true,
  "system:api_retry": true,
  "system:control_request_progress": true,
  "system:model_refusal_fallback": true,
  "system:model_refusal_no_fallback": true,
  "system:local_command_output": true,
  "system:hook_started": true,
  "system:hook_progress": true,
  "system:hook_response": true,
  "system:plugin_install": true,
  "system:task_notification": true,
  "system:task_started": true,
  "system:task_updated": true,
  "system:task_progress": true,
  "system:background_tasks_changed": true,
  "system:thinking_tokens": true,
  "system:session_state_changed": true,
  "system:worker_shutting_down": true,
  "system:commands_changed": true,
  "system:notification": true,
  "system:files_persisted": true,
  "system:memory_recall": true,
  "system:elicitation_complete": true,
  "system:permission_denied": true,
  "system:mirror_error": true,
  "system:session_writes_lost": true,
  "system:informational": true,
};

// Events the Claude provider derives from SDK messages.
const providerTypes = new Set([
  "claude.activity",
  "agent.started",
  "agent.completed",
  "agent.message",
  "agent.content",
  "tool.started",
  "tool.completed",
]);

// Only emitted for non-Claude providers.
const nonClaudeTypes = new Set(["agent.permission_decided"]);

// Every other contract event is recorded by the service itself, so a new event
// type fails the coverage test below until a fixture shows it.
const serviceTypes = new Set(
  Object.keys(eventPayloadMapSchema.shape).filter(
    (type) => !providerTypes.has(type) && !nonClaudeTypes.has(type),
  ),
);

const kindOf = (message: SDKMessage) =>
  message.type === "system"
    ? `system:${String(message.subtype)}`
    : String(message.type);

const raw = originalResponseLookup(previewEvents);

test("preview project events match the current payload contracts", () => {
  const knownTypes = new Set(Object.keys(eventPayloadMapSchema.shape));

  for (const event of previewEvents) {
    if (!knownTypes.has(event.type)) continue;

    assert.equal(
      decodeEventView(event.type, event.data).kind,
      "known",
      `${event.task_id}#${event.id} has an incomplete ${event.type} payload`,
    );
  }
});

test("fixture SDK messages cover every kind the SDK defines", () => {
  const seen = new Set(
    previewEvents.flatMap((event) => {
      const message = raw(event);

      return message ? [kindOf(message)] : [];
    }),
  );

  for (const kind of Object.keys(sdkKinds)) {
    assert.ok(seen.has(kind), `no fixture for SDK message kind ${kind}`);
  }
});

test("fixture events match what the provider derives from their SDK message", () => {
  let checked = 0;

  const responses = new Map<string, typeof previewEvents>();

  for (const event of previewEvents.filter((e) => providerTypes.has(e.type))) {
    const ref = event.data.response_ref;
    const identity = `${event.task_id}/${typeof ref === "string" ? ref : event.id}`;
    const siblings = responses.get(identity) ?? [];
    siblings.push(event);
    responses.set(identity, siblings);
  }

  const normalizers = new Map<
    string,
    ReturnType<typeof claudeMessageNormalizer>
  >();

  for (const siblings of responses.values()) {
    const event = siblings[0]!;
    let normalize = normalizers.get(event.task_id);

    if (!normalize) {
      normalize = claudeMessageNormalizer();
      normalizers.set(event.task_id, normalize);
    }

    const message = raw(event);
    assert.ok(message, `${event.task_id}#${event.id} has no raw_response`);
    const sdkMessage = message;
    const derived: { type: string; data: Record<string, unknown> }[] = [];

    normalize(
      {
        emit: (type: string, data: Record<string, unknown>) =>
          derived.push({ type, data }),
        emitOpaque: (type: string, data: Record<string, unknown>) =>
          derived.push({ type, data }),
      } as unknown as RunContext,
      sdkMessage,
    );

    assert.equal(
      derived.length,
      siblings.length,
      `${event.task_id}#${event.id} derived event count`,
    );

    for (const [index, sibling] of siblings.entries()) {
      const clean = (type: string, data: Record<string, unknown>) => {
        const { raw_response: _raw, response_ref: _ref, ...fields } = data;

        return {
          type,
          data:
            type === "claude.activity" || type === "agent.completed"
              ? normalizedClaudeFields(fields)
              : fields,
        };
      };

      const candidate = derived[index]!;

      assert.deepEqual(
        JSON.parse(JSON.stringify(clean(candidate.type, candidate.data))),
        JSON.parse(JSON.stringify(clean(sibling.type, sibling.data))),
        `${sibling.task_id}#${sibling.id} (${sibling.type}) differs from the provider's output`,
      );

      checked++;
    }
  }

  assert.ok(checked > 50, `only ${checked} fixture events were compared`);
});

test("service events use known types and cover the service's lifecycle", () => {
  const seen = new Set(previewEvents.map((event) => event.type));

  for (const event of previewEvents) {
    assert.ok(
      providerTypes.has(event.type) || serviceTypes.has(event.type),
      `${event.task_id}#${event.id} has unknown event type ${event.type}`,
    );
  }

  for (const type of serviceTypes) {
    assert.ok(seen.has(type), `no fixture of service event ${type}`);
  }
});
