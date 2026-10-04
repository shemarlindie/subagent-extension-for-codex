// @vitest-environment jsdom
import assert from "node:assert/strict";
import { test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  previewTasks,
  previewEvents,
  previewArtifacts,
  previewLiveStatus,
  PREVIEW_THREAD,
} from "../ui/transports/preview-fixtures";
import { previewTool } from "../ui/transports/preview-tools";
import {
  groupActivity,
  activityKind,
  currentActivityStatus,
} from "../ui/core/activity-timeline";
import { EventList } from "../ui/components/event-list";
import { EVENT_TAIL_SIZE } from "../ui/core/event-history";
import type { Event } from "../ui/core/types";

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
    "cancelled",
  ])
    assert.ok(statuses.has(status as never), `missing ${status} task`);
});

test("preview events cover the activity kinds the timeline renders", () => {
  const kinds = new Set(previewEvents.map(activityKind));
  const rows = new Set(
    previewTasks.flatMap((task) =>
      groupActivity(eventsFor(task.id)).map((group) => group.kind),
    ),
  );
  for (const kind of [
    "agent.message",
    "agent.content",
    "tool.started",
    "tool.completed",
    "tool_progress",
    "stream_event",
    "hook_started",
    "hook_response",
    "task_started",
    "task_progress",
    "task_updated",
    "task_notification",
    "api_retry",
    "compact_boundary",
    "files_persisted",
    "notification",
    "permission_denied",
    "mirror_error",
    "rate_limit_event",
    "thinking_tokens",
    "agent.input_required",
    "agent.completed",
    "task.completed",
    "task.failed",
    "task.cancelled",
    "task.continued",
    "artifact.created",
    "prompt_suggestion",
    "tool_use_summary",
  ])
    assert.ok(kinds.has(kind), `no preview event of kind ${kind}`);
  for (const row of [
    "message",
    "tool",
    "operation",
    "status",
    "stream",
    "event",
  ])
    assert.ok(rows.has(row as never), `no preview ${row} row`);
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
  for (const artifact of previewArtifacts)
    assert.ok(
      previewTasks.some((task) => task.id === artifact.task_id),
      `${artifact.id} belongs to an unknown task`,
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
  const opened = open("open_codex_subagent_extension_global");
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

test("a cwd with whitespace has no Git root, so nothing is offered", () => {
  const opened = open("open_codex_subagent_extension", {
    conversation_id: PREVIEW_THREAD,
    host_directory: "file:///demo/project%20/demo/project",
  });
  assert.equal(opened.panel_project_candidate, undefined);
  assert.equal(opened.panel_scope.repository, "/demo/project");
});

test("fixture registration validates the root and the caller keeps it", () => {
  assert.deepEqual(
    previewTool("register_user_agent_project", { repository: "/new/repo/" }),
    { repository: "/new/repo", kind: "repository" },
  );
  for (const repository of ["relative/repo", "/demo/project/src", "/a b"])
    assert.throws(() =>
      previewTool("register_user_agent_project", { repository }),
    );
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
        "register_user_agent_project",
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
