import type { Task } from "../../../src/shared/tasks/model";
import { at, settingOptions, taskBase, timestamps } from "./scenario-context";
import { begin, Timeline } from "./timeline";

const limitedReply =
  "Removed the retry wrapper. Each edit stopped for your approval, as this task can't bypass prompts.";

// Org policy turned the chosen mode off, so the task runs with the fallback.
const limitedTask = new Timeline("preview-policy-limited", at(120), 2600);
begin(limitedTask, ["Read", "Edit"]);

limitedTask.add("agent.limited", {
  setting: "permission_mode",
  requested: "bypassPermissions",
  effective: "default",
  reason:
    "Running with Ask for approval. Your organization turned off Bypass permission prompts.",
});

limitedTask.say(limitedReply);

limitedTask.finish(limitedReply, 1, {
  duration_ms: 41000,
  total_cost_usd: 0.12,
});

const loweredReply =
  "Mapped the three call sites that still read the legacy config.";

// The org's cap lowered the reasoning the task asked for.
const loweredTask = new Timeline("preview-policy-lowered", at(140), 2600);
begin(loweredTask, ["Grep", "Read"]);

loweredTask.add("agent.limited", {
  setting: "reasoning_effort",
  requested: "xhigh",
  effective: "high",
  reason: "Running with High reasoning, your organization's limit.",
});

loweredTask.say(loweredReply);

loweredTask.finish(loweredReply, 1, {
  duration_ms: 23000,
  total_cost_usd: 0.07,
});

export const orgPolicyTimelines = [limitedTask, loweredTask];

export const orgPolicyTasks: Task[] = [
  {
    ...taskBase,
    id: "preview-policy-limited",
    title: "Clean up the upload retries",
    description: "Remove the retry wrapper the upload client no longer needs.",
    worker_profile: "implementer",
    status: "completed",
    turn: 1,
    provider_options: {
      claude: {
        ...settingOptions().claude,
        permission_mode: "bypassPermissions",
        permission_source: "task",
        effective: { permission_mode: "default" },
      },
    },
    runtime_ms: 41000,
    cost_usd: 0.12,
    ...timestamps(120, 3),
  },
  {
    ...taskBase,
    id: "preview-policy-lowered",
    title: "Find legacy config readers",
    description: "List the call sites that still read the legacy config.",
    worker_profile: "researcher",
    reasoning_effort: "xhigh",
    status: "completed",
    turn: 1,
    provider_options: {
      claude: {
        ...settingOptions().claude,
        permission_mode: "plan",
        permission_source: "profile",
        effective: { effort: "high" },
      },
    },
    runtime_ms: 23000,
    cost_usd: 0.07,
    ...timestamps(140, 3),
  },
];
