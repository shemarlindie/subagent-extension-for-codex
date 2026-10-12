import assert from "node:assert/strict";

import { test } from "vitest";

import { Controller } from "./controller";
import {
  deferred,
  FakeTransport,
  setup,
  task,
} from "./controller-test-harness";
import type { UiStatePersistence } from "./types";

test("targeted file handoff restores its edited draft above the original preview", async (t) => {
  const transport = new FakeTransport();
  transport.tasks = [task("task-1", "/repo/a", "thread-one")];

  transport.context = {
    panel_scope: { conversation_id: "thread-one", repository: "/repo/a" },
  };

  const saved: UiStatePersistence["initial"][] = [];

  const controller = new Controller(
    transport,
    { hidden: () => false, wide: () => true },
    {
      initial: {
        view: { selected: "task-1" },
        dialogs: [
          { kind: "file", taskId: "task-1", path: "src/auth.ts" },
          {
            kind: "handoff",
            taskId: "task-1",
            target: { kind: "file", path: "src/auth.ts" },
            draft: { message: "Why did this authentication check change?" },
          },
        ],
      },
      save: (state) => saved.push(state),
    },
  );

  t.onTestFinished(() => controller.dispose());
  await controller.start();
  const handoff = controller.getSnapshot().dialog;
  assert.equal(handoff?.kind, "handoff");
  if (handoff?.kind !== "handoff") throw new Error("Expected targeted handoff");
  assert.deepEqual(handoff.target, { kind: "file", path: "src/auth.ts" });

  assert.deepEqual(controller.getDialogDraft("handoff"), {
    message: "Why did this authentication check change?",
  });

  controller.saveDialogDraft("handoff", { message: "Edited after reload." });
  assert.equal(saved.at(-1)?.dialogs?.length, 2);
  controller.dismiss();
  const preview = controller.getSnapshot().dialog;
  assert.equal(preview?.kind, "file");
  if (preview?.kind !== "file") throw new Error("Expected original preview");
  assert.equal(preview.path, "src/auth.ts");

  assert.deepEqual(saved.at(-1)?.dialogs, [
    { kind: "file", taskId: "task-1", path: "src/auth.ts" },
  ]);
});

test("preparing a handoff preserves the preview beneath it and replaces an older draft for the target", async (t) => {
  const { controller, transport } = setup(true);
  t.onTestFinished(() => controller.dispose());
  const selected = task("task-1", "/repo/a", "thread-one");

  transport.context = {
    panel_scope: { conversation_id: "thread-one", repository: "/repo/a" },
  };

  transport.tasks = [selected];
  await controller.start();
  controller.open({ kind: "file", task: selected, path: "src/auth.ts" });

  controller.prepareHandoff(
    selected,
    { kind: "file", path: "src/auth.ts" },
    "Selected file evidence.",
  );

  assert.match(
    String(controller.getDialogDraft("handoff")?.message),
    /Selected file evidence\./,
  );

  controller.saveDialogDraft("handoff", { message: "Old unsent draft." });
  controller.dismiss();

  controller.prepareHandoff(
    selected,
    { kind: "file", path: "src/auth.ts" },
    "Updated file evidence.",
  );

  assert.match(
    String(controller.getDialogDraft("handoff")?.message),
    /Updated file evidence\./,
  );

  assert.doesNotMatch(
    String(controller.getDialogDraft("handoff")?.message),
    /Old unsent draft/,
  );

  controller.dismiss();
  const preview = controller.getSnapshot().dialog;
  assert.equal(preview?.kind === "file" && preview.path, "src/auth.ts");
});

test("prepareHandoff rejects a stale task after scope changes and after disposal", async (t) => {
  const { controller, transport } = setup(true);
  t.onTestFinished(() => controller.dispose());
  const stale = task("old-task", "/repo/a", "old-chat");
  transport.tasks = [stale];

  transport.context = {
    panel_scope: { conversation_id: "old-chat", repository: "/repo/a" },
  };

  await controller.start();

  controller.prepareHandoff(
    stale,
    { kind: "reply", id: "old-reply" },
    "Old chat evidence.",
  );

  assert.equal(controller.getSnapshot().dialog?.kind, "handoff");

  controller.applyScope(
    { panel_scope: { conversation_id: "new-chat", repository: "/repo/a" } },
    false,
  );

  assert.equal(controller.getSnapshot().dialog, undefined);

  controller.prepareHandoff(
    stale,
    { kind: "reply", id: "old-reply" },
    "Old chat evidence.",
  );

  assert.equal(controller.getSnapshot().dialog, undefined);
  controller.dispose();

  controller.prepareHandoff(
    stale,
    { kind: "reply", id: "old-reply" },
    "Old chat evidence.",
  );

  assert.equal(controller.getSnapshot().dialog, undefined);
});

test("prepareHandoff does not replace a preview during submission or open after disposal", async (t) => {
  const { controller, transport } = setup(true);
  t.onTestFinished(() => controller.dispose());
  const selected = task("task-1", "/repo/a", "thread-one");

  transport.context = {
    panel_scope: { conversation_id: "thread-one", repository: "/repo/a" },
  };

  transport.tasks = [selected];
  await controller.start();
  controller.open({ kind: "file", task: selected, path: "src/auth.ts" });
  const preview = controller.getSnapshot().dialog;
  const gate = deferred<void>();
  const submitting = controller.submit(() => gate.promise);
  assert.equal(controller.getSnapshot().busy, true);

  controller.prepareHandoff(
    selected,
    { kind: "file", path: "src/auth.ts" },
    "File evidence.",
  );

  assert.equal(controller.getSnapshot().dialog, preview);
  gate.resolve();
  await submitting;
  assert.equal(controller.getSnapshot().dialog, undefined);
  controller.dispose();

  controller.prepareHandoff(
    selected,
    { kind: "reply", id: "reply" },
    "Reply evidence.",
  );

  assert.equal(controller.getSnapshot().dialog, undefined);
});

test("global mode cannot prepare a targeted handoff for a listed task", async (t) => {
  const { controller, transport } = setup(true);
  t.onTestFinished(() => controller.dispose());
  const selected = task("task-1");
  transport.tasks = [selected];
  await controller.start();
  assert.equal(controller.getSnapshot().conversation, undefined);

  controller.prepareHandoff(
    selected,
    { kind: "reply", id: "reply" },
    "Reply evidence.",
  );

  assert.equal(controller.getSnapshot().dialog, undefined);
  controller.open({ kind: "file", task: selected, path: "src/auth.ts" });
  const preview = controller.getSnapshot().dialog;

  controller.prepareHandoff(
    selected,
    { kind: "file", path: "src/auth.ts" },
    "File evidence.",
  );

  assert.equal(controller.getSnapshot().dialog, preview);
});
