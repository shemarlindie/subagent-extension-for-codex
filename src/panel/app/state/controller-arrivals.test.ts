import { expect, test } from "vitest";

import { deferred, flush, setup, task } from "./controller-test-harness";

test("a fallback selection does not announce the task it opens", async (t) => {
  const { controller, transport } = setup(true);
  t.onTestFinished(() => controller.dispose());
  transport.tasks = [task("old")];
  await controller.start();
  transport.tasks = [task("new")];
  await controller.refresh();
  expect(controller.getSnapshot().selected).toBe("new");
  expect(controller.getSnapshot().taskArrival).toBeUndefined();
});

test("a selected arrival does not hide another newly listed task", async (t) => {
  const { controller, transport } = setup(true);
  t.onTestFinished(() => controller.dispose());
  transport.tasks = [task("old")];
  await controller.start();
  await controller.select("selected-new");
  transport.tasks = [task("selected-new"), task("new-other"), task("old")];
  await controller.refresh();
  expect(controller.getSnapshot().selected).toBe("selected-new");
  expect(controller.getSnapshot().taskArrival?.id).toBe("new-other");
});

test("initial and changed scopes establish a baseline without announcing existing tasks", async (t) => {
  const { controller, transport } = setup(true);
  t.onTestFinished(() => controller.dispose());
  transport.tasks = [task("old")];
  await controller.start();
  expect(controller.getSnapshot().taskArrival).toBeUndefined();

  transport.tasks = [task("new"), task("old")];
  await controller.refresh();
  expect(controller.getSnapshot().taskArrival?.id).toBe("new");

  controller.applyScope(
    { panel_scope: { conversation_id: "another-chat" } },
    false,
  );

  expect(controller.getSnapshot().taskArrival).toBeUndefined();
  transport.tasks = [task("scoped", "/repo/a", "another-chat")];
  await controller.refresh();
  expect(controller.getSnapshot().taskArrival).toBeUndefined();
});

test("previously seen, archived and out-of-scope tasks do not produce arrivals", async (t) => {
  const { controller, transport } = setup(true);
  t.onTestFinished(() => controller.dispose());

  controller.applyScope({ panel_scope: { conversation_id: "chat" } }, false);

  const old = task("old", "/repo/a", "chat");
  const seen = task("seen", "/repo/a", "chat");
  transport.tasks = [old, seen];
  await controller.start();
  transport.tasks = [old];
  await controller.refresh();

  transport.tasks = [
    { ...task("archived", "/repo/a", "chat"), archived_at: "2026-10-21" },
    task("other-chat", "/repo/a", "elsewhere"),
    seen,
    old,
  ];

  await controller.refresh();
  expect(controller.getSnapshot().taskArrival).toBeUndefined();

  transport.tasks = [seen, old];
  await controller.refresh();
  expect(controller.getSnapshot().taskArrival).toBeUndefined();
});

test("Done loads the read completed tasks the list left out without announcing them, while a newer one still arrives", async (t) => {
  const { controller, transport } = setup(true);
  t.onTestFinished(() => controller.dispose());

  const completed = (id: string, created_at: string) => ({
    ...task(id),
    status: "completed" as const,
    created_at,
  });

  const read = completed("read", "2026-01-01T00:00:00.000Z");
  const newest = completed("newest", "2026-01-02T00:00:00.000Z");
  let listed = [newest];

  transport.handler = (name, args) => {
    if (name !== "app_list_tasks") return undefined;

    return args.include_read_completed
      ? { tasks: [...listed, read] }
      : { tasks: listed, read_completed: { "/repo/a": 1 } };
  };

  const ids = () => controller.getSnapshot().tasks.map((item) => item.id);

  // With nothing unfinished, the default filter is Done, so they load.
  await controller.start();
  await flush();
  expect(ids()).toEqual(["newest", "read"]);
  expect(controller.getSnapshot().taskArrival).toBeUndefined();

  controller.setFilter("active");
  await controller.refresh();
  expect(ids()).toEqual(["newest"]);
  expect(controller.getSnapshot().readCompleted).toEqual({ "/repo/a": 1 });

  controller.setFilter("completed");
  await flush();
  expect(ids()).toEqual(["newest", "read"]);
  expect(controller.getSnapshot().readCompleted).toBeUndefined();

  // A task that finished and was read in another panel still arrives.
  listed = [completed("elsewhere", "2026-01-03T00:00:00.000Z"), newest];
  await controller.refresh();
  expect(controller.getSnapshot().taskArrival?.id).toBe("elsewhere");
});

for (const guard of ["compose", "back", "dialog", "page", "busy"] as const) {
  test(`arrivals stay silent while ${guard} and do not surface after returning`, async (t) => {
    const { controller, transport } = setup(true);
    t.onTestFinished(() => controller.dispose());
    transport.tasks = [task("old")];
    await controller.start();
    const pending = deferred<void>();
    let action: Promise<unknown> | undefined;

    if (guard === "compose") controller.newTasks.open();
    if (guard === "back") controller.back();
    if (guard === "dialog") controller.addProject();
    if (guard === "page") controller.navigate("projects");

    if (guard === "busy") {
      transport.handler = (name) =>
        name === "app_raise_budget" ? pending.promise : undefined;

      action = controller.taskActions.applyBudget(task("old"), {
        max_runtime_minutes: 30,
      });
    }

    const selected = controller.getSnapshot().selected;
    transport.tasks = [task("new"), task("old")];
    await controller.refresh();
    expect(controller.getSnapshot().selected).toBe(selected);
    expect(controller.getSnapshot().taskArrival).toBeUndefined();

    if (guard === "dialog") controller.dismiss();
    if (guard === "page") controller.backToTasks();
    pending.resolve();
    await action;
    await controller.select("old");
    await controller.refresh();
    expect(controller.getSnapshot().taskArrival).toBeUndefined();
  });
}

test("a delayed arrival preserves a selection made after its read started", async (t) => {
  const { controller, transport } = setup(true);
  t.onTestFinished(() => controller.dispose());
  transport.tasks = [task("old"), task("other")];
  await controller.start();
  const pending = deferred<{ tasks: ReturnType<typeof task>[] }>();

  transport.handler = (name) =>
    name === "app_list_tasks" ? pending.promise : undefined;

  const refresh = controller.refresh();
  await flush();
  await controller.select("other");
  transport.tasks = [task("new"), task("old"), task("other")];
  pending.resolve({ tasks: transport.tasks });
  await refresh;
  expect(controller.getSnapshot().selected).toBe("other");
  expect(controller.getSnapshot().taskArrival).toBeUndefined();

  transport.handler = undefined;
  await controller.refresh();
  expect(controller.getSnapshot().taskArrival).toBeUndefined();
});

test("View cannot leave a dialog opened after an arrival", async (t) => {
  const { controller, transport } = setup(true);
  t.onTestFinished(() => controller.dispose());
  transport.tasks = [task("old")];
  await controller.start();
  transport.tasks = [task("new"), task("old")];
  await controller.refresh();
  controller.addProject();
  const dialog = controller.getSnapshot().dialog;
  await controller.viewTaskArrival();
  expect(controller.getSnapshot().selected).toBe("old");
  expect(controller.getSnapshot().dialog).toBe(dialog);
});
