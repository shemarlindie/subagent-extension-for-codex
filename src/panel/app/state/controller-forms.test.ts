import assert from "node:assert/strict";

import { test } from "vitest";

import {
  defaults,
  deferred,
  flush,
  setup,
  task,
} from "./controller-test-harness";
import type { Defaults, Task } from "./types";

test("settings opens before its read and keeps its draft across scope changes", async (t) => {
  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());
  await controller.start();

  const settingsRead = deferred<{ sections: never[]; values: Defaults }>();

  transport.handler = (name) =>
    name === "get_agent_settings" ? settingsRead.promise : undefined;

  await controller.settings();
  assert.equal(controller.getSnapshot().dialog?.kind, "settings-loading");

  controller.saveSettingsSection("models");

  assert.deepEqual(controller.getDialogDraft("settings")?.openSections, [
    "models",
  ]);

  controller.applyScope(
    { panel_scope: { conversation_id: "another-chat" } },
    false,
  );

  assert.equal(controller.getSnapshot().dialog?.kind, "settings-loading");

  assert.deepEqual(controller.getDialogDraft("settings")?.openSections, [
    "models",
  ]);

  settingsRead.resolve({ sections: [], values: defaults });
  await flush();

  assert.equal(controller.getSnapshot().dialog?.kind, "settings");
  assert.equal(controller.getLastSettingsSection(), "models");

  assert.deepEqual(controller.getDialogDraft("settings")?.openSections, [
    "models",
  ]);
});

test("form updates preserve other state saved for the same dialog", (t) => {
  const { controller } = setup();
  t.onTestFinished(() => controller.dispose());

  controller.open({ kind: "handoff", task: task("task-1") });
  controller.saveDialogField("handoff", "openSections", ["advanced"]);
  controller.saveDialogDraft("handoff", { message: "keep going" });

  assert.deepEqual(controller.getDialogDraft("handoff"), {
    openSections: ["advanced"],
    message: "keep going",
  });
});

test("refresh preserves dialog identity and reviewed defaults while discovering new projects", async (t) => {
  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());
  await controller.start();
  await controller.delegate();
  await flush();
  const dialog = controller.getSnapshot().dialog;
  assert.equal(dialog?.kind, "delegate");
  if (dialog?.kind !== "delegate") throw new Error("Expected delegate dialog");
  assert.equal(dialog.defaults.max_runtime_minutes, 0.5);
  assert.equal(dialog.defaults.max_cost_usd, null);

  transport.projects = [
    ...transport.projects,
    { repository: "/repo/b", kind: "repository" },
  ];

  await controller.refresh();
  assert.equal(controller.getSnapshot().dialog, dialog);
  assert.equal(controller.getSnapshot().projects.length, 2);
});

test("delegation project lookup discarded when conversation changes", async (t) => {
  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());
  await controller.start();
  const gate = deferred<{ values: Defaults }>();

  transport.handler = (name) =>
    name === "get_agent_settings" ? gate.promise : undefined;

  const opening = controller.delegate();
  await flush();
  assert.equal(controller.getSnapshot().dialog?.kind, "delegate-loading");
  controller.saveDialogField("delegate", "description", "Keep this draft");

  assert.equal(
    controller.getDialogDraft("delegate")?.description,
    "Keep this draft",
  );

  let submitted = false;

  await controller.submit(async () => {
    submitted = true;
  });

  assert.equal(submitted, false);
  assert.equal(controller.getSnapshot().busy, false);

  controller.applyScope(
    { panel_scope: { conversation_id: "another-chat" } },
    false,
  );

  gate.resolve({ values: defaults });
  await opening;
  await flush();
  assert.equal(controller.getSnapshot().dialog, undefined);
});

test("in-flight mutation never selects its returned task after the host changes scope", async (t) => {
  const { controller } = setup();
  t.onTestFinished(() => controller.dispose());
  await controller.start();
  await controller.delegate();
  await flush();
  const original = controller.getSnapshot().dialog;
  const gate = deferred<Task>();
  let navigated = false;

  const submitting = controller.submit(
    () => gate.promise,
    true,
    () => {
      navigated = true;
    },
  );

  controller.applyScope(
    { panel_scope: { conversation_id: "new-chat", repository: "/repo/b" } },
    false,
  );

  assert.equal(controller.getSnapshot().busy, true);
  gate.resolve(task("old-outcome"));
  await submitting;
  assert.equal(controller.getSnapshot().selected, undefined);
  assert.equal(controller.getSnapshot().dialog, original);
  assert.equal(controller.getSnapshot().busy, false);
  assert.match(controller.getSnapshot().formError, /original scope/);
  assert.equal(navigated, false);
  let retryCalls = 0;

  await controller.submit(async () => {
    retryCalls++;
  });

  assert.equal(retryCalls, 0);
  assert.match(controller.getSnapshot().formError, /reopen/);
});

test("approved parent roots allow delegation in a scoped subrepository", async (t) => {
  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());
  transport.projects = [{ repository: "/repo", kind: "parent" }];

  controller.applyScope(
    {
      panel_scope: {
        conversation_id: null,
        repository: "/repo/sub",
        revision: "feature",
      },
    },
    false,
  );

  await controller.start();
  await controller.delegate();
  await flush();
  assert.equal(controller.getSnapshot().dialog?.kind, "delegate");
  const dialog = controller.getSnapshot().dialog;

  if (dialog?.kind === "delegate") {
    assert.equal(dialog.repository, "/repo/sub");
    assert.equal(dialog.revision, "feature");
  }
});

test("automatic global history does not prefill delegation, while an intentional selection does", async (t) => {
  const { controller, transport } = setup(true);
  t.onTestFinished(() => controller.dispose());
  transport.tasks = [task("history", "/history")];

  transport.projects = [
    { repository: "/repo/a", kind: "repository" },
    { repository: "/repo/b", kind: "repository" },
    { repository: "/history", kind: "repository" },
  ];

  await controller.start();
  await controller.delegate();
  await flush();
  let dialog = controller.getSnapshot().dialog;

  assert.equal(
    dialog?.kind === "delegate" ? dialog.repository : "wrong dialog",
    undefined,
  );

  controller.dismiss();
  await controller.select("history");
  await controller.delegate();
  await flush();
  dialog = controller.getSnapshot().dialog;

  assert.equal(
    dialog?.kind === "delegate" ? dialog.repository : undefined,
    "/history",
  );
});

test("New task offers the chat project only when auto-add is on and adds it before starting", async (t) => {
  for (const auto of [false, true]) {
    const { controller, transport } = setup();
    t.onTestFinished(() => controller.dispose());

    controller.applyScope(
      {
        panel_scope: { conversation_id: "chat-a" },
        panel_project_candidate: {
          repository: "/repo/chat",
          auto_register: auto,
        },
      },
      false,
    );

    await controller.start();
    await controller.delegate();
    await flush();
    const dialog = controller.getSnapshot().dialog;
    assert.equal(dialog?.kind, "delegate");

    if (dialog?.kind === "delegate") {
      assert.equal(dialog.repository, auto ? "/repo/chat" : "/repo/a");
    }

    // A registered project never triggers registration.
    await controller.addChatProjectForTask("/repo/a");

    transport.handler = (name) => {
      if (name === "list_agent_projects") {
        return [
          ...transport.projects,
          { repository: "/repo/chat", kind: "repository" },
        ];
      }

      if (name === "register_user_agent_project") {
        return { repository: "/repo/chat", kind: "repository" };
      }

      return undefined;
    };

    await controller.addChatProjectForTask("/repo/chat");

    const registrations = transport.calls.filter(
      (call) => call.name === "register_user_agent_project",
    );

    assert.deepEqual(
      registrations.map((call) => call.args),
      auto ? [{ repository: "/repo/chat" }] : [],
    );

    assert.equal(
      controller.getSnapshot().projectCandidate,
      auto ? undefined : "/repo/chat",
    );
  }
});

test("permission decisions submit the request id and optional worker message", async (t) => {
  const { controller, transport } = setup();

  t.onTestFinished(() => controller.dispose());

  transport.handler = (name) =>
    name === "submit_agent_input" ? {} : undefined;

  const pendingTask: Task = {
    ...task("task-1"),
    pending_input: {
      id: "request-1",
      tool: "Bash",
      kind: "permission",
      input: { command: "npm run typecheck" },
    },
  };

  await controller.decidePermission(pendingTask, true, "Run only the checks.");

  assert.deepEqual(transport.calls, [
    {
      name: "submit_agent_input",
      args: {
        task_id: "task-1",
        request_id: "request-1",
        approved: true,
        message: "Run only the checks.",
      },
    },
  ]);
});

test("a removed task invalidates a busy dialog once and cannot select its late result", async (t) => {
  const { controller, transport } = setup(true);
  t.onTestFinished(() => controller.dispose());
  const original = task("removed");
  transport.tasks = [original];
  await controller.start();
  transport.events.host({ ...controller.getSnapshot().host, canShare: true });
  controller.open({ kind: "delete", task: original });
  const gate = deferred<Task>();
  const submitting = controller.submit(() => gate.promise, true);
  const version = controller.getSnapshot().scopeVersion;
  transport.tasks = [task("remaining", "/repo/b")];
  await controller.refresh();
  await flush();
  await controller.refresh();
  assert.equal(controller.getSnapshot().scopeVersion, version + 1);
  assert.equal(controller.getSnapshot().selected, "remaining");
  assert.equal(transport.shared.at(-1)?.selected_task, "remaining");
  gate.resolve(original);
  await submitting;
  assert.equal(controller.getSnapshot().selected, "remaining");
  assert.match(controller.getSnapshot().formError, /original scope/);
});

test("revoking the edited delegation repository rejects selection of an in-flight result", async (t) => {
  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());
  transport.projects.push({ repository: "/repo/b", kind: "repository" });
  await controller.start();
  await controller.delegate();
  await flush();
  controller.saveDialogField("delegate", "repository", "/repo/b");
  const gate = deferred<Task>();
  const submitting = controller.submit(() => gate.promise, true);

  transport.projects = transport.projects.filter(
    (project) => project.repository !== "/repo/b",
  );

  await controller.refresh();
  gate.resolve(task("late", "/repo/b"));
  await submitting;
  assert.equal(controller.getSnapshot().selected, undefined);
  assert.match(controller.getSnapshot().formError, /original scope/);
});
