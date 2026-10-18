// @vitest-environment jsdom
import { expect } from "vitest";

import {
  act,
  assert,
  assertAbsent,
  configureProjectRegistration,
  enterTask,
  openAdvancedTask,
  screen,
  selectedProjectPath,
  selectOption,
  setup,
  startedTask,
  test,
  waitFor,
  within,
} from "./panel-test-support";

test("project picker uses accessible options, changes scope by keyboard, and preserves its trigger during refresh", async (t) => {
  const { controller, user } = await setup(t);
  const picker = screen.getByRole("combobox", { name: "Project scope" });
  await user.click(picker);

  const search = await screen.findByRole("combobox", {
    name: "Search project scope",
  });

  await waitFor(() => expect(document.activeElement).toBe(search));
  await user.type(search, "/REPO/A");
  expect(screen.getAllByRole("option")).toHaveLength(1);
  expect(screen.getByRole("option", { name: /^a/ })).toBeTruthy();
  await user.keyboard("{ArrowDown}");

  await user.keyboard("{Enter}");

  await waitFor(() =>
    assert.equal(controller.getSnapshot().repository, "/repo/a"),
  );

  await waitFor(() =>
    assert.equal(picker.getAttribute("aria-expanded"), "false"),
  );

  assert.match(picker.textContent ?? "", /a/);
  await act(() => controller.refresh());

  expect(
    screen.getByRole("combobox", { name: "Project scope" }),
    "Polling should retain the picker trigger",
  ).toBe(picker);

  await user.click(picker);

  const reopenedSearch = await screen.findByRole("combobox", {
    name: "Search project scope",
  });

  await waitFor(() => expect(document.activeElement).toBe(reopenedSearch));
  expect((reopenedSearch as HTMLInputElement).value).toBe("");
  await user.type(reopenedSearch, "All projects");
  expect(screen.getAllByRole("option")).toHaveLength(1);
  await user.keyboard("{ArrowDown}");

  await user.keyboard("{Enter}");

  await waitFor(() =>
    assert.equal(controller.getSnapshot().repository, undefined),
  );
});

test("global UI adds a manually entered project only after explicit submission and selects it", async (t) => {
  const { controller, transport, user } = await setup(
    t,
    (transport) => configureProjectRegistration(transport),
    {},
  );

  act(() => {
    void controller.addProject();
  });

  const dialog = await screen.findByRole("dialog");

  await user.type(
    within(dialog).getByLabelText("Repository path"),
    "/repo/new-project",
  );

  assert.equal(
    transport.calls.filter(
      (call) => call.name === "register_user_agent_project",
    ).length,
    0,
  );

  await user.click(within(dialog).getByRole("button", { name: "Add project" }));

  await waitFor(() =>
    assert.equal(controller.getSnapshot().repository, "/repo/new-project"),
  );

  assert.deepEqual(
    transport.calls.find((call) => call.name === "register_user_agent_project")
      ?.args,
    { repository: "/repo/new-project" },
  );

  assert.ok(
    controller
      .getSnapshot()
      .projects.some((project) => project.repository === "/repo/new-project"),
  );

  await waitFor(() => assertAbsent(screen.queryByRole("dialog")));
});

test("browsing a folder fills the project draft without granting access", async (t) => {
  const { controller, transport, user } = await setup(
    t,
    (transport) =>
      configureProjectRegistration(transport, { picked: "/repo/picked" }),
    {},
  );

  act(() => {
    void controller.addProject();
  });

  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "Browse…" }));

  await waitFor(() =>
    assert.equal(
      within(dialog).getByLabelText<HTMLInputElement>("Repository path").value,
      "/repo/picked",
    ),
  );

  assert.equal(
    transport.calls.filter(
      (call) => call.name === "register_user_agent_project",
    ).length,
    0,
  );

  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => assertAbsent(screen.queryByRole("dialog")));

  assert.equal(
    transport.calls.filter(
      (call) => call.name === "register_user_agent_project",
    ).length,
    0,
  );
});

test("Manage adds a project through the folder picker", async (t) => {
  const { transport, user } = await setup(t, (transport) =>
    configureProjectRegistration(transport, { picked: "/repo/picked" }),
  );

  await user.click(screen.getByRole("button", { name: "Manage" }));
  await user.click(screen.getByRole("button", { name: "Add project" }));
  await user.click(screen.getByRole("button", { name: "Browse…" }));

  await user.click(screen.getByRole("button", { name: "Add project" }));

  await waitFor(() =>
    assert.deepEqual(
      transport.calls
        .filter((call) => call.name === "register_user_agent_project")
        .map((call) => call.args),
      [{ repository: "/repo/picked" }],
    ),
  );

  assertAbsent(screen.queryByRole("dialog"));
  expect(screen.getByRole("heading", { name: "Projects" })).toBeTruthy();
});

test("cancelling the panel's folder picker adds nothing", async (t) => {
  const { transport, user } = await setup(t, (transport) =>
    configureProjectRegistration(transport),
  );

  await user.click(screen.getByRole("button", { name: "Manage" }));
  await user.click(screen.getByRole("button", { name: "Add project" }));
  await user.click(screen.getByRole("button", { name: "Browse…" }));

  await waitFor(() =>
    assert.ok(
      transport.calls.some((call) => call.name === "browse_user_agent_project"),
    ),
  );

  assert.equal(
    transport.calls.filter(
      (call) => call.name === "register_user_agent_project",
    ).length,
    0,
  );

  expect(screen.getByRole("dialog")).toBeTruthy();
});

test("cancelling the native picker preserves the manual project path", async (t) => {
  const { controller, transport, user } = await setup(
    t,
    (transport) => configureProjectRegistration(transport),
    {},
  );

  act(() => {
    void controller.addProject();
  });

  const dialog = await screen.findByRole("dialog");

  const path =
    within(dialog).getByLabelText<HTMLInputElement>("Repository path");

  await user.type(path, "/repo/manual-draft");
  await user.click(within(dialog).getByRole("button", { name: "Browse…" }));

  await waitFor(() =>
    assert.ok(
      transport.calls.some((call) => call.name === "browse_user_agent_project"),
    ),
  );

  assert.equal(path.value, "/repo/manual-draft");

  assert.equal(
    transport.calls.filter(
      (call) => call.name === "register_user_agent_project",
    ).length,
    0,
  );
});

test("project registration errors preserve the draft and do not change the selected project", async (t) => {
  const { controller, transport, user } = await setup(
    t,
    (transport) =>
      configureProjectRegistration(transport, {
        registerError: "Use repository root",
      }),
    {},
  );

  act(() => {
    void controller.addProject();
  });

  const dialog = await screen.findByRole("dialog");

  await user.type(
    within(dialog).getByLabelText("Repository path"),
    "/repo/invalid/src",
  );

  await user.click(within(dialog).getByRole("button", { name: "Add project" }));
  await screen.findByText("Use repository root");

  assert.equal(
    within(dialog).getByLabelText<HTMLInputElement>("Repository path").value,
    "/repo/invalid/src",
  );

  assert.equal(controller.getSnapshot().repository, undefined);
  assert.equal(transport.projects.length, 1);
});

test("a chat project hint prefills registration without registering it automatically", async (t) => {
  const { controller, transport, user } = await setup(t, (transport) =>
    configureProjectRegistration(transport),
  );

  await act(async () =>
    controller.applyScope({
      panel_scope: { conversation_id: "chat-project" },
      panel_project_candidate: { repository: "/repo/chat-project" },
    }),
  );

  await user.click(screen.getByRole("button", { name: "Add chat project" }));
  const dialog = await screen.findByRole("dialog");

  assert.equal(
    within(dialog).getByLabelText<HTMLInputElement>("Repository path").value,
    "/repo/chat-project",
  );

  assert.equal(
    transport.calls.filter(
      (call) => call.name === "register_user_agent_project",
    ).length,
    0,
  );

  await user.click(within(dialog).getByRole("button", { name: "Add project" }));

  await waitFor(() =>
    assert.equal(controller.getSnapshot().repository, "/repo/chat-project"),
  );
});

test("folder picker failure keeps manual entry available", async (t) => {
  const { controller, transport, user } = await setup(
    t,
    (transport) =>
      configureProjectRegistration(transport, {
        browseError: "Native folder picker unavailable",
      }),
    {},
  );

  act(() => {
    void controller.addProject();
  });

  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "Browse…" }));
  await within(dialog).findByText("Native folder picker unavailable");
  const path = within(dialog).getByLabelText("Repository path");
  await user.type(path, "/repo/manual-fallback");
  await user.click(within(dialog).getByRole("button", { name: "Add project" }));

  await waitFor(() =>
    assert.equal(
      transport.calls.find(
        (call) => call.name === "register_user_agent_project",
      )?.args.repository,
      "/repo/manual-fallback",
    ),
  );
});

test("a delayed native folder selection cannot overwrite a new project dialog after scope changes", async (t) => {
  let finish!: (result: { repository: string }) => void;

  const { controller, transport, user } = await setup(
    t,
    (transport) => {
      configureProjectRegistration(transport);
      const original = transport.tool.bind(transport);

      transport.tool = async <T>(
        name: string,
        args: Record<string, unknown> = {},
      ): Promise<T> => {
        if (name === "browse_user_agent_project") {
          transport.calls.push({ name, args });

          return new Promise<{ repository: string }>((resolve) => {
            finish = resolve;
          }) as Promise<T>;
        }

        return original<T>(name, args);
      };
    },
    {},
  );

  act(() => {
    void controller.addProject();
  });

  const firstDialog = await screen.findByRole("dialog");

  await user.click(
    within(firstDialog).getByRole("button", { name: "Browse…" }),
  );

  await act(async () =>
    controller.applyScope({
      panel_scope: { conversation_id: null, repository: "/repo/other" },
    }),
  );

  await waitFor(() => assertAbsent(screen.queryByRole("dialog")));

  act(() => {
    void controller.addProject();
  });

  const dialog = await screen.findByRole("dialog");

  const path =
    within(dialog).getByLabelText<HTMLInputElement>("Repository path");

  await user.type(path, "/repo/new-draft");

  await act(async () => {
    finish({ repository: "/repo/stale-selection" });
  });

  assert.equal(path.value, "/repo/new-draft");

  assert.equal(
    transport.calls.filter(
      (call) => call.name === "register_user_agent_project",
    ).length,
    0,
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
  await user.type(runtime, "12.5");
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
    transport.calls.filter((call) => call.name === "start_agent_task").length,
    0,
  );

  assert.deepEqual(
    transport.calls.find((call) => call.name === "register_user_agent_project")
      ?.args,
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
  const { transport, user } = await setup(t, (transport) =>
    configureProjectRegistration(transport, {
      picked: "/repo/new/src",
      registerError: "Use repository root",
    }),
  );

  await openAdvancedTask(user);
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
    transport.calls.filter((call) => call.name === "start_agent_task").length,
    0,
  );
});

test("cancelling the task project picker preserves selection and task draft without registering", async (t) => {
  const { transport, user } = await setup(t, (transport) =>
    configureProjectRegistration(transport),
  );

  await openAdvancedTask(user);
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
    transport.calls.filter(
      (call) => call.name === "register_user_agent_project",
    ).length,
    0,
  );

  assert.equal(
    transport.calls.filter((call) => call.name === "start_agent_task").length,
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
      if (name === "browse_user_agent_project") {
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
    transport.calls.filter(
      (call) => call.name === "register_user_agent_project",
    ).length,
    0,
  );

  assert.equal(
    transport.calls.filter((call) => call.name === "start_agent_task").length,
    0,
  );
});

test("Manage renames projects, preserves failed drafts, and confirms task-data removal", async (t) => {
  const { controller, transport, user } = await setup(t);
  const original = transport.tool.bind(transport);
  let failRename = true;

  transport.tool = async <T>(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<T> => {
    if (name === "rename_user_agent_project") {
      transport.calls.push({ name, args });
      if (failRename) throw new Error("Rename failed");

      transport.projects = transport.projects.map((project) => ({
        ...project,
        name: String(args.name).trim(),
      }));

      return { name: String(args.name).trim() } as T;
    }

    if (name === "remove_user_agent_project") {
      transport.calls.push({ name, args });
      transport.projects = [];
      transport.tasks = [];

      return { repository: args.repository } as T;
    }

    return original<T>(name, args);
  };

  await user.click(screen.getByRole("button", { name: "Manage" }));

  await user.click(
    screen.getByRole("button", { name: "Edit project name: a" }),
  );

  const input = screen.getByRole("textbox", { name: "Project name" });
  await user.clear(input);
  await user.type(input, "New name");
  await act(() => controller.refresh());
  expect((input as HTMLInputElement).value).toBe("New name");
  await user.keyboard("{Enter}");
  await screen.findByRole("alert");
  expect((input as HTMLInputElement).value).toBe("New name");
  failRename = false;
  await user.keyboard("{Enter}");
  await screen.findByRole("button", { name: "Remove New name" });
  await user.click(screen.getByRole("button", { name: "Remove New name" }));

  expect(
    screen
      .getByRole("switch", { name: "Also remove extension task data" })
      .getAttribute("aria-checked"),
  ).toBe("false");

  expect(
    transport.calls.filter((call) => call.name === "remove_user_agent_project"),
  ).toHaveLength(0);

  await user.click(
    screen.getByRole("switch", { name: "Also remove extension task data" }),
  );

  await user.click(
    screen.getByRole("button", { name: "Remove project and task data" }),
  );

  await waitFor(() =>
    expect(controller.getSnapshot().projects).toHaveLength(0),
  );

  expect(
    transport.calls.find((call) => call.name === "remove_user_agent_project")
      ?.args,
  ).toEqual({ repository: "/repo/a", delete_tasks: true });
});

test("Manage cancels edit errors and restores focus when returning from Add", async (t) => {
  const { transport, user } = await setup(t);
  const original = transport.tool.bind(transport);

  transport.tool = async <T>(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<T> => {
    if (name === "rename_user_agent_project") throw new Error("Rename failed");

    return original<T>(name, args);
  };

  await user.click(screen.getByRole("button", { name: "Manage" }));

  await user.click(
    screen.getByRole("button", { name: "Edit project name: a" }),
  );

  await user.type(
    screen.getByRole("textbox", { name: "Project name" }),
    " changed",
  );

  await user.keyboard("{Enter}");
  await screen.findByRole("alert");
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "Remove a" }));
  expect(screen.queryByRole("alert")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "Add project" }));

  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "Repository path" }),
    ),
  );

  await user.click(screen.getByRole("button", { name: "Close" }));

  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Add project" }),
    ),
  );
});

test("a picker finishing after leaving Add cannot replace a new draft", async (t) => {
  const { transport, user } = await setup(t);
  let resolve!: (value: { repository: string }) => void;

  const picked = new Promise<{ repository: string }>((done) => {
    resolve = done;
  });

  const original = transport.tool.bind(transport);

  transport.tool = async <T>(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<T> =>
    name === "browse_user_agent_project"
      ? ((await picked) as T)
      : original<T>(name, args);

  await user.click(screen.getByRole("button", { name: "Manage" }));
  await user.click(screen.getByRole("button", { name: "Add project" }));
  await user.click(screen.getByRole("button", { name: "Browse…" }));
  await user.click(screen.getByRole("button", { name: "Close" }));
  await user.click(screen.getByRole("button", { name: "Add project" }));
  const input = screen.getByRole("textbox", { name: "Repository path" });
  await user.type(input, "/new-draft");

  await act(async () => {
    resolve({ repository: "/late-picker" });
    await picked;
  });

  expect((input as HTMLInputElement).value).toBe("/new-draft");
});

test("Manage opens a page and Back restores task selection, filters and focus", async (t) => {
  const { controller, user } = await setup(t);
  const selected = controller.getSnapshot().selected;
  await act(async () => controller.setSearch("Review"));
  const search = controller.getSnapshot().search;
  await user.click(screen.getByRole("button", { name: "Manage" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("region", { name: "Task inspector" })).toBeNull();

  expect(
    screen.queryByRole("separator", { name: "Resize task list" }),
  ).toBeNull();

  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "Projects" }),
    ),
  );

  await user.click(screen.getByRole("button", { name: "Tasks" }));
  expect(controller.getSnapshot().selected).toBe(selected);
  expect(controller.getSnapshot().search).toBe(search);

  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Manage" }),
  );
});

test("removal uses a focused modal, explains folder retention, and resets the optional choice", async (t) => {
  const { user } = await setup(t);
  await user.click(screen.getByRole("button", { name: "Manage" }));
  await user.click(screen.getByRole("button", { name: "Remove a" }));
  const modal = screen.getByRole("dialog", { name: "Remove project?" });

  expect(modal.textContent).toContain(
    "Your repository folder and files stay on disk.",
  );

  expect(modal.textContent?.toLowerCase()).not.toContain("delete");
  expect(modal.textContent).not.toContain("through an approved parent folder");

  await user.click(
    within(modal).getByRole("switch", {
      name: "Also remove extension task data",
    }),
  );

  await user.click(within(modal).getByRole("button", { name: "Cancel" }));

  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Remove a" }),
    ),
  );

  await user.click(screen.getByRole("button", { name: "Remove a" }));

  expect(
    screen
      .getByRole("switch", { name: "Also remove extension task data" })
      .getAttribute("aria-checked"),
  ).toBe("false");
});

test("removal explains remaining parent registration only when it covers the project", async (t) => {
  const { user } = await setup(t, (transport) => {
    transport.projects.push(
      { repository: "/repo", kind: "parent", name: "Repositories" },
      { repository: "/repo-other", kind: "parent", name: "Other" },
    );
  });

  await user.click(screen.getByRole("button", { name: "Manage" }));
  await user.click(screen.getByRole("button", { name: "Remove a" }));

  expect(screen.getByRole("dialog").textContent).toContain(
    "This project may still be registered through an approved parent folder.",
  );

  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "Remove Repositories" }));

  expect(screen.getByRole("dialog").textContent).not.toContain(
    "through an approved parent folder",
  );
});
