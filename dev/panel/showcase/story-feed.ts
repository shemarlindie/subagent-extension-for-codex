// Answers the panel's tool calls from the story, through the same fixture
// dispatcher the dev host uses. Update waits stay open the way the service
// holds them, so a playing panel sees each change as it happens.
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { Draft } from "../../../src/shared/tasks/conversation/drafts";
import { fixtureCall } from "../host/host-helpers";
import type { PreviewData } from "../scenarios/live-preview";
import {
  STORY_REPOSITORY,
  STORY_THREAD,
  storyAt,
  type StoryMoment,
} from "./story";

type WaitArgs = {
  after?: string;
  draft?: { message_id?: string; after_length?: number };
  wait_ms?: number;
};

type WaitRead = { revision: string; draft?: Draft | null };

function storyData(moment: StoryMoment): PreviewData {
  const current = storyAt(moment);

  return {
    tasks: current ? [current.task] : [],
    taskFor: (task) => task,
    eventsFor: (id) =>
      current && id === current.task.id ? current.events : [],
    draftFor: (id) =>
      current && id === current.task.id ? current.draft : undefined,
    revision: `showcase:${moment.step}:${current?.events.length ?? 0}`,
  };
}

function storyTool(
  moment: StoryMoment,
  name: string,
  args: Record<string, unknown>,
): CallToolResult {
  return fixtureCall(name, args, {
    data: storyData(moment),
    addedProjects: [STORY_REPOSITORY],
  });
}

/**
 * Whether a wait returns now. Mirrors `waitForUpdates` in
 * `src/service/features/tasks/conversation/updates.ts`: at once without
 * `after` or `wait_ms`, otherwise when the revision changes or the target
 * draft grows, becomes another message or clears.
 */
function answers(args: WaitArgs, read: WaitRead) {
  if (args.after === undefined || !args.wait_ms) return true;
  if (read.revision !== args.after) return true;
  const target = args.draft;
  if (!target) return false;
  if (!read.draft) return target.message_id !== undefined;

  return (
    read.draft.message_id !== target.message_id ||
    read.draft.text.length > (target.after_length ?? 0)
  );
}

/** The story as the panel sees it, at the moment the showcase last set. */
export class StoryFeed {
  private waiters = new Set<() => void>();
  constructor(private moment: StoryMoment) {}

  /** Moves the story on, waking the waits it may answer. */
  set(moment: StoryMoment) {
    if (
      moment.step === this.moment.step &&
      moment.streamed === this.moment.streamed
    ) {
      return;
    }

    this.moment = moment;
    for (const wake of this.waiters) wake();
    this.waiters.clear();
  }

  current() {
    return this.moment;
  }

  /** Opens the panel on the story task, as Codex does after start_task. */
  launch() {
    const current = storyAt(this.moment);

    return storyTool(this.moment, "open_codex_subagent_extension", {
      conversation_id: STORY_THREAD,
      ...(current ? { task_id: current.task.id } : {}),
    });
  }

  async call(name: string, args: Record<string, unknown>) {
    if (name !== "app_wait_for_updates") {
      return storyTool(this.moment, name, args);
    }

    const wait = args as WaitArgs;
    const deadline = performance.now() + (wait.wait_ms ?? 0);

    for (;;) {
      const result = storyTool(this.moment, name, args);
      const read = (result.structuredContent as { result: WaitRead }).result;
      const left = deadline - performance.now();
      if (left <= 0 || answers(wait, read)) return result;
      await this.next(left);
    }
  }

  /** Resolves when the story moves on, or after `ms`. */
  private next(ms: number) {
    return new Promise<void>((resolve) => {
      const wake = () => {
        clearTimeout(timer);
        this.waiters.delete(wake);
        resolve();
      };

      const timer = setTimeout(wake, ms);
      this.waiters.add(wake);
    });
  }
}
