import type { Task } from "../../../src/shared/tasks/model";
import { at, settingOptions, taskBase, timestamps } from "./scenario-context";
import { begin, Timeline } from "./timeline";

// Records are set relative to when the fixtures load, so each reload restarts them.
const loaded = Date.now();
const ago = (ms: number) => new Date(loaded - ms).toISOString();

const countdownReply = "Listed the three retry paths in the upload client.";

// Counts down from 2m 30s, through the warning under 2 minutes, to expired.
const countdownTask = new Timeline("preview-cache-countdown", at(150), 2600);
begin(countdownTask, ["Grep", "Read"]);
countdownTask.say(countdownReply);

countdownTask.finish(countdownReply, 1, {
  duration_ms: 18000,
  total_cost_usd: 0.04,
});

export const promptCacheTimelines = [countdownTask];

export const promptCacheTasks: Task[] = [
  {
    ...taskBase,
    id: "preview-cache-countdown",
    title: "Map the upload retry paths",
    description: "Find every place the upload client retries a request.",
    status: "completed",
    provider_options: {
      claude: {
        ...settingOptions().claude,
        prompt_cache: { requested_at: ago(150_000), ttl: "5m" },
      },
    },
    runtime_ms: 18000,
    cost_usd: 0.04,
    ...timestamps(150, 2),
  },
];
