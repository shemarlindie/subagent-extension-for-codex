// @vitest-environment jsdom
import assert from "node:assert/strict";
import { test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  previewTasks,
  previewEvents,
  previewArtifacts,
  previewLiveStatus,
} from "../ui/transports/preview-fixtures";
import {
  groupActivity,
  activityKind,
  currentActivityStatus,
} from "../ui/core/activity-timeline";
import { EventList } from "../ui/components/event-list";
import { EVENT_TAIL_SIZE } from "../ui/core/event-history";
import type { Event } from "../ui/core/types";

const eventsFor = (taskId: string): Event[] =>
  previewEvents.filter((event) => event.task_id === taskId);

test("preview tasks cover every task status", () => {
  const statuses = new Set(previewTasks.map((task) => task.status));
  for (const status of [
    "queued",
    "starting",
    "running",
    "waiting",
    "interrupted",
    "completed",
    "failed",
    "cancelled",
  ])
    assert.ok(statuses.has(status as never), `missing ${status} task`);
});

test("preview events cover the activity kinds the timeline renders", () => {
  const kinds = new Set(previewEvents.map(activityKind));
  const rows = new Set(
    previewTasks.flatMap((task) =>
      groupActivity(eventsFor(task.id)).map((group) => group.kind),
    ),
  );
  for (const kind of [
    "agent.message",
    "agent.content",
    "tool.started",
    "tool.completed",
    "tool_progress",
    "stream_event",
    "hook_started",
    "hook_response",
    "task_started",
    "task_progress",
    "task_updated",
    "task_notification",
    "api_retry",
    "compact_boundary",
    "files_persisted",
    "notification",
    "permission_denied",
    "mirror_error",
    "rate_limit_event",
    "thinking_tokens",
    "agent.input_required",
    "agent.completed",
    "task.completed",
    "task.failed",
    "task.cancelled",
    "task.continued",
    "artifact.created",
    "prompt_suggestion",
    "tool_use_summary",
  ])
    assert.ok(kinds.has(kind), `no preview event of kind ${kind}`);
  for (const row of [
    "message",
    "tool",
    "operation",
    "status",
    "stream",
    "event",
  ])
    assert.ok(rows.has(row as never), `no preview ${row} row`);
});

test("a preview task has more events than the activity view keeps", () => {
  const longest = Math.max(
    ...previewTasks.map((task) => eventsFor(task.id).length),
  );
  assert.ok(
    longest > EVENT_TAIL_SIZE,
    `longest preview task has ${longest} events; the view keeps ${EVENT_TAIL_SIZE}`,
  );
});

test("every preview event lands in exactly one activity group", () => {
  for (const task of previewTasks) {
    const events = eventsFor(task.id);
    const grouped = groupActivity(events).flatMap((group) =>
      group.events.map((event) => event.id),
    );
    assert.deepEqual(
      [...grouped].sort((a, b) => a - b),
      events.map((event) => event.id).sort((a, b) => a - b),
      `${task.id} events are lost or duplicated`,
    );
  }
});

test("preview ids are unique and every activity timeline renders", () => {
  const ids = previewEvents.map((event) => `${event.task_id}:${event.id}`);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(
    new Set(previewTasks.map((task) => task.id)).size,
    previewTasks.length,
  );
  for (const artifact of previewArtifacts)
    assert.ok(
      previewTasks.some((task) => task.id === artifact.task_id),
      `${artifact.id} belongs to an unknown task`,
    );
  for (const task of previewTasks) {
    const html = renderToStaticMarkup(
      createElement(EventList, { events: eventsFor(task.id) }),
    );
    assert.ok(html.includes("activity-timeline"), `${task.id} did not render`);
  }
});

test("each running preview task ends on a different latest activity", () => {
  const expected: Record<string, string> = {
    ...previewLiveStatus,
    // Streamed text is the latest activity of the long-running permission fixture.
    "preview-refactor": "Responding",
  };
  const seen = new Set<string>();
  for (const [id, status] of Object.entries(expected)) {
    const task = previewTasks.find((candidate) => candidate.id === id)!;
    assert.equal(task.status, "running", `${id} is not running`);
    const live = currentActivityStatus(eventsFor(id), task);
    assert.equal(live.text, status, `${id} status line`);
    seen.add(live.text);
  }
  assert.equal(seen.size, Object.keys(expected).length, "states repeat");
});
