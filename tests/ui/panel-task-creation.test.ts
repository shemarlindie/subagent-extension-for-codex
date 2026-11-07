// @vitest-environment jsdom
import {
  act,
  assert,
  assertAbsent,
  configureModelDefaults,
  enterTask,
  openAdvancedTask,
  pasteText,
  screen,
  selectedProjectPath,
  selectOption,
  setup,
  setupDelegate,
  startedTask,
  task,
  test,
  waitFor,
} from "./panel-test-support";

test("delegation submits the full request without a title and search matches description", async (t) => {
  const { controller, transport, user } = await setup(t, (transport) => {
    const [current] = transport.tasks;

    assert.ok(current);
    current.description = "Inspect the unique zebra boundary.";

    transport.tasks.push({
      ...task("two"),
      title: "Other task",
      description: "Unrelated instructions",
    });
  });

  await pasteText(
    user,
    screen.getByRole("searchbox", { name: "Search tasks" }),
    "ZEBRA",
  );

  assert.equal(
    document.querySelector(".row-title")?.textContent,
    "Review authentication",
  );

  assertAbsent(screen.queryByRole("button", { name: /^Other task/ }));
  await act(async () => controller.setSearch(""));
  await openAdvancedTask(user);
  assertAbsent(screen.queryByLabelText("Task title"));

  const request =
    "Review authentication.\nInclude all edge cases and report the evidence.";

  await enterTask(user, request);
  await user.click(screen.getByRole("button", { name: "Start task" }));

  const submitted = (await startedTask(transport)).args;

  assert.ok(!("title" in submitted));
  assert.equal(submitted.description, request);
  assert.ok(!("task" in submitted));
});

test("task form keeps fractional runtime defaults and rejects cost budgets for unsupported workers", async (t) => {
  const { transport, user } = await setupDelegate(t);
  await screen.findByRole("dialog");

  await waitFor(() =>
    assert.equal(
      screen.getByLabelText<HTMLInputElement>("Runtime limit (mins)").value,
      "0.5",
    ),
  );

  assert.equal(selectedProjectPath(), "/repo/a");

  await enterTask(user, "Investigate failing tests");
  await selectOption(user, "Worker", "fixture · reviewer");
  await pasteText(user, screen.getByLabelText("Model"), "selected-model");
  await selectOption(user, "Reasoning", "high");
  await user.click(screen.getByRole("switch", { name: "Cost limit" }));
  await user.click(screen.getByRole("button", { name: "Start task" }));

  await screen.findByText(
    "This worker cannot enforce a cost budget. Choose No cost limit.",
  );

  assert.equal(
    transport.calls.filter((call) => call.name === "start_task").length,
    0,
  );

  await user.click(screen.getByRole("switch", { name: "Cost limit" }));
  await user.click(screen.getByRole("button", { name: "Start task" }));

  const call = await startedTask(transport);

  assert.deepEqual(call.args.budget, {
    max_runtime_minutes: 0.5,
    max_cost_usd: null,
  });

  assert.equal(call.args.conversation_id, null);
  assert.equal(call.args.provider, "fixture");
  assert.equal(call.args.model, "selected-model");
  assert.equal(call.args.reasoning_effort, "high");
});

test("dependency multiselect retains multiple choices until explicit submission", async (t) => {
  const { user, transport } = await setupDelegate(t, (transport) => {
    const second = task("two");
    second.title = "Review database";
    transport.tasks.push(second);
  });

  await screen.findByRole("dialog");
  await enterTask(user, "Wait for both reviews");

  const dependencies = screen.getByRole("combobox", {
    name: "Wait for tasks (optional)",
  });

  await user.click(dependencies);

  await user.click(
    await screen.findByRole("option", { name: "Review authentication" }),
  );

  assert.equal(dependencies.getAttribute("aria-expanded"), "true");
  await user.click(screen.getByRole("option", { name: "Review database" }));
  await user.keyboard("{Escape}");

  await waitFor(() =>
    assert.equal(dependencies.getAttribute("aria-expanded"), "false"),
  );

  assert.ok(screen.getByRole("dialog"));
  await user.click(screen.getByRole("button", { name: "Start task" }));

  await waitFor(() =>
    assert.deepEqual(
      transport.calls.find((call) => call.name === "start_task")?.args
        .depends_on,
      ["one", "two"],
    ),
  );
});

test("zero runtime and cost budgets cannot launch a task", async (t) => {
  const { transport, user } = await setupDelegate(t);
  await screen.findByRole("dialog");
  await enterTask(user, "Budget validation");
  const runtime = screen.getByLabelText("Runtime limit (mins)");

  await waitFor(() =>
    assert.equal((runtime as HTMLInputElement).disabled, false),
  );

  await waitFor(() =>
    assert.equal(
      screen.getByRole<HTMLButtonElement>("button", { name: "Start task" })
        .disabled,
      false,
    ),
  );

  await user.clear(runtime);
  await pasteText(user, runtime, "0");
  await user.click(screen.getByRole("button", { name: "Start task" }));

  await screen.findByText("Runtime limit must be greater than zero.");

  assert.equal(
    transport.calls.filter((call) => call.name === "start_task").length,
    0,
  );

  await user.clear(runtime);
  await pasteText(user, runtime, "1");
  await user.click(screen.getByRole("switch", { name: "Cost limit" }));
  const cost = screen.getByLabelText("Cost limit (USD)");
  await user.clear(cost);
  await pasteText(user, cost, "0");
  await user.click(screen.getByRole("button", { name: "Start task" }));

  assert.equal(
    transport.calls.filter((call) => call.name === "start_task").length,
    0,
  );

  await user.clear(cost);
  await pasteText(user, cost, "0.01");
  await user.click(screen.getByRole("button", { name: "Start task" }));

  await waitFor(() =>
    assert.deepEqual(
      transport.calls.find((call) => call.name === "start_task")?.args.budget,
      { max_runtime_minutes: 1, max_cost_usd: 0.01 },
    ),
  );
});

test("project folder selection locks revision to HEAD and submits the checkout strategy", async (t) => {
  const { transport, user } = await setupDelegate(t);
  await screen.findByRole("dialog");
  const revision = screen.getByLabelText<HTMLInputElement>("Revision");
  assert.equal(revision.value, "HEAD");
  assert.equal(revision.readOnly, true);

  assert.match(
    screen.getByRole("combobox", { name: "Workspace" }).textContent ?? "",
    /Project folder/,
  );

  await selectOption(user, "Workspace", "Isolated worktree");
  assert.equal(revision.readOnly, false);
  await user.clear(revision);
  await pasteText(user, revision, "feature-branch");
  await enterTask(user, "Review my uncommitted edits");

  await selectOption(user, "Workspace", "Project folder (uncommitted changes)");

  await waitFor(() => assert.equal(revision.value, "HEAD"));
  assert.equal(revision.readOnly, true);
  await user.click(screen.getByRole("button", { name: "Start task" }));

  const call = await startedTask(transport);

  assert.equal(call.args.workspace_strategy, "current_repo");
  assert.equal(call.args.revision, "HEAD");
  assert.equal(call.args.repository, "/repo/a");
});

test("delegation starts a read-only profile in plan mode, keeps a chosen mode and separately selects the approval decision maker and sandbox", async (t) => {
  const { user, transport } = await setupDelegate(t, (transport) =>
    writingWorker(transport, ["reviewer", "general"]),
  );

  await screen.findByRole("dialog");

  // The fake service's default profile, reviewer, is read-only.
  assert.equal(
    screen.getByRole("combobox", { name: "Permission mode" }).textContent,
    "Plan — read only",
  );

  // An untouched mode follows the profile: a write profile takes the saved one.
  await selectOption(user, "Worker", "claude · general");

  assert.equal(
    screen.getByRole("combobox", { name: "Permission mode" }).textContent,
    "Default — ask for approval",
  );

  await selectOption(user, "Worker", "claude · reviewer");
  await selectOption(user, "Permission mode", "Accept edits");
  await selectOption(user, "Approval decision maker", "Parent agent");
  await user.click(screen.getByRole("switch", { name: "Bash sandbox" }));
  await enterTask(user, "Review authentication with parent approvals");
  await user.click(screen.getByRole("button", { name: "Start task" }));

  await waitFor(() =>
    assert.equal(
      (transport.calls.find((call) => call.name === "start_task")?.args as any)
        .provider_options.claude.approval_decider,
      "parent_agent",
    ),
  );

  assert.equal(
    (transport.calls.find((call) => call.name === "start_task")?.args as any)
      .provider_options.claude.permission_mode,
    "acceptEdits",
  );

  assert.equal(
    (transport.calls.find((call) => call.name === "start_task")?.args as any)
      .provider_options.claude.sandbox,
    true,
  );
});

/** Serves a profile that can write, since read-only tasks lose no isolation. */
function writingWorker(
  transport: Parameters<typeof configureModelDefaults>[0],
  profiles = ["general"],
) {
  const { tool } = transport;

  transport.tool = async <T>(name: string, args = {}) => {
    const result = await tool.call(transport, name, args);

    return (
      name === "list_workers"
        ? (result as { profiles: string[] }[]).map((worker) => ({
            ...worker,
            profiles,
          }))
        : result
    ) as T;
  };
}

test("the composer warns about a lost worktree default and starts in place", async (t) => {
  const { transport, user } = await setup(t, (transport) => {
    transport.projects = [
      { repository: "/repo/a", name: "plain", kind: "repository", git: "none" },
    ];

    configureModelDefaults(transport, {
      "task.workspace_strategy": "worktree",
    });

    writingWorker(transport);
  });

  await user.click(screen.getByRole("button", { name: "New task" }));

  const note = await screen.findByText(
    /Your default is a worktree, but this folder has no Git/,
  );

  assert.equal(note.closest(".notice")?.getAttribute("data-tone"), "warning");

  await pasteText(
    user,
    await screen.findByRole("textbox", { name: "Task message" }),
    "Tidy this folder",
  );

  await user.keyboard("{Enter}");

  await waitFor(() => {
    const args = transport.calls.find((call) => call.name === "start_task")
      ?.args as { workspace_strategy: string; revision: string } | undefined;

    assert.equal(args?.workspace_strategy, "current_repo");
    assert.equal(args?.revision, "HEAD");
  });
});

test("a project with no commit has one workspace, and a ready project restores the default", async (t) => {
  const { transport, user } = await setupDelegate(t, (transport) => {
    transport.projects = [
      { repository: "/repo/a", name: "plain", kind: "repository", git: "none" },
      {
        repository: "/repo/b",
        name: "ready",
        kind: "repository",
        git: "ready",
      },
    ];

    configureModelDefaults(transport, {
      "task.workspace_strategy": "worktree",
    });

    writingWorker(transport);
  });

  await screen.findByRole("dialog");

  const workspace = () =>
    screen.getByRole("combobox", { name: "Workspace" }).textContent;

  await selectOption(user, "Project", /plain/);

  await waitFor(() =>
    assert.equal(workspace(), "Project folder (edits apply directly)"),
  );

  assertAbsent(screen.queryByLabelText("Revision"));
  screen.getByText(/Your default is a worktree, but this folder has no Git/);

  await selectOption(user, "Project", /ready/);
  await waitFor(() => assert.equal(workspace(), "Isolated worktree"));
  screen.getByLabelText("Revision");
  assertAbsent(screen.queryByText(/Your default is a worktree/));

  await selectOption(user, "Project", /plain/);

  await waitFor(() =>
    assert.equal(workspace(), "Project folder (edits apply directly)"),
  );

  await enterTask(user, "Tidy this folder");
  await user.click(screen.getByRole("button", { name: "Start task" }));

  // The saved worktree default must not reach the service's explicit error.
  await waitFor(() => {
    const args = transport.calls.find((call) => call.name === "start_task")
      ?.args as { workspace_strategy: string; revision: string } | undefined;

    assert.equal(args?.workspace_strategy, "current_repo");
    assert.equal(args?.revision, "HEAD");
  });
});
