import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

import { claudeActivityPresentation } from "../../../service/features/providers/claude/events/activity.js";
import { decodedEvent } from "../../events/decode.js";
import { type Event } from "../../events/types.js";
import { startSchema, type Task } from "../model.js";

export function event(
  id: number,
  type: string,
  data: Record<string, unknown> = {},
): Event {
  return decodedEvent({
    id,
    type,
    data:
      type === "claude.activity" || data.raw_response
        ? {
            ...data,
            activity: claudeActivityPresentation({
              type,
              data,
              rawResponse: data.raw_response as SDKMessage | undefined,
            }),
          }
        : data,
    task_id: "host-task",
    timestamp: new Date(id * 1000).toISOString(),
  });
}

export function sdk(
  id: number,
  subtype: string,
  data: Record<string, unknown> = {},
) {
  return event(id, "claude.activity", { type: "system", subtype, ...data });
}

export function task(status: Task["status"]): Task {
  return {
    ...startSchema.parse({
      repository: "/repo",
      description: "Review",
      worker_profile: "reviewer",
    }),
    id: "host-task",
    title: "Review",
    owner: "owner",
    repository: "/repo",
    status,
    created_at: "",
    updated_at: "",
    instructions: [],
    created_by: "user",
    instructions_sent: 0,
    pending_steers: [],
    queue: [],
    turn: 1,
    runtime_ms: 0,
  };
}

export function stream(
  id: number,
  wire: Record<string, unknown>,
  parent: string | null = null,
) {
  return event(id, "claude.activity", {
    type: "stream_event",
    parent_tool_use_id: parent,
    event: wire,
  });
}
