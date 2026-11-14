import { eventPayload } from "../../events/payload.js";
import type { Event } from "../../events/types.js";
import { activityPresentation } from "../../providers/activity/presentation.js";
import type { TaskView } from "../model.js";
import {
  activityFailed,
  activityKind,
  type ActivityState,
  lastEvent,
  sentence,
  statusTitle,
  taskEventStates,
  thinking,
  thinkingSignal,
} from "./activity-events.js";
import { groupActivity } from "./activity-timeline.js";

/** Authoritative task state takes precedence over a retained tail's stale progress. */
export function currentActivityStatus(
  events: Event[],
  task?: TaskView,
): { text: string; state: ActivityState } {
  if (task) {
    if (task.status === "failed") return { text: "Failed", state: "failed" };

    if (task.status === "completed") {
      return { text: "Completed", state: "completed" };
    }

    if (task.status === "interrupted") {
      return { text: sentence(task.status), state: "info" };
    }

    if (task.status === "waiting" || task.pending_input) {
      return {
        text: task.pending_input
          ? `Needs input · ${task.pending_input.tool}`
          : "Waiting",
        state: "info",
      };
    }

    if (task.status === "queued" || task.status === "starting") {
      return { text: sentence(task.status), state: "running" };
    }
  }

  const sorted = [...events].sort((a, b) => a.id - b.id);
  const groups = groupActivity(sorted);

  const active = groups
    .filter((g) => g.state === "running")
    .sort((a, b) => lastEvent(a.events).id - lastEvent(b.events).id)
    .at(-1);

  const latest = sorted.findLast((e) => {
    const kind = activityKind(e);
    // Routine thinking updates must not hide live work or an earlier status change.
    if (active && thinkingSignal(e)) return false;

    return (
      [
        "task.failed",
        "task.completed",
        "task.interrupted",
        "agent.completed",
        "agent.input_required",
        "agent.input_submitted",
        "task.started",
        "agent.turn_started",
        ...thinking,
      ].includes(kind) ||
      (activityPresentation(e).liveStatus ??
        !!activityPresentation(e).statusTitle)
    );
  });

  if (latest && (!active || latest.id > lastEvent(active.events).id)) {
    const kind = activityKind(latest);

    if (kind === "agent.input_required") {
      const request = eventPayload(latest, "agent.input_required")?.request;

      return {
        text: `Needs input${request?.tool ? ` · ${request.tool}` : ""}`,
        state: "info",
      };
    }

    // A provider failure can arrive before the host persists its terminal task state.
    if (activityFailed(latest)) {
      return {
        text: kind === "status" ? statusTitle(latest) : "Failed",
        state: "failed",
      };
    }

    if (kind === "agent.completed") {
      return {
        text: task?.status === "running" ? "Finishing up" : "Turn completed",
        state: task?.status === "running" ? "running" : "completed",
      };
    }

    if (
      ["task.started", "agent.turn_started", "agent.input_submitted"].includes(
        kind,
      )
    ) {
      return { text: "Working", state: "running" };
    }

    if (kind.startsWith("task.")) {
      return {
        text: sentence(kind.slice(5)),
        state: taskEventStates[kind] ?? "info",
      };
    }

    const presentation = activityPresentation(latest);

    if (presentation.statusState === "completed") {
      return {
        text:
          task?.status === "running"
            ? "Finishing up"
            : (presentation.statusTitle ?? "Turn finished"),
        state: task ? "info" : "completed",
      };
    }

    if (presentation.statusState) {
      return { text: statusTitle(latest), state: presentation.statusState };
    }

    return { text: statusTitle(latest), state: "running" };
  }

  if (active) {
    return {
      text:
        active.kind === "tool"
          ? `Running ${active.title}${active.summary ? ` · ${active.summary}` : ""}`
          : active.title,
      state: "running",
    };
  }

  return {
    text: events.length ? "Working" : "Waiting for worker activity",
    state: task ? "running" : "info",
  };
}
