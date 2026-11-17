import type { Task } from "../../../src/shared/tasks/model";
import { at, settingOptions, taskBase, timestamps } from "./scenario-context";
import { begin, Timeline } from "./timeline";

const fullReply = "Moved the session transcript reader onto the new parser.";

// A context window past the warning share, close to auto-compact.
const fullTask = new Timeline("preview-context-full", at(240), 2600);
begin(fullTask, ["Grep", "Read", "Edit"]);
fullTask.say(fullReply);

fullTask.finish(fullReply, 1, {
  duration_ms: 640000,
  total_cost_usd: 1.9,
});

export const contextUsageTimelines = [fullTask];

export const contextUsageTasks: Task[] = [
  {
    ...taskBase,
    id: "preview-context-full",
    title: "Port the transcript reader",
    description: "Move the session transcript reader onto the new parser.",
    status: "completed",
    provider_options: {
      claude: {
        ...settingOptions().claude,
        context_usage: {
          total_tokens: 162_400,
          window_tokens: 200_000,
          auto_compact_tokens: 167_000,
          categories: [
            { name: "System prompt", tokens: 3_100 },
            { name: "System tools", tokens: 14_200 },
            { name: "Memory files", tokens: 1_900 },
            { name: "Messages", tokens: 143_200 },
          ],
        },
      },
    },
    runtime_ms: 640000,
    cost_usd: 1.9,
    ...timestamps(240, 4),
  },
];
