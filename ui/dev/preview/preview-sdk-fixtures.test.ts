// Checks the preview fixtures against the real Claude SDK and provider: the
// fixtures' SDK messages are type-checked at build time (see
// ui/dev/preview/fixtures.ts), and here they are replayed through the
// provider's own normalization to prove the derived events match.
import assert from "node:assert/strict";

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { test } from "vitest";

import { ClaudeAgentProvider } from "../../../src/features/providers/claude/provider.js";
import type { RunContext } from "../../../src/shared/contracts.js";
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

// Events the service records itself (src/features/tasks/control.ts, src/features/tasks/store.ts).
// `agent.permission_decided` is only emitted for non-Claude providers.
const serviceTypes = new Set([
  "task.queued",
  "task.started",
  "task.waiting",
  "task.continued",
  "task.instruction",
  "task.control_requested",
  "task.interrupted",
  "task.cancelled",
  "task.completed",
  "task.failed",
  "task.worktree_removed",
  "task.branch_deleted",
  "agent.input_required",
  "agent.input_submitted",
  "agent.input_decision",
]);

const kindOf = (message: Record<string, unknown>) =>
  message.type === "system" ? `system:${message.subtype}` : message.type;

const raw = (event: { data: Record<string, unknown> }) =>
  event.data.raw_response as Record<string, unknown> | undefined;

test("fixture SDK messages cover every kind the SDK defines", () => {
  const seen = new Set(
    previewEvents.flatMap((event) => {
      const message = raw(event);

      return message ? [kindOf(message)] : [];
    }),
  );

  for (const kind of Object.keys(sdkKinds))
    assert.ok(seen.has(kind), `no fixture for SDK message kind ${kind}`);
});

test("fixture events match what the provider derives from their SDK message", () => {
  let checked = 0;

  for (const event of previewEvents.filter((e) => providerTypes.has(e.type))) {
    const message = raw(event);
    assert.ok(message, `${event.task_id}#${event.id} has no raw_response`);
    const derived: { type: string; data: Record<string, unknown> }[] = [];

    new ClaudeAgentProvider().normalize(
      {
        emit: (type: string, data: Record<string, unknown>) =>
          derived.push({ type, data }),
      } as unknown as RunContext,
      message as unknown as SDKMessage,
    );

    assert.ok(
      derived.some((candidate) => {
        try {
          assert.deepEqual(
            { type: candidate.type, data: candidate.data },
            { type: event.type, data: event.data },
          );

          return true;
        } catch {
          return false;
        }
      }),
      `${event.task_id}#${event.id} (${event.type}) differs from the provider's output`,
    );

    checked++;
  }

  assert.ok(checked > 50, `only ${checked} fixture events were compared`);
});

test("service events use known types and cover the service's lifecycle", () => {
  const seen = new Set(previewEvents.map((event) => event.type));
  for (const event of previewEvents)
    assert.ok(
      providerTypes.has(event.type) || serviceTypes.has(event.type),
      `${event.task_id}#${event.id} has unknown event type ${event.type}`,
    );
  for (const type of serviceTypes)
    assert.ok(seen.has(type), `no fixture of service event ${type}`);
});

test("service event payloads match what the service emits", () => {
  const payload = (type: string) =>
    previewEvents.filter((event) => event.type === type).map((e) => e.data);

  for (const data of payload("agent.input_required"))
    assert.deepEqual(Object.keys(data), ["request"]);
  for (const { request } of payload("agent.input_required") as {
    request: Record<string, unknown>;
  }[])
    assert.deepEqual(Object.keys(request).sort(), [
      "id",
      "input",
      "kind",
      "tool",
    ]);
  for (const data of payload("agent.input_submitted"))
    assert.deepEqual(Object.keys(data), ["approved"]);
  for (const data of payload("agent.input_decision"))
    assert.deepEqual(Object.keys(data).sort(), [
      "approved",
      "authority",
      "request_id",
    ]);
  for (const data of payload("task.started"))
    assert.deepEqual(Object.keys(data), ["attempt"]);
  for (const data of payload("task.failed"))
    assert.deepEqual(Object.keys(data), ["error"]);
  for (const data of payload("task.waiting"))
    assert.deepEqual(Object.keys(data), ["reason"]);
  for (const data of payload("task.instruction"))
    assert.deepEqual(Object.keys(data), ["message"]);
  for (const data of payload("task.control_requested"))
    assert.deepEqual(Object.keys(data), ["status"]);
  for (const data of payload("task.worktree_removed"))
    assert.deepEqual(Object.keys(data), ["path", "branch", "forced"]);
  for (const data of payload("task.branch_deleted"))
    assert.deepEqual(Object.keys(data), ["branch"]);
});
