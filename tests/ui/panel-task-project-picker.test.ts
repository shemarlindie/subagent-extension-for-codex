// @vitest-environment jsdom
import { expect } from "vitest";

import {
  act,
  assert,
  configureProjectRegistration,
  enterTask,
  openAdvancedTask,
  pasteText,
  screen,
  selectedProjectPath,
  selectOption,
  setup,
  setupDelegate,
  startedTask,
  test,
  waitFor,
  within,
} from "./panel-test-support";

test("approved parent project suggestions allow an unlisted nested repository path", async (t) => {
  const { transport, user } = await setupDelegate(t, (transport) => {
    transport.projects.push({ repository: "/approved", kind: "parent" });
  });

  await screen.findByRole("dialog");

  const project = screen.getByRole("combobox", {
    name: "Project",
  });

  await user.clear(project);
  await pasteText(user, project, "/approved/new/nested-repo");
  await user.keyboard("{Escape}");
  assert.ok(screen.getByRole("dialog"));
  await enterTask(user, "Review nested repository");
  await user.click(screen.getByRole("button", { name: "Start task" }));

  await waitFor(() =>
    assert.equal(
      transport.calls.find((call) => call.name === "start_task")?.args
        .repository,
      "/approved/new/nested-repo",
    ),
  );
});

test("approved parent project suggestions find saved names and submit the selected repository path", async (t) => {
  const { transport, user } = await setupDelegate(t, (transport) => {
    transport.projects.push(
      { repository: "/approved", kind: "parent" },
      {
        repository: "/approved/client",
        kind: "repository",
        name: "Client Portal",
      },
    );
  });

  await screen.findByRole("dialog");

  const project = screen.getByRole("combobox", { name: "Project" });

  await user.clear(project);
  await pasteText(user, project, "CLIENT PORTAL");

  const suggestion = await screen.findByRole("option", {
    name: /Client Portal/,
  });

  expect(screen.getAllByRole("option")).toHaveLength(1);
  expect(suggestion.textContent).toContain("/approved/client");
  await user.click(suggestion);
  expect((project as HTMLInputElement).value).toBe("/approved/client");
  await enterTask(user, "Review the client portal");
  await user.click(screen.getByRole("button", { name: "Start task" }));

  await waitFor(() =>
    expect(
      transport.calls.find((call) => call.name === "start_task")?.args
        .repository,
    ).toBe("/approved/client"),
  );
});

test("browsing a project inside delegation preserves the draft and starts only after Start task", async (t) => {
  const { controller, transport, user } = await setup(t, (transport) =>
    configureProjectRegistration(transport, {
      picked: "/repo/alias",
      canonicalRepository: "/repo/canonical",
    }),
  );

  await openAdvancedTask(user);
  const dialog = await screen.findByRole("dialog");
  await enterTask(user, "Review this new project with my draft intact");
  await selectOption(user, "Worker", "fixture · reviewer");
  const runtime = screen.getByLabelText("Runtime limit (mins)");
  await user.clear(runtime);
  await pasteText(user, runtime, "12.5");
  const scope = controller.getSnapshot().repository;
  await user.click(within(dialog).getByRole("button", { name: "Browse…" }));

  await waitFor(() =>
    assert.match(
      within(dialog).getByRole("combobox", { name: "Project" }).textContent ??
        "",
      /canonical/,
    ),
  );

  assert.equal(controller.getSnapshot().repository, scope);

  assert.equal(
    within(dialog).getByLabelText<HTMLTextAreaElement>("Description").value,
    "Review this new project with my draft intact",
  );

  assert.equal((runtime as HTMLInputElement).value, "12.5");

  assert.match(
    within(dialog).getByRole("combobox", { name: "Worker" }).textContent ?? "",
    /fixture/,
  );

  assert.equal(
    transport.calls.filter((call) => call.name === "start_task").length,
    0,
  );

  assert.deepEqual(
    transport.calls.find((call) => call.name === "app_register_project")?.args,
    { repository: "/repo/alias" },
  );

  await user.click(within(dialog).getByRole("button", { name: "Start task" }));

  const started = await startedTask(transport);

  assert.equal(started.args.repository, "/repo/canonical");

  assert.equal(
    started.args.description,
    "Review this new project with my draft intact",
  );

  assert.equal(started.args.provider, "fixture");

  assert.equal(
    (started.args.budget as { max_runtime_minutes: number })
      .max_runtime_minutes,
    12.5,
  );
});

test("task project registration failure preserves the selected project and draft", async (t) => {
  const { transport, user } = await setupDelegate(t, (transport) =>
    configureProjectRegistration(transport, {
      picked: "/repo/new/src",
      registerError: "Use repository root",
    }),
  );

  const dialog = await screen.findByRole("dialog");
  await enterTask(user, "Keep this description after registration failure");
  await user.click(within(dialog).getByRole("button", { name: "Browse…" }));
  await within(dialog).findByText("Use repository root");

  assert.equal(selectedProjectPath(), "/repo/a");

  assert.equal(
    within(dialog).getByLabelText<HTMLTextAreaElement>("Description").value,
    "Keep this description after registration failure",
  );

  assert.equal(
    transport.calls.filter((call) => call.name === "start_task").length,
    0,
  );
});

test("cancelling the task project picker preserves selection and task draft without registering", async (t) => {
  const { transport, user } = await setupDelegate(t, (transport) =>
    configureProjectRegistration(transport),
  );

  const dialog = await screen.findByRole("dialog");
  await enterTask(user, "Preserve task while browsing");
  await user.click(within(dialog).getByRole("button", { name: "Browse…" }));

  await waitFor(() =>
    assert.equal(
      within(dialog).getByRole<HTMLButtonElement>("button", {
        name: "Browse…",
      }).disabled,
      false,
    ),
  );

  assert.equal(selectedProjectPath(), "/repo/a");

  assert.equal(
    within(dialog).getByLabelText<HTMLTextAreaElement>("Description").value,
    "Preserve task while browsing",
  );

  assert.equal(
    transport.calls.filter((call) => call.name === "app_register_project")
      .length,
    0,
  );

  assert.equal(
    transport.calls.filter((call) => call.name === "start_task").length,
    0,
  );
});

test("pending task project browsing disables Start and ignores selection after scope changes", async (t) => {
  let finish!: (result: { repository: string }) => void;

  const { controller, transport, user } = await setup(t, (transport) => {
    configureProjectRegistration(transport);
    const original = transport.tool.bind(transport);

    transport.tool = async <T>(
      name: string,
      args: Record<string, unknown> = {},
    ): Promise<T> => {
      if (name === "app_browse_project") {
        transport.calls.push({ name, args });

        return new Promise<{ repository: string }>((resolve) => {
          finish = resolve;
        }) as Promise<T>;
      }

      return original<T>(name, args);
    };
  });

  await openAdvancedTask(user);
  const dialog = await screen.findByRole("dialog");
  await enterTask(user, "A pending folder selection");

  const start = within(dialog).getByRole<HTMLButtonElement>("button", {
    name: "Start task",
  });

  await user.click(within(dialog).getByRole("button", { name: "Browse…" }));
  assert.equal(start.disabled, true);

  await act(async () =>
    controller.applyScope({ panel_scope: { conversation_id: "new-chat" } }),
  );

  await act(async () => {
    finish({ repository: "/repo/stale-selection" });
  });

  assert.equal(
    transport.calls.filter((call) => call.name === "app_register_project")
      .length,
    0,
  );

  assert.equal(
    transport.calls.filter((call) => call.name === "start_task").length,
    0,
  );
});
