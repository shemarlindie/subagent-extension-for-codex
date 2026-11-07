import type {
  QueuedMessage,
  Task,
  TaskMessage,
} from "../../../src/shared/tasks/model";
import { at, taskBase, timestamps, WEBSITE } from "./scenario-context";
import { begin, resultUsage, SESSION, Timeline } from "./timeline";

// --- Steering a running turn: one steer taken, one pending, two queued -------
const firstQueued: QueuedMessage = {
  id: "msg_preview_steering_queued_1",
  message: "Then shorten the empty-state text.",
  from: "user",
  delivery: "queue",
};

const steeringMessages = {
  taken: {
    id: "msg_preview_steering_taken",
    message: "Keep the existing headings.",
    from: "user",
  } satisfies TaskMessage,
  pending: {
    id: "msg_preview_steering_pending",
    message: "Use sentence case in the buttons too.",
    from: "user",
  } satisfies TaskMessage,
  queued: [
    firstQueued,
    {
      id: "msg_preview_steering_queued_2",
      message: "Afterwards, list any strings you couldn't change.",
      from: "parent",
      delivery: "queue",
    },
  ] satisfies QueuedMessage[],
  removed: "msg_preview_steering_removed",
};

const queueEntry = (m: TaskMessage) => ({
  message_id: m.id,
  message: m.message,
  from: m.from,
});

const steering = new Timeline("preview-steering", at(115), 1700);
begin(steering, ["Read", "Edit"]);
steering.say("Reviewing the settings copy for consistent wording.");

steering.add(
  "task.instruction",
  { ...queueEntry(steeringMessages.taken), delivery: "steer" },
  2000,
);

steering.tool(
  "Read",
  { file_path: "src/panel/settings/copy.ts" },
  "1\texport const title = 'Settings';",
);

steering.add(
  "task.steer_taken",
  { message_id: steeringMessages.taken.id },
  100,
);

steering.say("Keeping the headings as they are; tightening the descriptions.");

steering.add(
  "task.queue_changed",
  {
    queue: [
      queueEntry(firstQueued),
      {
        message_id: steeringMessages.removed,
        message: "Check the dark theme too.",
        from: "user",
      },
    ],
    paused: false,
  },
  3000,
);

steering.add(
  "task.message_removed",
  { message_id: steeringMessages.removed },
  4000,
);

steering.add(
  "task.queue_changed",
  { queue: [queueEntry(firstQueued)], paused: false },
  0,
);

steering.add(
  "task.queue_changed",
  { queue: steeringMessages.queued.map(queueEntry), paused: false },
  5000,
);

steering.add(
  "task.instruction",
  { ...queueEntry(steeringMessages.pending), delivery: "steer" },
  2000,
);

steering.toolStart("Edit", {
  file_path: "src/panel/settings/copy.ts",
  old_string: "Save Changes",
  new_string: "Save changes",
});

// --- Interrupted with a steer pending: it waits at the front of a paused queue
const pausedMessages = {
  steer: {
    id: "msg_preview_paused_steer",
    message: "Rename the flags in the tests as well.",
    from: "user",
  },
  queued: {
    id: "msg_preview_paused_queued",
    message: "Then remove the flags that are always on.",
    from: "parent",
  },
  // A second movable message, so the queue can be reordered behind the steer.
  later: {
    id: "msg_preview_paused_later",
    message: "Update the flag docs last.",
    from: "user",
  },
} satisfies Record<string, TaskMessage>;

const paused = new Timeline("preview-paused", at(118), 1800);
begin(paused, ["Read", "Edit", "Grep"]);
paused.say("Renaming the feature flags to the new prefix.");

paused.add(
  "task.queue_changed",
  { queue: [queueEntry(pausedMessages.queued)], paused: false },
  4000,
);

paused.add(
  "task.queue_changed",
  {
    queue: [
      queueEntry(pausedMessages.queued),
      queueEntry(pausedMessages.later),
    ],
    paused: false,
  },
  1000,
);

paused.add(
  "task.instruction",
  { ...queueEntry(pausedMessages.steer), delivery: "steer" },
  3000,
);

paused.add("task.control_requested", { status: "interrupted" }, 2000);
paused.turnEnded(1, "interrupted", 41000, 0.22);

paused.add(
  "task.queue_changed",
  {
    queue: [
      queueEntry(pausedMessages.steer),
      queueEntry(pausedMessages.queued),
      queueEntry(pausedMessages.later),
    ],
    paused: true,
  },
  0,
);

paused.add("task.interrupted", {}, 0);

// --- Conversations ------------------------------------------------------------
/** A message sent to a fixture task, then the turn it starts. */
const followUp = (
  t: Timeline,
  turn: number,
  message: TaskMessage,
  delivery: "steer" | "queue" = "steer",
) =>
  t
    .add(
      "task.instruction",
      {
        message_id: message.id,
        message: message.message,
        from: message.from,
        delivery,
      },
      60000,
    )
    .add("task.queued", {}, 100)
    .add("task.started", { turn }, 300);

// A multi-turn conversation: the parent starts it, the user and the parent follow up.
const fileTypeRequest: TaskMessage = {
  id: "msg_preview_conversation_1",
  message: "Also reject files whose extension doesn't match their type.",
  from: "user",
};

const callersQuestion: TaskMessage = {
  id: "msg_preview_conversation_2",
  message:
    "Thanks. Before I review: does anything else call `saveUpload` directly?",
  from: "parent",
};

const conversationMessages = [fileTypeRequest, callersQuestion];

const sizeLimitReply = `Added a size limit to the upload endpoint: requests over **10 MB** now get \`413 Payload Too Large\` before the body is read.

- \`server/upload.ts\`: checks \`content-length\` first, then counts bytes as they stream.
- \`server/upload.test.ts\`: covers both paths.

\`npm test -- upload\` passes. Left to do: the limit is a constant; it could come from settings.`;

const fileTypeReply = `Uploads are now checked against their type, too: a file whose extension doesn't match its detected type is rejected with \`415\`.

| Extension | Detected | Result |
| --- | --- | --- |
| \`.png\` | PNG | accepted |
| \`.png\` | PDF | rejected |

The tests cover both cases.`;

// Exercises response formats that need care: a footnote, a relative file
// link, prose that looks like HTML, a relative image and a console session.
const callersReply = `Only the endpoint calls \`saveUpload\`[^1]; the import job uses its own writer in [import/writer.ts](server/import/writer.ts:12), so it isn't affected. It returns a Promise<UploadResult> either way.

![Call graph](docs/call-graph.png)

\`\`\`console
$ grep -rn saveUpload server
server/upload.ts:14:  await saveUpload(file)
\`\`\`

[^1]: Searched with [ripgrep](https://github.com/BurntSushi/ripgrep), including tests.`;

const conversationTask = new Timeline("preview-conversation", at(120), 1900);
begin(conversationTask, ["Read", "Edit", "Bash"]);
conversationTask.say("Reading the upload handler.");

conversationTask.tool(
  "Read",
  { file_path: "server/upload.ts" },
  "1\texport async function upload(req) {",
);

conversationTask.say(sizeLimitReply);

conversationTask.finish(sizeLimitReply, 1, {
  duration_ms: 142000,
  total_cost_usd: 0.61,
});

followUp(conversationTask, 2, fileTypeRequest);

conversationTask.tool(
  "Edit",
  {
    file_path: "server/upload.ts",
    old_string: "await saveUpload(file)",
    new_string: "await checkType(file);\n  await saveUpload(file)",
  },
  "The file server/upload.ts has been updated.",
);

conversationTask.say(fileTypeReply);

conversationTask.finish(fileTypeReply, 2, {
  duration_ms: 98000,
  total_cost_usd: 0.38,
});

followUp(conversationTask, 3, callersQuestion);

conversationTask.tool(
  "Grep",
  { pattern: "saveUpload", path: "." },
  "server/upload.ts:14:  await saveUpload(file)",
);

conversationTask.say(callersReply);

conversationTask.finish(callersReply, 3, {
  duration_ms: 31000,
  total_cost_usd: 0.09,
});

// A turn stopped by its cost budget, so the composer offers to raise it.
const budgetTask = new Timeline("preview-budget", at(125), 2000);
begin(budgetTask, ["Read", "Edit"]);
budgetTask.say("Moving the date helpers to the new module.");

budgetTask.tool(
  "Read",
  { file_path: "src/dates.ts" },
  "1\texport function formatDate(d: Date) {",
);

budgetTask.result({
  type: "result",
  subtype: "error_max_budget_usd",
  duration_ms: 302000,
  duration_api_ms: 251000,
  is_error: true,
  num_turns: 14,
  stop_reason: null,
  total_cost_usd: 2.04,
  usage: resultUsage(22000, 5100),
  modelUsage: {},
  permission_denials: [],
  errors: ["Reached the maximum budget for this task."],
  uuid: "00000000-0000-4000-8000-000000300001",
  session_id: SESSION,
});

budgetTask.turnEnded(1, "failed", 302000, 2.04);

budgetTask.add("task.failed", { error_code: "cost_budget_exhausted" }, 200);

// A runtime-only limit failure, with its control in the warning notice.
const runtimeBudgetTask = new Timeline("preview-runtime-budget", at(127), 2050);
begin(runtimeBudgetTask, ["Read", "Edit"]);
runtimeBudgetTask.say("Finishing the migration and checking all call sites.");

runtimeBudgetTask.tool(
  "Read",
  { file_path: "src/dates.ts" },
  "1\texport function formatDate(d: Date) {",
);

runtimeBudgetTask.turnEnded(1, "failed", 22 * 60000, 0.44);

runtimeBudgetTask.add(
  "task.failed",
  { error_code: "runtime_budget_exhausted" },
  200,
);

// A long conversation, for scrolling Chat.
const longChat = new Timeline("preview-long-chat", at(130), 2100);
begin(longChat, ["Read", "Edit"]);
const longChatTurns = 14;

/** The follow-up that starts `turn`, from turn 2 on. */
const longChatMessage = (turn: number): TaskMessage => ({
  id: `msg_preview_long_chat_${turn}`,
  message:
    turn % 3 === 0
      ? `Now the ${turn}th screen, please, and keep the spacing tokens.`
      : `Next: screen ${turn}. Same approach as before.`,
  from: turn % 4 === 0 ? "parent" : "user",
});

const longChatMessages = Array.from({ length: longChatTurns - 1 }, (_, index) =>
  longChatMessage(index + 2),
);

for (let turn = 1; turn <= longChatTurns; turn++) {
  if (turn > 1) followUp(longChat, turn, longChatMessage(turn));

  const reply = `Updated screen ${turn} to the new layout.\n\n- Replaced the fixed widths with the grid.\n- Kept the spacing tokens.${turn === longChatTurns ? "\n\nThat's every screen." : ""}`;

  longChat.say(reply);
  longChat.finish(reply, turn, { duration_ms: 40000, total_cost_usd: 0.12 });
}

export const conversationTasks: Task[] = [
  {
    ...taskBase,
    id: "preview-steering",
    title: "Tidy the settings copy",
    description:
      "Make the settings screen's wording consistent: sentence case, short descriptions.",
    worker_profile: "implementer",
    repository: WEBSITE,
    status: "running",
    runtime_ms: 0,
    instructions: [steeringMessages.taken],
    instructions_sent: 1,
    pending_steers: [steeringMessages.pending],
    queue: steeringMessages.queued,
    run_started_at: new Date(Date.now() - 95000).toISOString(),
    ...timestamps(115, 2),
  },
  {
    ...taskBase,
    id: "preview-paused",
    title: "Rename the feature flags",
    description: "Rename every feature flag to the new ff_ prefix.",
    worker_profile: "implementer",
    status: "interrupted",
    runtime_ms: 41000,
    cost_usd: 0.22,
    queue: [
      { ...pausedMessages.steer, delivery: "steer", recorded: true },
      { ...pausedMessages.queued, delivery: "queue" },
      { ...pausedMessages.later, delivery: "queue" },
    ],
    queue_paused: true,
    ...timestamps(118, 1),
  },
  {
    ...taskBase,
    id: "preview-conversation",
    title: "Limit upload sizes",
    description:
      "Add a size limit to the upload endpoint and reject oversized requests early.",
    worker_profile: "implementer",
    created_by: "parent",
    repository: WEBSITE,
    workspace_strategy: "current_repo",
    status: "completed",
    turn: 3,
    instructions: conversationMessages,
    instructions_sent: 2,
    runtime_ms: 271000,
    cost_usd: 1.08,
    ...timestamps(120, 6),
  },
  {
    ...taskBase,
    id: "preview-budget",
    title: "Move the date helpers",
    description:
      "Move the date helpers into their own module and update imports.",
    worker_profile: "implementer",
    status: "failed",
    error_code: "cost_budget_exhausted",
    budget: { max_runtime_minutes: 20, max_cost_usd: 2 },
    runtime_ms: 302000,
    cost_usd: 2.04,
    ...timestamps(125, 5),
  },
  {
    ...taskBase,
    id: "preview-long-chat",
    title: "Move the screens to the new layout",
    description:
      "Move each settings screen to the new grid layout, one at a time.",
    worker_profile: "implementer",
    status: "completed",
    turn: longChatTurns,
    instructions: longChatMessages,
    instructions_sent: longChatTurns - 1,
    runtime_ms: longChatTurns * 40000,
    cost_usd: longChatTurns * 0.12,
    ...timestamps(130, 30),
  },
  {
    ...taskBase,
    id: "preview-runtime-budget",
    title: "Finish the date helper migration",
    description: "Finish moving date helpers and update every call site.",
    worker_profile: "implementer",
    status: "failed",
    error_code: "runtime_budget_exhausted",
    budget: { max_runtime_minutes: 20, max_cost_usd: null },
    runtime_ms: 22 * 60000,
    cost_usd: 0.44,
    ...timestamps(127, 22),
  },
];

export const conversationTimelines = [
  steering,
  paused,
  conversationTask,
  budgetTask,
  longChat,
  runtimeBudgetTask,
];
