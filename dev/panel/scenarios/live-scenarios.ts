import type { Task } from "../../../src/shared/tasks/model";
import { taskBase, timestamps } from "./scenario-context";
import { begin, rateLimit, Timeline } from "./timeline";

// --- Running tasks, one per "latest activity" the inspector can show ----------
// Each ends on a different event, so the live status line, the row that is still
// going and the clocks can all be seen. Timestamps are relative to load, so the
// run looks like it began under a minute ago and its clocks read a few seconds.
const liveStart = Date.now() - 40000;
const liveClock = () => new Date(liveStart).toISOString();

const liveTimeline = (name: string, firstId: number) => {
  const timeline = new Timeline(`preview-live-${name}`, liveClock(), firstId);
  begin(timeline, ["Read", "Edit", "Bash"]);

  return timeline.say("Starting on the change.");
};

const liveStates: {
  name: string;
  title: string;
  /** What the inspector's status line says while this is the latest activity. */
  status: string;
  timeline: Timeline;
}[] = [
  {
    name: "thinking",
    title: "Live: thinking",
    status: "Thinking…",
    timeline: liveTimeline("thinking", 1000).ticks(60, 180),
  },
  {
    name: "tool",
    title: "Live: running a tool",
    status: "Running Bash · npm test -- --runInBand",
    timeline: (() => {
      const timeline = liveTimeline("tool", 1100);

      const id = timeline.toolStart("Bash", {
        command: "npm test -- --runInBand",
        description: "Run the test suite",
      });

      return timeline.toolProgress(id, "Bash", 4);
    })(),
  },
  {
    name: "compacting",
    title: "Live: compacting context",
    status: "Compacting context",
    timeline: liveTimeline("compacting", 1200).sdk({
      type: "system",
      subtype: "status",
      status: "compacting",
    }),
  },
  {
    name: "retry",
    title: "Live: retrying a request",
    status: "Retrying request · attempt 2",
    timeline: liveTimeline("retry", 1300).sdk({
      type: "system",
      subtype: "api_retry",
      attempt: 2,
      max_retries: 3,
      retry_delay_ms: 4000,
      error_status: 529,
      error: "overloaded",
    }),
  },
  {
    name: "rate-limited",
    title: "Live: waiting for a rate limit",
    status: "Waiting for rate limit reset",
    timeline: rateLimit(liveTimeline("rate-limited", 1400), "rejected"),
  },
  {
    name: "working",
    title: "Live: working",
    status: "Working",
    timeline: liveTimeline("working", 1500).add(
      "task.started",
      { turn: 1 },
      800,
    ),
  },
  {
    name: "finishing",
    title: "Live: finishing up",
    status: "Finishing up",
    timeline: liveTimeline("finishing", 1600).turnResult("Change complete."),
  },
  {
    name: "hook",
    title: "Live: running a hook",
    status: "Hook · Run lint",
    timeline: liveTimeline("hook", 1700).sdk({
      type: "system",
      subtype: "hook_started",
      hook_id: "preview-live-hook",
      hook_name: "Run lint",
      hook_event: "PostToolUse",
    }),
  },
  {
    name: "background",
    title: "Live: background task",
    status: "Background task",
    timeline: liveTimeline("background", 1800).sdk({
      type: "system",
      subtype: "task_started",
      task_id: "preview-live-bg",
      description: "Watch the build",
    }),
  },
  {
    name: "failure",
    title: "Live: provider failure",
    status: "Context compaction failed",
    timeline: liveTimeline("failure", 1900).sdk({
      type: "system",
      subtype: "status",
      status: null,
      compact_result: "failed",
      compact_error: "The summary exceeded the context window.",
    }),
  },
];

const statusTimelines = liveStates.map((live) => live.timeline);

// --- A reply streaming in: the preview's draft grows with time since load ----
const streaming = liveTimeline("streaming", 2200).tool(
  "Read",
  { file_path: "src/cache.ts" },
  "1\texport const cache = new Map();",
);

/** The message the streaming fixture's worker is writing. */
export const previewStreamingDraft = {
  taskId: streaming.taskId,
  messageId: "msg_preview_streaming",
  text: `The cache never evicts entries, which is why memory grows during long sessions.

I'd fix it in two steps:

1. **Bound the size.** Replace the \`Map\` with a small LRU that keeps the 500 most recent entries.
2. **Expire stale entries.** Store each entry's write time and drop anything older than ten minutes on read.

The first step alone stops the growth; the second keeps results fresh after the underlying files change. Neither changes the cache's public API, so callers stay as they are.`,
};

/** Expected inspector status line for each live task, keyed by task id. */
export const previewLiveStatus = Object.fromEntries(
  liveStates.map((live) => [live.timeline.taskId, live.status]),
);

export const statusTasks: Task[] = liveStates.map((live, index) => ({
  ...taskBase,
  id: live.timeline.taskId,
  title: live.title,
  description: `Shows the inspector while "${live.status}" is the latest activity.`,
  worker_profile: "implementer",
  provider_options: {
    claude: {
      permission_mode: "inherit",
      permission_source: "user_config",
      approval_decider: "user",
    },
  },
  status: "running",
  workspace_strategy: "current_repo",
  budget: { max_runtime_minutes: null, max_cost_usd: null },
  run_started_at: liveClock(),
  ...timestamps(120 + index, 1),
}));

export const liveTasks: Task[] = [
  {
    ...taskBase,
    id: streaming.taskId,
    title: "Live: streaming reply",
    description: "Shows a reply streaming into Chat as the worker writes it.",
    worker_profile: "implementer",
    status: "running",
    workspace_strategy: "current_repo",
    budget: { max_runtime_minutes: null, max_cost_usd: null },
    run_started_at: liveClock(),
    ...timestamps(135, 1),
  },
];

export const liveTimelines = [streaming, ...statusTimelines];
