import { act } from "@testing-library/react";
import { vi, type TestContext } from "vitest";

import type { Task } from "../../../src/panel/app/state/types";
import type { RequestAttachment } from "../../../src/shared/attachments/model.js";
import { decodeEventEnvelope } from "../../../src/shared/events/decode.js";
import {
  chatItems,
  isChatEvent,
} from "../../../src/shared/tasks/conversation/chat.js";
import {
  changePages,
  setup,
  task,
  type FakeTransport,
} from "../panel-test-support";
import { commits } from "./render-recorder";

/** How the panel is laid out: wide shows the list beside the inspector. */
export type Layout = "wide" | "narrow" | "scoped";

const AT = "2026-11-15T12:00:00.000Z";

export const SELECTED = "one";

const attachment: RequestAttachment = {
  position: 1,
  title: "Login handler",
  summary: "The handler the review starts from.",
  format: "text",
  source: "file",
  path: "src/login.ts",
  chars: 120,
  lines: 6,
};

const REPLY = [
  "Found two issues in the login flow.",
  "The session token never expires:",
  "```ts\nconst session = createSession({ ttl: Infinity });\n```",
  "The logout handler keeps the cookie.",
].join("\n\n");

/** A Task as the panel lists it, with the given fields. */
export function listedTask(id: string, fields: Partial<Task> = {}): Task {
  return { ...task(id), created_at: AT, updated_at: AT, ...fields };
}

let nextEvent = 1;

/** A stored event for the selected task, as the service sends it. */
export function event(type: string, data: Record<string, unknown> = {}) {
  return {
    id: nextEvent++,
    task_id: SELECTED,
    timestamp: AT,
    type,
    data,
  };
}

/** Rebuilds Chat from the selected task's events, as the service does. */
export function storeChat(transport: FakeTransport) {
  const selected = transport.tasks.find(({ id }) => id === SELECTED);
  if (!selected) throw new Error("The selected task is missing");

  const events = transport.taskEvents
    .map(decodeEventEnvelope)
    .filter((e) => isChatEvent(e.type, e.data));

  transport.chat = chatItems(selected, events).map((item) =>
    item.kind === "message" && item.message.kind === "request"
      ? { ...item, message: { ...item.message, attachments: [attachment] } }
      : item,
  );
}

/**
 * Three listed tasks across two projects, one unread and one archived. The
 * selected task runs its second turn, with Chat, Activity, changes, a queue
 * and pending updates.
 */
function configureBase(transport: FakeTransport) {
  nextEvent = 1;

  transport.projects = [
    { repository: "/repo/a", kind: "repository" },
    { repository: "/repo/b", kind: "repository" },
  ];

  transport.tasks = [
    listedTask(SELECTED, {
      status: "running",
      turn: 2,
      runtime_ms: 60_000,
      run_started_at: AT,
      cost_usd: 0.42,
      queue: [
        {
          id: "q1",
          message: "Then check logout.",
          from: "user",
          delivery: "queue",
        },
        {
          id: "q2",
          message: "Summarize the risks.",
          from: "user",
          delivery: "queue",
        },
      ],
    }),
    listedTask("two", {
      title: "Fix the flaky upload test",
      status: "completed",
      unread: true,
      reply: { turn: 1, text: "The upload test no longer races the timer." },
    }),
    listedTask("three", {
      title: "Migrate the config loader",
      repository: "/repo/b",
      status: "running",
      run_started_at: AT,
    }),
    listedTask("four", {
      title: "Remove the old cache",
      status: "completed",
      archived_at: AT,
    }),
  ];

  transport.taskEvents = [
    event("task.started", { turn: 1 }),
    event("agent.thinking_tokens", { tokens: 12 }),
    event("agent.message", {
      role: "assistant",
      text: REPLY,
      message_id: "m1",
    }),
    event("agent.reply", { text: REPLY, turn: 1 }),
    event("task.turn_ended", {
      turn: 1,
      outcome: "completed",
      runtime_ms: 60_000,
      cost_usd: 0.42,
    }),
    event("task.completed"),
    event("task.session_started", { reason: "no_session" }),
    event("task.instruction", {
      message_id: "i1",
      message: "Now check the logout flow.",
      from: "user",
      delivery: "steer",
    }),
    event("task.started", { turn: 2 }),
    event("agent.message", {
      role: "assistant",
      text: "Reading the logout handler.",
      message_id: "m2",
    }),
    event("agent.thinking_tokens", { tokens: 8 }),
  ];

  storeChat(transport);
  serveActions(transport);
  transport.changes = changePages();

  transport.pendingUpdates = [
    {
      task_id: "two",
      title: "Fix the flaky upload test",
      updates: [
        {
          event_id: 4,
          kind: "reply",
          text: "The upload test no longer races the timer.",
          timestamp: AT,
        },
      ],
    },
  ];
}

const COMMANDS = [
  {
    name: "review",
    description: "Review the changes",
    argument_hint: "",
    aliases: [],
    builtin: true,
  },
  {
    name: "run-tests",
    description: "Run the test suite",
    argument_hint: "",
    aliases: [],
    builtin: false,
  },
];

/** Serves the tools the scenarios' actions call, changing the data as the service would. */
function serveActions(transport: FakeTransport) {
  const read = transport.tool.bind(transport);

  const edit = (id: unknown, change: (task: Task) => Partial<Task>) => {
    transport.tasks = transport.tasks.map((task) =>
      task.id === id ? { ...task, ...change(task) } : task,
    );
  };

  const actions: Record<string, (args: Record<string, unknown>) => unknown> = {
    app_list_commands: () => ({ commands: COMMANDS }),
    app_record_timing: () => ({}),
    app_send_message: (args) => {
      edit(args.task_id, (task) => ({
        queue: [
          ...task.queue,
          {
            id: `q${task.queue.length + 1}`,
            message: String(args.message),
            from: "user",
            delivery: "queue",
          },
        ],
      }));

      return {};
    },
    app_move_queued_message: (args) => {
      edit(args.task_id, ({ queue }) => {
        const moved = queue.filter(({ id }) => id !== args.message_id);
        const message = queue.find(({ id }) => id === args.message_id);
        if (message) moved.splice(Number(args.index), 0, message);

        return { queue: moved };
      });

      return {};
    },
    app_remove_queued_message: (args) => {
      edit(args.task_id, ({ queue }) => ({
        queue: queue.filter(({ id }) => id !== args.message_id),
      }));

      return {};
    },
    app_set_tasks_archived: (args) => {
      const ids = args.task_ids as string[];

      for (const id of ids) {
        edit(id, () => ({ archived_at: args.archived ? AT : undefined }));
      }

      return { task_ids: ids };
    },
  };

  transport.tool = async <T>(
    name: string,
    args: Record<string, unknown> = {},
  ) => {
    const action = actions[name];
    if (!action) return read<T>(name, args);
    transport.calls.push({ name, args });

    return action(args) as T;
  };
}

/**
 * Runs React work until a pass commits nothing, so a scenario starts and ends
 * settled.
 */
export async function settle() {
  for (let pass = 0; pass < 20; pass++) {
    const before = commits();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    if (commits() === before) return;
  }

  throw new Error("The panel kept committing and never settled");
}

/**
 * Mounts the app shell on the base state with the selected task's Chat shown.
 * Clocks are faked so they tick only when a scenario advances them.
 */
export async function mountBase(t: TestContext, layout: Layout = "wide") {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date("2026-11-15T12:05:00.000Z"));
  t.onTestFinished(() => void vi.useRealTimers());

  const mounted = await setup(t, configureBase, {
    wide: layout !== "narrow",
    ...(layout === "scoped" ? { conversation: "thread-one" } : {}),
  });

  await act(() => mounted.controller.select(SELECTED));
  await settle();

  return mounted;
}

export type Mounted = Awaited<ReturnType<typeof mountBase>>;
