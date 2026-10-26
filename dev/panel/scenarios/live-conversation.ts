import type { Event } from "../../../src/shared/events/types";
import type { Draft } from "../../../src/shared/tasks/conversation/drafts";
import type { Task } from "../../../src/shared/tasks/model";
import { settingOptions, taskBase } from "./scenario-context";
import { Timeline } from "./timeline";

export const LIVE_CONVERSATION_PERIOD_MS = 32_000;
const startedAt = Date.now();
const taskId = "preview-live-conversation";

const firstReply =
  "I found the layout shift. The activity label changes height when it appears or wraps. I'll check a longer command next.";

const finalReply =
  "The status line now keeps its height as the worker changes activities.\n\n- Short labels fit on one line.\n- Long commands truncate and keep their full text on hover.\n- Streamed replies become saved messages before the next activity begins.";

export const liveConversationTask: Task = {
  ...taskBase,
  id: taskId,
  title: "Live: conversation cycle",
  description:
    "Watch thinking, tool activity and streamed replies cycle through Chat.",
  worker_profile: "implementer",
  provider_options: settingOptions("implementer"),
  status: "running",
  workspace_strategy: "current_repo",
  budget: { max_runtime_minutes: null, max_cost_usd: null },
  run_started_at: new Date(startedAt).toISOString(),
  created_at: new Date(startedAt).toISOString(),
  updated_at: new Date(startedAt).toISOString(),
};

/** A turn's events use distinct SDK message and tool ids on every loop. */
function conversationTurn(cycle: number) {
  const turn = cycle + 1;
  const start = startedAt + cycle * LIVE_CONVERSATION_PERIOD_MS;

  const timeline = new Timeline(
    `${taskId}-${cycle}`,
    new Date(start).toISOString(),
    50_000 + cycle * 1000,
  );

  const scheduled: { at: number; event: Event }[] = [];

  const at = (offset: number, append: () => void) => {
    const before = timeline.events.length;
    append();

    scheduled.push(
      ...timeline.events.slice(before).map((event) => ({
        at: offset,
        event: {
          ...event,
          task_id: taskId,
          timestamp: new Date(start + offset).toISOString(),
        },
      })),
    );
  };

  const firstId = `msg_cycle_${cycle}_first`;
  const finalId = `msg_cycle_${cycle}_final`;

  at(0, () => {
    timeline.add("task.started", { turn }).init(["Bash"]);
  });

  at(1500, () => {
    timeline
      .ticks(80)
      .think(
        "Check whether activity changes move the conversation.",
        `thinking_${cycle}_first`,
      );
  });

  at(4000, () => {
    timeline.streamed([firstReply.slice(0, 1)], false, firstId);
  });

  at(9000, () => {
    timeline
      .stream({ type: "content_block_stop", index: 0 })
      .stream({ type: "message_stop" })
      .say(firstReply, firstId);
  });

  at(9500, () => {
    timeline
      .ticks(120)
      .think(
        "Use a long command to check truncation.",
        `thinking_${cycle}_second`,
      );
  });

  let tool = "";

  at(12_000, () => {
    tool = timeline.toolStart("Bash", {
      command:
        "npm test -- --runInBand src/service/features/tasks/continuation/recovery.integration.test.ts",
      description: "Check conversation layout",
    });

    timeline.toolProgress(tool, "Bash", 2);
  });

  at(16_000, () => {
    timeline
      .toolDone(tool, "Layout checks passed.")
      .sdk({ type: "system", subtype: "status", status: "compacting" });
  });

  at(18_000, () => {
    timeline
      .sdk({ type: "system", subtype: "status", status: null })
      .ticks(180)
      .think("Summarize the layout checks.", `thinking_${cycle}_final`);
  });

  at(20_000, () => {
    timeline.streamed([finalReply.slice(0, 1)], false, finalId);
  });

  at(25_000, () => {
    timeline
      .stream({ type: "content_block_stop", index: 0 })
      .stream({ type: "message_stop" })
      .say(finalReply, finalId);
  });

  at(26_000, () => {
    timeline.turnResult(finalReply, { duration_ms: 26_000, total_cost_usd: 0 });
  });

  at(28_000, () => {
    timeline
      .reply(finalReply, turn)
      .turnEnded(turn, "completed", 28_000, 0)
      .add("task.completed", { reply: finalReply });
  });

  return scheduled;
}

/** Full first turn for contract validation and SDK replay alongside static fixtures. */
export const liveConversationEvents = conversationTurn(0).map(
  ({ event }) => event,
);

/** Replays recent turns with monotonic cursors, while each unfinished reply grows in place. */
export function liveConversationSnapshot(elapsedMs: number) {
  const elapsed = Math.max(0, elapsedMs);
  const cycle = Math.floor(elapsed / LIVE_CONVERSATION_PERIOD_MS);
  const offset = elapsed % LIVE_CONVERSATION_PERIOD_MS;
  const events: Event[] = [];
  let draft: Draft | undefined;

  // Bound reads after a long-running preview; an open Chat keeps the history it already loaded.
  for (let index = Math.max(0, cycle - 2); index <= cycle; index++) {
    const round = conversationTurn(index);

    events.push(
      ...round
        .filter((item) => index < cycle || item.at <= offset)
        .map((item) => item.event),
    );
  }

  const stream = [
    {
      start: 4000,
      end: 9000,
      text: firstReply,
      id: `msg_cycle_${cycle}_first`,
    },
    {
      start: 20_000,
      end: 25_000,
      text: finalReply,
      id: `msg_cycle_${cycle}_final`,
    },
  ].find((item) => offset >= item.start && offset < item.end);

  if (stream) {
    draft = {
      message_id: stream.id,
      text: stream.text.slice(
        0,
        Math.max(
          1,
          Math.ceil((stream.text.length * (offset - stream.start)) / 5000),
        ),
      ),
    };
  }

  const task: Task = {
    ...liveConversationTask,
    turn: cycle + 1,
    status: offset >= 28_000 ? "completed" : "running",
    run_started_at: new Date(
      startedAt + cycle * LIVE_CONVERSATION_PERIOD_MS,
    ).toISOString(),
    updated_at: events.at(-1)?.timestamp ?? liveConversationTask.updated_at,
  };

  return {
    task,
    events,
    draft,
    revision: `preview:cycle:${events.at(-1)?.id ?? 0}`,
  };
}
