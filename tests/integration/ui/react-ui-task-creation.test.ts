// @vitest-environment jsdom
import { expect } from "vitest";

import {
  act,
  assert,
  assertAbsent,
  enterTask,
  executionPresentation,
  screen,
  selectOption,
  setup,
  task,
  test,
  waitFor,
} from "./react-ui-test-support";

test("delegation submits the full request without a title and search matches description", async (t) => {
  const { controller, transport, user } = await setup(t, (transport) => {
    transport.tasks[0].description = "Inspect the unique zebra boundary.";

    transport.tasks.push({
      ...task("two"),
      title: "Other task",
      description: "Unrelated instructions",
    });
  });

  await user.type(
    screen.getByRole("searchbox", { name: "Search tasks" }),
    "ZEBRA",
  );

  assert.equal(
    document.querySelector(".row-title")?.textContent,
    "Review authentication",
  );

  assertAbsent(screen.queryByRole("button", { name: /^Other task/ }));
  await act(() => controller.setSearch(""));
  await user.click(screen.getByRole("button", { name: "New Task" }));
  assertAbsent(screen.queryByLabelText("Task title"));

  const request =
    "Review authentication.\nInclude all edge cases and report the evidence.";

  await enterTask(user, request);
  await user.click(screen.getByRole("button", { name: "Start task" }));

  await waitFor(() =>
    assert.equal(
      transport.calls.filter((call) => call.name === "start_agent_task").length,
      1,
    ),
  );

  const submitted = transport.calls.find(
    (call) => call.name === "start_agent_task",
  )!.args;

  assert.ok(!("title" in submitted));
  assert.equal(submitted.description, request);
  assert.ok(!("task" in submitted));
});

test("dialog focuses task, preserves the draft and field node during refresh, and restores trigger focus", async (t) => {
  const { controller, transport, user } = await setup(t);
  const trigger = screen.getByRole("button", { name: "New Task" });
  await user.click(trigger);
  const field = await screen.findByLabelText("Description");

  await waitFor(() =>
    expect(
      document.activeElement,
      "Task field should receive dialog focus",
    ).toBe(field),
  );

  await user.type(field, "Keep this draft");

  transport.projects = [
    ...transport.projects,
    { repository: "/repo/b", kind: "repository" },
  ];

  await act(() => controller.refresh());

  expect(
    screen.getByLabelText("Description"),
    "Polling should retain the task field",
  ).toBe(field);

  assert.equal((field as HTMLTextAreaElement).value, "Keep this draft");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

  await waitFor(() =>
    expect(document.activeElement, "Dialog should restore trigger focus").toBe(
      trigger,
    ),
  );
});

test("task form keeps fractional runtime defaults and rejects cost budgets for unsupported workers", async (t) => {
  const { transport, user } = await setup(t);
  await user.click(screen.getByRole("button", { name: "New Task" }));
  await screen.findByRole("dialog");

  assert.equal(
    screen.getByRole("combobox", { name: "Project" }).textContent,
    "/repo/a",
  );

  assert.equal(
    (screen.getByLabelText("Runtime limit · minutes") as HTMLInputElement)
      .value,
    "0.5",
  );

  await enterTask(user, "Investigate failing tests");
  await selectOption(user, "Worker", "fixture · reviewer");
  await user.type(screen.getByLabelText("Model"), "selected-model");
  await selectOption(user, "Reasoning effort", "high");
  await selectOption(user, "Cost limit", "Apply cost budget");
  await user.click(screen.getByRole("button", { name: "Start task" }));

  await screen.findByText(
    "This worker cannot enforce a cost budget. Choose No cost limit.",
  );

  assert.equal(
    transport.calls.filter((call) => call.name === "start_agent_task").length,
    0,
  );

  await selectOption(user, "Cost limit", "No cost limit");
  await user.click(screen.getByRole("button", { name: "Start task" }));

  await waitFor(() =>
    assert.equal(
      transport.calls.filter((call) => call.name === "start_agent_task").length,
      1,
    ),
  );

  const call = transport.calls.find(
    (call) => call.name === "start_agent_task",
  )!;

  assert.deepEqual(call.args.budget, {
    max_runtime_minutes: 0.5,
    max_cost_usd: null,
  });

  assert.equal(call.args.conversation_id, null);
  assert.equal(call.args.provider, "fixture");
  assert.equal(call.args.model, "selected-model");
  assert.equal(call.args.reasoning_effort, "high");
});

test("changing projects clears revision and dependencies while retaining the task draft", async (t) => {
  const { user } = await setup(t, (transport) => {
    transport.projects.push({ repository: "/repo/b", kind: "repository" });
    transport.tasks.push(task("two", "/repo/b"));
  });

  await user.click(screen.getByRole("button", { name: "New Task" }));
  await screen.findByRole("dialog");
  await selectOption(user, "Project", "/repo/a");
  await enterTask(user, "Persistent task");
  await selectOption(user, "Workspace", "Isolated worktree");
  await user.clear(screen.getByLabelText("Revision"));
  await user.type(screen.getByLabelText("Revision"), "edited-branch");

  await selectOption(
    user,
    "Wait for tasks (optional)",
    "Review authentication",
    true,
  );

  await selectOption(user, "Project", "/repo/b");

  assert.equal(
    (screen.getByLabelText("Revision") as HTMLInputElement).value,
    "HEAD",
  );

  assert.equal(
    (screen.getByLabelText("Description") as HTMLTextAreaElement).value,
    "Persistent task",
  );

  assert.match(
    screen.getByRole("combobox", { name: "Wait for tasks (optional)" })
      .textContent ?? "",
    /No dependencies/,
  );

  await selectOption(user, "Project", "/repo/a");

  assert.match(
    screen.getByRole("combobox", { name: "Wait for tasks (optional)" })
      .textContent ?? "",
    /No dependencies/,
  );
});

test("delegation selects support keyboard choice and Escape preserves the draft dialog", async (t) => {
  const { user, transport } = await setup(t);
  await user.click(screen.getByRole("button", { name: "New Task" }));
  const dialog = await screen.findByRole("dialog");
  await enterTask(user, "Keyboard worker selection");
  const worker = screen.getByRole("combobox", { name: "Worker" });
  await user.click(worker);

  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("option", { name: "claude · reviewer" }),
    ),
  );

  await user.keyboard("{End}");

  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("option", { name: "fixture · reviewer" }),
    ),
  );

  await user.keyboard("{Enter}");

  await waitFor(() =>
    assert.equal(worker.getAttribute("aria-expanded"), "false"),
  );

  assert.match(worker.textContent ?? "", /fixture · reviewer/);
  await user.click(worker);

  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("option", { name: "fixture · reviewer" }),
    ),
  );

  await user.keyboard("{Escape}");

  await waitFor(() =>
    assert.equal(worker.getAttribute("aria-expanded"), "false"),
  );

  expect(screen.getByRole("dialog")).toBe(dialog);

  assert.equal(
    (screen.getByLabelText("Description") as HTMLTextAreaElement).value,
    "Keyboard worker selection",
  );

  await user.click(screen.getByRole("button", { name: "Start task" }));

  await waitFor(() =>
    assert.equal(
      transport.calls.find((call) => call.name === "start_agent_task")?.args
        .provider,
      "fixture",
    ),
  );
});

test("dependency multiselect retains multiple choices until explicit submission", async (t) => {
  const { user, transport } = await setup(t, (transport) => {
    const second = task("two");
    second.title = "Review database";
    transport.tasks.push(second);
  });

  await user.click(screen.getByRole("button", { name: "New Task" }));
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
      transport.calls.find((call) => call.name === "start_agent_task")?.args
        .depends_on,
      ["one", "two"],
    ),
  );
});

test("approved parent project suggestions allow an unlisted nested repository path", async (t) => {
  const { transport, user } = await setup(t, (transport) => {
    transport.projects.push({ repository: "/approved", kind: "parent" });
  });

  await user.click(screen.getByRole("button", { name: "New Task" }));
  await screen.findByRole("dialog");

  const project = screen.getByRole("combobox", {
    name: "Project",
  });

  await user.clear(project);
  await user.type(project, "/approved/new/nested-repo");
  await user.keyboard("{Escape}");
  assert.ok(screen.getByRole("dialog"));
  await enterTask(user, "Review nested repository");
  await user.click(screen.getByRole("button", { name: "Start task" }));

  await waitFor(() =>
    assert.equal(
      transport.calls.find((call) => call.name === "start_agent_task")?.args
        .repository,
      "/approved/new/nested-repo",
    ),
  );
});

test("zero runtime and cost budgets cannot launch a task", async (t) => {
  const { transport, user } = await setup(t);
  await user.click(screen.getByRole("button", { name: "New Task" }));
  await screen.findByRole("dialog");
  await enterTask(user, "Budget validation");
  const runtime = screen.getByLabelText("Runtime limit · minutes");
  await user.clear(runtime);
  await user.type(runtime, "0");
  await user.click(screen.getByRole("button", { name: "Start task" }));

  await screen.findByText(
    "Runtime limit must be greater than zero and at most 120 minutes.",
  );

  assert.equal(
    transport.calls.filter((call) => call.name === "start_agent_task").length,
    0,
  );

  await user.clear(runtime);
  await user.type(runtime, "1");
  await selectOption(user, "Cost limit", "Apply cost budget");
  const cost = screen.getByLabelText("Cost budget · USD");
  await user.clear(cost);
  await user.type(cost, "0");
  await user.click(screen.getByRole("button", { name: "Start task" }));

  assert.equal(
    transport.calls.filter((call) => call.name === "start_agent_task").length,
    0,
  );

  await user.clear(cost);
  await user.type(cost, "0.01");
  await user.click(screen.getByRole("button", { name: "Start task" }));

  await waitFor(() =>
    assert.deepEqual(
      transport.calls.find((call) => call.name === "start_agent_task")?.args
        .budget,
      { max_runtime_minutes: 1, max_cost_usd: 0.01 },
    ),
  );
});

test("permission buttons allow explicit inline approval without a dropdown", async (t) => {
  const { user, transport } = await setup(t, (transport) => {
    transport.tasks[0].pending_input = {
      id: "permission",
      tool: "Execution",
      kind: "permission",
      presentation: executionPresentation,
      input: { description: "Execute shell commands" },
    };
  });

  expect(screen.queryByRole("dialog")).toBeNull();

  await user.click(
    screen.getByRole("button", { name: "Approve this execution turn" }),
  );

  await waitFor(() =>
    assert.equal(
      transport.calls.find((call) => call.name === "submit_agent_input")?.args
        .approved,
      true,
    ),
  );
});

test("current repository selection locks revision to HEAD and submits the checkout strategy", async (t) => {
  const { transport, user } = await setup(t);
  await user.click(screen.getByRole("button", { name: "New Task" }));
  await screen.findByRole("dialog");
  const revision = screen.getByLabelText("Revision") as HTMLInputElement;
  assert.equal(revision.value, "HEAD");
  assert.equal(revision.readOnly, true);

  assert.match(
    screen.getByRole("combobox", { name: "Workspace" }).textContent ?? "",
    /Current repository/,
  );

  await selectOption(user, "Workspace", "Isolated worktree");
  assert.equal(revision.readOnly, false);
  await user.clear(revision);
  await user.type(revision, "feature-branch");
  await enterTask(user, "Review my uncommitted edits");

  await selectOption(
    user,
    "Workspace",
    "Current repository (uncommitted changes)",
  );

  await waitFor(() => assert.equal(revision.value, "HEAD"));
  assert.equal(revision.readOnly, true);
  await user.click(screen.getByRole("button", { name: "Start task" }));

  await waitFor(() =>
    assert.equal(
      transport.calls.filter((call) => call.name === "start_agent_task").length,
      1,
    ),
  );

  const call = transport.calls.find(
    (call) => call.name === "start_agent_task",
  )!;

  assert.equal(call.args.workspace_strategy, "current_repo");
  assert.equal(call.args.revision, "HEAD");
  assert.equal(call.args.repository, "/repo/a");
});

test("delegation uses the extension permission setting by default and separately selects the approval decision maker", async (t) => {
  const { user, transport } = await setup(t);
  await user.click(screen.getByRole("button", { name: "New Task" }));
  await screen.findByRole("dialog");

  assert.equal(
    screen.getByRole("combobox", { name: "Permission mode" }).textContent,
    "Use extension setting",
  );

  await selectOption(user, "Permission mode", "Accept edits");
  await selectOption(user, "Approval decision maker", "Parent agent");
  await enterTask(user, "Review authentication with parent approvals");
  await user.click(screen.getByRole("button", { name: "Start task" }));

  await waitFor(() =>
    assert.equal(
      (
        transport.calls.find((call) => call.name === "start_agent_task")
          ?.args as any
      ).provider_options.claude.approval_decider,
      "parent_agent",
    ),
  );

  assert.equal(
    (
      transport.calls.find((call) => call.name === "start_agent_task")
        ?.args as any
    ).provider_options.claude.permission_mode,
    "acceptEdits",
  );
});
