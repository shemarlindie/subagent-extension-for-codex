// @vitest-environment jsdom
import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import type { Event } from "../../../src/panel/app/state/types";
import { EVENT_TAIL_SIZE } from "../../../src/panel/features/tasks/activity/event-history";
import { EventList } from "../../../src/panel/features/tasks/activity/event-list";
import { claudeCliSupport } from "../../../src/service/features/providers/claude/configuration/executable";
import { activityKind } from "../../../src/shared/tasks/activity/activity-events";
import { currentActivityStatus } from "../../../src/shared/tasks/activity/activity-status";
import { groupActivity } from "../../../src/shared/tasks/activity/activity-timeline";
import type { Task } from "../../../src/shared/tasks/model";
import {
  PREVIEW_THREAD,
  previewEvents,
  previewLiveStatus,
  previewTasks,
} from "./fixtures";
import { previewTool } from "./tools";

const eventsFor = (taskId: string): Event[] =>
  previewEvents.filter((event) => event.task_id === taskId);

test("preview tasks cover every task status", () => {
  const statuses = new Set(previewTasks.map((task) => task.status));

  for (const status of [
    "queued",
    "starting",
    "running",
    "waiting",
    "interrupted",
    "completed",
    "failed",
  ]) {
    assert.ok(statuses.has(status as never), `missing ${status} task`);
  }
});

test("preview events cover the activity kinds the timeline renders", () => {
  const kinds = new Set(previewEvents.map(activityKind));

  const rows = new Set(
    previewTasks.flatMap((task) =>
      groupActivity(eventsFor(task.id)).map((group) => group.kind),
    ),
  );

  // SDK message kinds are enforced by preview-sdk-fixtures.test.ts.
  for (const kind of [
    "agent.message",
    "agent.content",
    "tool.started",
    "tool.completed",
    "agent.input_required",
    "agent.completed",
    "task.completed",
    "task.failed",
    "task.interrupted",
    "task.instruction",
  ]) {
    assert.ok(kinds.has(kind), `no preview event of kind ${kind}`);
  }

  for (const row of [
    "message",
    "tool",
    "operation",
    "status",
    "stream",
    "event",
  ]) {
    assert.ok(rows.has(row as never), `no preview ${row} row`);
  }
});

test("a preview task has more events than the activity view keeps", () => {
  const longest = Math.max(
    ...previewTasks.map((task) => eventsFor(task.id).length),
  );

  assert.ok(
    longest > EVENT_TAIL_SIZE,
    `longest preview task has ${longest} events; the view keeps ${EVENT_TAIL_SIZE}`,
  );
});

test("every preview event lands in exactly one activity group", () => {
  for (const task of previewTasks) {
    const events = eventsFor(task.id);

    const grouped = groupActivity(events).flatMap((group) =>
      group.events.map((event) => event.id),
    );

    assert.deepEqual(
      [...grouped].sort((a, b) => a - b),
      events.map((event) => event.id).sort((a, b) => a - b),
      `${task.id} events are lost or duplicated`,
    );
  }
});

test("preview ids are unique and every activity timeline renders", () => {
  const ids = previewEvents.map((event) => `${event.task_id}:${event.id}`);
  assert.equal(new Set(ids).size, ids.length);

  assert.equal(
    new Set(previewTasks.map((task) => task.id)).size,
    previewTasks.length,
  );

  for (const task of previewTasks) {
    const html = renderToStaticMarkup(
      createElement(EventList, { events: eventsFor(task.id) }),
    );

    assert.ok(html.includes("activity-timeline"), `${task.id} did not render`);
  }
});

test("each running preview task ends on a different latest activity", () => {
  const expected: Record<string, string> = {
    ...previewLiveStatus,
    // Streamed text is the latest activity of the long-running permission fixture.
    "preview-refactor": "Responding",
  };

  const seen = new Set<string>();

  for (const [id, status] of Object.entries(expected)) {
    const task = previewTasks.find((candidate) => candidate.id === id)!;
    assert.equal(task.status, "running", `${id} is not running`);
    const live = currentActivityStatus(eventsFor(id), task);
    assert.equal(live.text, status, `${id} status line`);
    seen.add(live.text);
  }

  assert.equal(seen.size, Object.keys(expected).length, "states repeat");
});

type Opened = {
  panel_scope: {
    conversation_id: string | null;
    repository?: string;
    revision?: string;
  };
  panel_project_candidate?: { repository: string; auto_register: boolean };
  tasks: { conversation_id?: string; repository: string }[];
};

const open = (name: string, args: Record<string, unknown> = {}) =>
  previewTool(name, args) as Opened;

test("a thread launch scopes the panel to the thread and one project", () => {
  // The latest task in the thread picks the project when the cwd is unregistered.
  const opened = open("open_codex_subagent_extension", {
    conversation_id: PREVIEW_THREAD,
    host_directory: "file:///elsewhere/repo/src",
  });

  assert.deepEqual(opened.panel_scope, {
    conversation_id: PREVIEW_THREAD,
    repository: "/demo/project",
    revision: "HEAD",
  });

  assert.equal(
    opened.panel_project_candidate?.repository,
    "/elsewhere/repo/src",
  );

  assert.ok(opened.tasks.length > 0);

  for (const task of opened.tasks) {
    assert.equal(task.conversation_id, PREVIEW_THREAD);
    assert.equal(task.repository, "/demo/project");
  }
});

test("a registered thread cwd picks its project over the latest task", () => {
  const opened = open("open_codex_subagent_extension", {
    conversation_id: PREVIEW_THREAD,
    host_directory: "file:///demo/website/assets",
  });

  assert.equal(opened.panel_scope.repository, "/demo/website");
  assert.equal(opened.panel_project_candidate, undefined);
  assert.ok(opened.tasks.length > 0);
  assert.ok(opened.tasks.every((task) => task.repository === "/demo/website"));

  // Plain paths are not file URIs, so the service ignores them.
  assert.equal(
    open("open_codex_subagent_extension", {
      conversation_id: PREVIEW_THREAD,
      host_directory: "/demo/website",
    }).panel_scope.repository,
    "/demo/project",
  );
});

test("a global launch shows every conversation and project", () => {
  const opened = open("app_open_codex_subagent_extension_global");
  assert.deepEqual(opened.panel_scope, { conversation_id: null });
  assert.equal(opened.tasks.length, previewTasks.length);

  assert.ok(
    previewTasks.some((task) => task.conversation_id !== PREVIEW_THREAD),
  );

  assert.ok(previewTasks.some((task) => task.repository !== "/demo/project"));
});

test("listing preview tasks filters by conversation and project", () => {
  const list = (args: Record<string, unknown>) =>
    previewTool("list_agent_tasks", args) as Opened["tasks"];

  assert.equal(list({ conversation_id: null }).length, previewTasks.length);

  const website = list({
    conversation_id: PREVIEW_THREAD,
    repository: "/demo/website",
  });

  assert.ok(website.length > 0);

  assert.ok(
    website.every(
      (task) =>
        task.conversation_id === PREVIEW_THREAD &&
        task.repository === "/demo/website",
    ),
  );
});

test("the chat project candidate follows the auto-add setting", () => {
  const launch = {
    conversation_id: PREVIEW_THREAD,
    host_directory: "file:///repo",
  };

  for (const autoRegisterChatProject of [true, false]) {
    const options = { autoRegisterChatProject };

    const opened = previewTool(
      "open_codex_subagent_extension",
      launch,
      options,
    ) as Opened;

    assert.deepEqual(opened.panel_project_candidate, {
      repository: "/repo",
      auto_register: autoRegisterChatProject,
    });

    const settings = previewTool("get_agent_settings", {}, options) as {
      values: Record<string, unknown>;
    };

    assert.equal(
      settings.values.auto_register_chat_project,
      autoRegisterChatProject,
    );
  }

  // The service defaults to adding chat projects.
  assert.equal(
    open("open_codex_subagent_extension", launch).panel_project_candidate
      ?.auto_register,
    true,
  );
});

test("a cwd's Git root is offered and a cwd with whitespace has none", () => {
  for (const [host_directory, candidate] of [
    ["file:///repo", "/repo"],
    ["file:///demo/project%20/demo/project", undefined],
  ] as const) {
    const opened = open("open_codex_subagent_extension", {
      conversation_id: PREVIEW_THREAD,
      host_directory,
    });

    assert.equal(
      opened.panel_project_candidate?.repository,
      candidate,
      host_directory,
    );

    // The thread keeps its own project either way.
    assert.equal(opened.panel_scope.repository, "/demo/project");
  }
});

test("fixture registration validates the root and the caller keeps it", () => {
  assert.deepEqual(
    previewTool("app_register_project", { repository: "/new/repo/" }),
    { repository: "/new/repo", kind: "repository" },
  );

  for (const repository of ["relative/repo", "/demo/project/src", "/a b"]) {
    assert.throws(() => previewTool("app_register_project", { repository }));
  }

  // Nothing is remembered until the caller passes it back.
  const fixed = previewTool("list_agent_projects") as { repository: string }[];
  assert.ok(!fixed.some((project) => project.repository === "/new/repo"));
  const options = { addedProjects: ["/new/repo"] };

  const listed = previewTool("list_agent_projects", {}, options) as {
    repository: string;
    name: string;
  }[];

  assert.deepEqual(listed.at(-1), {
    repository: "/new/repo",
    name: "repo",
    kind: "repository",
  });

  // An added chat project is registered, so the thread scopes to it.
  const opened = previewTool(
    "open_codex_subagent_extension",
    { conversation_id: PREVIEW_THREAD, host_directory: "file:///new/repo/src" },
    options,
  ) as Opened;

  assert.equal(opened.panel_scope.repository, "/new/repo");
  assert.equal(opened.panel_project_candidate, undefined);

  // An added project's folders are not roots either.
  assert.throws(
    () =>
      previewTool(
        "app_register_project",
        { repository: "/new/repo/src" },
        options,
      ),
    /Use repository root/,
  );
});

test("an explicit revision scopes the panel to that revision", () => {
  const context = (args: Record<string, unknown>) =>
    (previewTool("get_agent_panel_context", args) as Opened).panel_scope;

  assert.equal(
    context({ conversation_id: PREVIEW_THREAD, revision: "v2" }).revision,
    "v2",
  );

  assert.equal(context({ conversation_id: PREVIEW_THREAD }).revision, "HEAD");
});

test("fixture task renaming updates listed titles and validates input", () => {
  const [task] = previewTasks;
  assert.ok(task);
  const originalTitle = task.title;

  try {
    previewTool("app_rename_task", {
      task_id: task.id,
      title: "  Renamed task  ",
    });

    const tasks = previewTool("list_agent_tasks") as typeof previewTasks;

    assert.equal(
      tasks.find((entry) => entry.id === task.id)?.title,
      "Renamed task",
    );

    assert.throws(() =>
      previewTool("app_rename_task", { task_id: task.id, title: " " }),
    );

    assert.throws(() =>
      previewTool("app_rename_task", {
        task_id: "missing",
        title: "Title",
      }),
    );
  } finally {
    task.title = originalTitle;
  }
});

test("fixture queues reorder, edit and remove in memory behind a left-over steer", () => {
  const task = previewTasks.find(
      (candidate) => candidate.id === "preview-paused",
    )!,
    original = structuredClone(task.queue);

  const order = () =>
    (previewTool("list_agent_tasks") as Task[])
      .find((entry) => entry.id === task.id)!
      .queue.map((m) => m.id);

  const call = (name: string, args: Record<string, unknown>) =>
    previewTool(name, { task_id: task.id, ...args });

  try {
    const [steer, queued, later] = original.map((m) => m.id);
    assert.deepEqual(order(), [steer, queued, later]);

    call("app_move_queued_message", { message_id: later, index: 0 });
    assert.deepEqual(order(), [steer, later, queued]);

    assert.throws(
      () => call("app_move_queued_message", { message_id: steer, index: 2 }),
      /stays at the front/,
    );

    call("app_edit_queued_message", {
      message_id: later,
      message: "Edited",
    });

    const [, edited] = task.queue;
    assert.ok(edited);
    assert.equal(edited.message, "Edited");
    call("app_remove_queued_message", { message_id: later });
    assert.deepEqual(order(), [steer, queued]);
    call("app_clear_queue", {});
    assert.deepEqual(order(), []);
    assert.equal(task.queue_paused, undefined);

    assert.throws(() => call("app_resume_queue", {}), /Design preview only/);
  } finally {
    task.queue = original;
    task.queue_paused = true;
  }
});

test("fixture sends queue or steer a busy task in memory, never starting a turn", () => {
  const find = (id: string) => previewTasks.find((task) => task.id === id)!,
    running = find("preview-steering"),
    input = find("preview-input"),
    saved = [running, input].map((task) => ({
      task,
      queue: structuredClone(task.queue),
      steers: structuredClone(task.pending_steers),
    }));

  const send = (task: Task, delivery: string) =>
    previewTool("app_send_message", {
      task_id: task.id,
      message: `To ${task.id} by ${delivery}`,
      delivery,
    }) as { message_id: string; state: string };

  try {
    const queued = send(running, "queue");
    assert.equal(queued.state, "queued");
    assert.equal(running.queue.at(-1)!.id, queued.message_id);
    assert.equal(running.queue.at(-1)!.message, "To preview-steering by queue");
    const message = { ...running.queue.at(-1)! };

    previewTool("app_steer_queued_message", {
      task_id: running.id,
      message_id: queued.message_id,
    });

    assert.equal(
      running.queue.some((m) => m.id === message.id),
      false,
    );

    assert.deepEqual(running.pending_steers.at(-1), {
      id: message.id,
      message: message.message,
      from: message.from,
    });

    const steered = send(running, "steer");
    assert.equal(steered.state, "started");
    assert.equal(running.pending_steers.at(-1)!.id, steered.message_id);
    assert.throws(() => send(running, "interrupt"), /Design preview only/);
    assert.throws(() => send(input, "steer"), /waiting for input/);
    assert.equal(send(input, "queue").state, "queued");

    assert.throws(
      () =>
        previewTool("app_steer_queued_message", {
          task_id: input.id,
          message_id: input.queue.at(-1)!.id,
        }),
      /busy and accepts input/,
    );

    assert.throws(
      () => send(find("preview-paused"), "queue"),
      /Design preview only/,
    );
  } finally {
    for (const { task, queue, steers } of saved) {
      task.queue = queue;
      task.pending_steers = steers;
    }
  }
});

test("successful budget updates can be enabled for preview fixtures", () => {
  const cases = [
    {
      id: "preview-budget",
      raise: { max_cost_usd: 8 },
      raised: { turn: 1, cost: true },
    },
    {
      id: "preview-runtime-budget",
      raise: { max_runtime_minutes: 30 },
      raised: { turn: 1, runtime: true },
    },
    // Only limits that actually increased are marked.
    {
      id: "preview-budget",
      raise: { max_cost_usd: 2, max_runtime_minutes: 30 },
      raised: { turn: 1, runtime: true },
    },
  ] as const;

  for (const { id, raise, raised } of cases) {
    const task = previewTasks.find((candidate) => candidate.id === id)!;
    const originalBudget = { ...task.budget };
    const originalRaise = task.budget_raised_for_turn;

    try {
      const args = { task_id: id, budget: raise };

      assert.throws(
        () => previewTool("app_raise_budget", args),
        /Design preview only/,
      );

      const result = previewTool("app_raise_budget", args, {
        successfulBudgetUpdates: true,
      }) as { budget: Task["budget"]; status: Task["status"] };

      assert.equal(result.status, task.status);
      assert.deepEqual(result.budget, { ...originalBudget, ...raise });
      assert.deepEqual(task.budget_raised_for_turn, raised);

      const listed = (previewTool("list_agent_tasks") as Task[]).find(
        (candidate) => candidate.id === id,
      );

      assert.deepEqual(listed?.budget, task.budget);

      assert.throws(
        () =>
          previewTool(
            "app_raise_budget",
            {
              task_id: id,
              budget:
                "max_runtime_minutes" in raise
                  ? { max_runtime_minutes: originalBudget.max_runtime_minutes }
                  : { max_cost_usd: originalBudget.max_cost_usd },
            },
            { successfulBudgetUpdates: true },
          ),
        /can only be raised/,
      );
    } finally {
      task.budget = originalBudget;
      if (originalRaise) task.budget_raised_for_turn = originalRaise;
      else delete task.budget_raised_for_turn;
    }
  }
});

test("the Claude unavailable option reports the worker not ready and skips its models", () => {
  type Worker = {
    models?: unknown[];
    readiness: {
      ready: boolean;
      message?: string;
      details: Record<string, string>;
    };
  };

  const [ready] = previewTool("list_available_workers", {}) as Worker[];
  assert.ok(ready);
  assert.equal(ready.readiness.ready, true);
  assert.ok(ready.models?.length);

  const [unavailable] = previewTool(
    "list_available_workers",
    {},
    { claudeUnavailable: true },
  ) as Worker[];

  assert.ok(unavailable);
  assert.equal(unavailable.readiness.ready, false);
  assert.match(unavailable.readiness.message!, /older than the supported/);
  assert.equal(unavailable.models, undefined);

  // The fixtures repeat the supported range, which must follow the service's.
  const range = `${claudeCliSupport.minimum}+`;

  for (const worker of [ready, unavailable]) {
    assert.equal(worker.readiness.details.supported_versions, range);
  }

  assert.ok(unavailable.readiness.message!.includes(range));
});
