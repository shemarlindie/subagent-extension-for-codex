// @vitest-environment jsdom
import { expect } from "vitest";

import {
  defaults,
  deferred,
} from "../../../src/panel/app/state/controller-test-harness";
import type { Defaults } from "../../../src/panel/app/state/types";
import {
  act,
  assert,
  assertAbsent,
  enterTask,
  executionPresentation,
  openAdvancedTask,
  screen,
  selectedProjectPath,
  selectOption,
  setup,
  task,
  test,
  waitFor,
  within,
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

  await user.type(
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

  const trigger = screen.getByRole("button", {
    name: "More ways to start a task",
  });

  await openAdvancedTask(user);
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
  await openAdvancedTask(user);
  await screen.findByRole("dialog");

  await waitFor(() =>
    assert.equal(
      screen.getByLabelText<HTMLInputElement>("Runtime limit (mins)").value,
      "0.5",
    ),
  );

  assert.equal(selectedProjectPath(), "/repo/a");

  assert.equal(
    screen.getByLabelText<HTMLInputElement>("Runtime limit (mins)").value,
    "0.5",
  );

  await enterTask(user, "Investigate failing tests");
  await selectOption(user, "Worker", "fixture · reviewer");
  await user.type(screen.getByLabelText("Model"), "selected-model");
  await selectOption(user, "Reasoning effort", "high");
  await user.click(screen.getByRole("switch", { name: "Cost limit" }));
  await user.click(screen.getByRole("button", { name: "Start task" }));

  await screen.findByText(
    "This worker cannot enforce a cost budget. Choose No cost limit.",
  );

  assert.equal(
    transport.calls.filter((call) => call.name === "start_agent_task").length,
    0,
  );

  await user.click(screen.getByRole("switch", { name: "Cost limit" }));
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

  await openAdvancedTask(user);
  await screen.findByRole("dialog");
  await selectOption(user, "Project", /repo\/a$/);
  await enterTask(user, "Persistent task");
  await selectOption(user, "Workspace", "Isolated worktree");
  await user.clear(screen.getByLabelText("Revision"));
  await user.type(screen.getByLabelText("Revision"), "edited-branch");

  await user.click(
    screen.getByRole("combobox", { name: "Wait for tasks (optional)" }),
  );

  const dependencySearch = await screen.findByRole("combobox", {
    name: "Search wait for tasks (optional)",
  });

  await user.type(dependencySearch, "AUTHENTICATION");
  expect(screen.getAllByRole("option")).toHaveLength(1);

  await user.click(
    screen.getByRole("option", { name: "Review authentication" }),
  );

  await user.keyboard("{Escape}");

  await selectOption(user, "Project", /repo\/b$/);

  assert.equal(
    screen.getByLabelText<HTMLInputElement>("Revision").value,
    "HEAD",
  );

  assert.equal(
    screen.getByLabelText<HTMLTextAreaElement>("Description").value,
    "Persistent task",
  );

  assert.match(
    screen.getByRole("combobox", { name: "Wait for tasks (optional)" })
      .textContent ?? "",
    /No dependencies/,
  );

  await selectOption(user, "Project", /repo\/a$/);

  assert.match(
    screen.getByRole("combobox", { name: "Wait for tasks (optional)" })
      .textContent ?? "",
    /No dependencies/,
  );
});

test("delegation selects support keyboard choice and Escape preserves the draft dialog", async (t) => {
  const { user, transport } = await setup(t);
  await openAdvancedTask(user);
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
    screen.getByLabelText<HTMLTextAreaElement>("Description").value,
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

  await openAdvancedTask(user);
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

  await openAdvancedTask(user);
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

test("approved parent project suggestions find saved names and submit the selected repository path", async (t) => {
  const { transport, user } = await setup(t, (transport) => {
    transport.projects.push(
      { repository: "/approved", kind: "parent" },
      {
        repository: "/approved/client",
        kind: "repository",
        name: "Client Portal",
      },
    );
  });

  await openAdvancedTask(user);
  await screen.findByRole("dialog");

  const project = screen.getByRole("combobox", { name: "Project" });

  await user.clear(project);
  await user.type(project, "CLIENT PORTAL");

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
      transport.calls.find((call) => call.name === "start_agent_task")?.args
        .repository,
    ).toBe("/approved/client"),
  );
});

test("zero runtime and cost budgets cannot launch a task", async (t) => {
  const { transport, user } = await setup(t);
  await openAdvancedTask(user);
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
  await user.type(runtime, "0");
  await user.click(screen.getByRole("button", { name: "Start task" }));

  await screen.findByText("Runtime limit must be greater than zero.");

  assert.equal(
    transport.calls.filter((call) => call.name === "start_agent_task").length,
    0,
  );

  await user.clear(runtime);
  await user.type(runtime, "1");
  await user.click(screen.getByRole("switch", { name: "Cost limit" }));
  const cost = screen.getByLabelText("Cost limit (USD)");
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
    const [current] = transport.tasks;

    assert.ok(current);

    current.pending_input = {
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
  await openAdvancedTask(user);
  await screen.findByRole("dialog");
  const revision = screen.getByLabelText<HTMLInputElement>("Revision");
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
  await openAdvancedTask(user);
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

test("the new-task composer starts the task and keeps typing focus in Chat", async (t) => {
  const { controller, transport, user } = await setup(t);

  await user.click(screen.getByRole("button", { name: "New task" }));

  const message = await screen.findByRole("textbox", { name: "Task message" });

  // The test workers offer only Reviewer, which the composer falls back to.
  await screen.findByRole("combobox", { name: "Profile: Reviewer" });
  await user.type(message, "Trace the flaky login test{Enter}");

  await waitFor(() =>
    assert.equal(
      transport.calls.filter((call) => call.name === "start_agent_task").length,
      1,
    ),
  );

  await waitFor(() =>
    assert.equal(controller.getSnapshot().newTask, undefined),
  );

  const chat = await screen.findByRole("textbox", { name: "Message" });

  await waitFor(() =>
    expect(document.activeElement, "Chat's composer should keep focus").toBe(
      chat,
    ),
  );
});

for (const input of ["mouse", "keyboard"] as const) {
  test(`the Panel actions New task item leaves typing focus in the composer when opened with ${input}`, async (t) => {
    const { user } = await setup(t, undefined, { wide: false });
    const trigger = screen.getByRole("button", { name: "Panel actions" });

    if (input === "mouse") {
      await user.click(trigger);

      await user.click(
        await screen.findByRole("menuitem", { name: "New task" }),
      );
    } else {
      await act(async () => trigger.focus());
      await user.keyboard("{Enter}");
      await screen.findByRole("menu");
      await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");

      expect(document.activeElement).toBe(
        screen.getByRole("menuitem", { name: "New task" }),
      );

      await user.keyboard("{Enter}");
    }

    const message = await screen.findByRole<HTMLTextAreaElement>("textbox", {
      name: "Task message",
    });

    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(message));
    await user.keyboard("Continue typing in the new task");
    expect(message.value).toBe("Continue typing in the new task");
  });
}

test("More options preserves a pending composer draft and fills Advanced task defaults before submission", async (t) => {
  const settings = deferred<{ values: Defaults }>();

  const { controller, transport, user } = await setup(t, (transport) => {
    const original = transport.tool.bind(transport);

    transport.tool = async <T>(name: string, args = {}): Promise<T> => {
      if (name === "get_agent_settings") {
        transport.calls.push({ name, args });

        return (await settings.promise) as T;
      }

      return original<T>(name, args);
    };
  });

  await user.click(screen.getByRole("button", { name: "New task" }));
  const message = await screen.findByRole("textbox", { name: "Task message" });
  await user.type(message, "Preserve the pending request");
  expect(controller.getSnapshot().newTask?.statuses.settings).toBe("loading");
  await user.click(screen.getByRole("button", { name: "More options…" }));

  const dialog = within(await screen.findByRole("dialog"));

  const description = dialog.getByRole<HTMLTextAreaElement>("textbox", {
    name: "Description",
  });

  expect(description.value).toBe("Preserve the pending request");
  await user.type(description, " and the Advanced edit");

  expect(
    dialog.getByRole<HTMLButtonElement>("button", { name: "Start task" })
      .disabled,
  ).toBe(true);

  await act(async () => {
    settings.resolve({
      values: {
        ...defaults,
        claude_permission_mode: "acceptEdits",
        default_reasoning_effort: "high",
      },
    });
  });

  await waitFor(() => {
    expect(dialog.getByRole("combobox", { name: "Worker" }).textContent).toBe(
      "claude · reviewer",
    );

    expect(
      dialog.getByRole("combobox", { name: "Reasoning effort" }).textContent,
    ).toBe("Use default (high)");

    expect(
      dialog.getByRole("combobox", { name: "Permission mode" }).textContent,
    ).toBe("Accept edits");
  });

  expect(description.value).toBe(
    "Preserve the pending request and the Advanced edit",
  );

  await user.click(dialog.getByRole("button", { name: "Start task" }));

  await waitFor(() => {
    const submissions = transport.calls.filter(
      (call) => call.name === "start_agent_task",
    );

    expect(submissions).toHaveLength(1);

    expect(submissions[0]?.args).toMatchObject({
      description: "Preserve the pending request and the Advanced edit",
      repository: "/repo/a",
      provider: "claude",
      worker_profile: "reviewer",
      reasoning_effort: "default",
      provider_options: {
        claude: { permission_mode: "acceptEdits", approval_decider: "user" },
      },
    });
  });
});
