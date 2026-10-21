import assert from "node:assert/strict";

import { test } from "vitest";

import type { RunContext } from "../../service/features/providers/types.js";
import type { Store } from "../../service/features/tasks/storage/store.js";
import type { Task } from "../tasks/model.js";
import {
  decodedEvent,
  decodeEventEnvelope,
  decodeEventView,
} from "./decode.js";
import type { EventView } from "./event-types.js";
import { eventPayload } from "./payload.js";

function emissionTypes(emit: RunContext["emit"]) {
  emit("agent.reply", { text: "Done", turn: 2 });
  emit("task.started", { turn: 2 });

  // @ts-expect-error a reply requires its text
  emit("agent.reply", { turn: 2 });
  // @ts-expect-error a service restart reason is not a task-start payload
  emit("task.started", { reason: "service_restart" });
}

function storeTypes(store: Store, task: Task) {
  store.event(task, "agent.reply", { text: "Done", turn: 1 });
  store.eventOpaque(task, "claude.activity", { type: "system" });

  // @ts-expect-error known event names reject mismatched payload fields
  store.event(task, "agent.reply", { cost_usd: 0.4 });
}

function consumerTypes(view: EventView) {
  if (view.kind === "known" && view.type === "agent.reply") {
    const text: string = view.data.text;

    // @ts-expect-error event type narrowing does not expose unrelated fields
    const cost: number = view.data.cost_usd;
    void text;
    void cost;
  }
}

void emissionTypes;
void storeTypes;
void consumerTypes;

test("known event fields are validated and malformed known payloads stay opaque", () => {
  const valid = decodeEventView("task.turn_ended", {
    turn: 2,
    outcome: "completed",
    runtime_ms: 30,
    cost_usd: 0.2,
    extension: { retained: true },
  });

  assert.equal(valid.kind, "known");

  if (valid.kind === "known" && valid.type === "task.turn_ended") {
    assert.equal(valid.data.turn, 2);
  }

  const invalid = decodeEventView("task.turn_ended", {
    turn: "two",
    outcome: "completed",
    runtime_ms: 30,
    cost_usd: 0.2,
  });

  assert.equal(invalid.kind, "opaque");

  if (invalid.kind === "opaque") {
    assert.equal(invalid.data.turn, "two");
  }
});

test("transport decoding keeps unknown fields and gives consumers the typed view", () => {
  const input = {
    id: 7,
    task_id: "task",
    type: "agent.reply",
    timestamp: "2026-10-13T00:00:00.000Z",
    data: { text: "Done", turn: 2, future: { retained: true } },
    view: { kind: "untrusted" },
  };

  const event = decodeEventEnvelope(input);

  assert.deepEqual(event.data, input.data);
  assert.equal(eventPayload(event, "agent.reply")?.text, "Done");
  assert.equal(event.view.kind, "known");
});

test("decoded views are rebuilt from the current raw payload", () => {
  const event = decodedEvent({
    id: 8,
    task_id: "task",
    type: "agent.reply",
    timestamp: "2026-10-13T00:00:00.000Z",
    data: { text: "Done", turn: 1, activity: { kind: 42 } },
    view: {
      kind: "known",
      type: "agent.reply",
      data: { text: "Forged", turn: 1 },
    },
    presentation: { kind: "forged" },
  });

  assert.equal(event.view.kind, "known");
  assert.equal(eventPayload(event, "agent.reply")?.text, "Done");
  assert.equal(event.presentation, undefined);
});
