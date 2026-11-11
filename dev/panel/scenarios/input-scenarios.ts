import type { Task } from "../../../src/shared/tasks/model";
import { at, settingOptions, taskBase, timestamps } from "./scenario-context";
import { begin, lifecycle, Timeline } from "./timeline";

const questionInput = {
  questions: [
    {
      question: "Which config format should the loader support first?",
      header: "Format",
      multiSelect: false,
      options: [
        { label: "YAML", description: "Readable; needs a parser dependency." },
        { label: "TOML", description: "Strict and small; fewer surprises." },
        { label: "JSON", description: "Already parsed everywhere." },
      ],
    },
  ],
};

// One AskUserQuestion call stacks several questions, mixing single and multiple choice.
const stackedQuestionInput = {
  questions: [
    {
      question: "Which sign-in methods should ship in the first release?",
      header: "Methods",
      multiSelect: true,
      options: [
        { label: "Passkeys", description: "Phishing-resistant; newest flow." },
        { label: "Email link", description: "No password to remember." },
        { label: "Google", description: "Most requested by beta users." },
        { label: "GitHub", description: "Useful for the developer tier." },
      ],
    },
    {
      question: "How should existing sessions migrate?",
      header: "Sessions",
      multiSelect: false,
      options: [
        {
          label: "Keep them",
          description: "Old tokens stay valid until they expire.",
        },
        {
          label: "Sign out all",
          description: "Clean cut-over; everyone signs in again.",
        },
      ],
    },
    {
      question: "Where should the rollout start?",
      header: "Rollout",
      multiSelect: false,
      options: [
        { label: "Staff only", description: "Internal accounts for a week." },
        { label: "10% of users", description: "Gradual, behind a flag." },
        { label: "Everyone", description: "Single release, no flag." },
      ],
    },
  ],
};

// --- Waiting on a question (AskUserQuestion) ---------------------------------
const question = new Timeline("preview-question", at(45), 300);
begin(question, ["Read", "Grep", "AskUserQuestion"]);
question.say("The loader has three plausible formats, so I need a decision.");

question.tool(
  "Grep",
  { pattern: "loadConfig", path: "src" },
  "src/config.ts:12:export function loadConfig(path: string)",
);

question.add("agent.input_required", {
  request: {
    id: "preview-question-request",
    tool: "AskUserQuestion",
    kind: "question",
    input: questionInput,
  },
});

question.sdk({
  type: "system",
  subtype: "session_state_changed",
  state: "requires_action",
});

// --- Waiting on stacked questions (one AskUserQuestion, several questions) ---
const stacked = new Timeline("preview-stacked-questions", at(50), 300);
begin(stacked, ["Read", "Grep", "AskUserQuestion"]);
stacked.say("The rollout plan depends on three product decisions.");

stacked.add("agent.input_required", {
  request: {
    id: "preview-stacked-questions-request",
    tool: "AskUserQuestion",
    kind: "question",
    input: stackedQuestionInput,
  },
});

stacked.sdk({
  type: "system",
  subtype: "session_state_changed",
  state: "requires_action",
});

const permission = lifecycle(
  "preview-input",
  25,
  ["task.queued"],
  ["task.started", { turn: 1 }],
  [
    "agent.input_required",
    {
      request: {
        id: "preview-request",
        tool: "Bash",
        kind: "permission",
        input: {
          command: "npm run typecheck",
          description:
            "Check the session-state change in the isolated worktree.",
        },
      },
    },
  ],
);

export const inputTasks: Task[] = [
  {
    ...taskBase,
    id: "preview-question",
    title: "Migrate the config loader",
    description:
      "Move the config loader to a typed schema and keep backwards compatibility.",
    worker_profile: "implementer",
    provider_options: settingOptions(),
    status: "waiting",
    waiting_reason: "waiting_for_user",
    runtime_ms: 120000,
    run_started_at: at(45),
    pending_input: {
      id: "preview-question-request",
      tool: "AskUserQuestion",
      kind: "question",
      input: questionInput,
    },
    ...timestamps(45, 1),
  },
  {
    ...taskBase,
    id: "preview-stacked-questions",
    title: "Plan the sign-in rollout",
    description:
      "Draft the rollout plan for the new sign-in service, including session migration.",
    worker_profile: "researcher",
    status: "waiting",
    waiting_reason: "waiting_for_user",
    runtime_ms: 90000,
    run_started_at: at(50),
    pending_input: {
      id: "preview-stacked-questions-request",
      tool: "AskUserQuestion",
      kind: "question",
      input: stackedQuestionInput,
    },
    ...timestamps(50, 1),
  },
  {
    ...taskBase,
    id: "preview-input",
    title: "Investigate session expiry regression",
    description:
      "Trace the session expiry regression and identify the first incorrect state transition.",
    worker_profile: "implementer",
    provider_options: settingOptions(),
    status: "waiting",
    waiting_reason: "waiting_for_permission",
    pending_input: {
      id: "preview-request",
      tool: "Bash",
      kind: "permission",
      input: {
        command: "npm run typecheck",
        description: "Check the session-state change in the isolated worktree.",
      },
    },
    ...timestamps(25, 1),
  },
];

export const inputTimelines = [question, stacked, permission];
