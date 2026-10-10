// @vitest-environment jsdom
import {
  act,
  assert,
  assertAbsent,
  configureProjectRegistration,
  enterTask,
  screen,
  selectOption,
  setup,
  test,
  waitFor,
  within,
} from "./react-ui-test-support";

test("project picker uses accessible options, changes scope by keyboard, and preserves its trigger during refresh", async (t) => {
  const { controller, user } = await setup(t);
  const picker = screen.getByRole("combobox", { name: "Project scope" });
  await user.click(picker);
  const all = await screen.findByRole("option", { name: "All projects" });

  await waitFor(() =>
    assert.ok(
      document.activeElement === all,
      "All projects should receive opening focus",
    ),
  );

  await user.keyboard("{End}");

  await waitFor(() =>
    assert.ok(
      document.activeElement === screen.getByRole("option", { name: "a" }),
      "Project option should receive focus",
    ),
  );

  await user.keyboard("{Enter}");

  await waitFor(() =>
    assert.equal(controller.getSnapshot().repository, "/repo/a"),
  );

  await waitFor(() =>
    assert.equal(picker.getAttribute("aria-expanded"), "false"),
  );

  assert.match(picker.textContent ?? "", /a/);
  await act(() => controller.refresh());

  assert.ok(
    screen.getByRole("combobox", { name: "Project scope" }) === picker,
    "Polling should retain the picker trigger",
  );

  await user.click(picker);

  await waitFor(() =>
    assert.ok(
      document.activeElement === screen.getByRole("option", { name: "a" }),
      "Project option should receive focus",
    ),
  );

  await user.keyboard("{Home}");

  await waitFor(() =>
    assert.ok(
      document.activeElement ===
        screen.getByRole("option", { name: "All projects" }),
      "All projects should receive Home focus",
    ),
  );

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
      (within(dialog).getByLabelText("Repository path") as HTMLInputElement)
        .value,
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

test("the panel's Browse button picks a folder and adds it without the project dialog", async (t) => {
  const { transport, user } = await setup(t, (transport) =>
    configureProjectRegistration(transport, { picked: "/repo/picked" }),
  );

  await user.click(screen.getByRole("button", { name: "Browse" }));

  await waitFor(() =>
    assert.deepEqual(
      transport.calls
        .filter((call) => call.name === "register_user_agent_project")
        .map((call) => call.args),
      [{ repository: "/repo/picked" }],
    ),
  );

  assertAbsent(screen.queryByRole("dialog"));
});

test("cancelling the panel's folder picker adds nothing", async (t) => {
  const { transport, user } = await setup(t, (transport) =>
    configureProjectRegistration(transport),
  );

  await user.click(screen.getByRole("button", { name: "Browse" }));

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

  assertAbsent(screen.queryByRole("dialog"));
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

  const path = within(dialog).getByLabelText(
    "Repository path",
  ) as HTMLInputElement;

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
    (within(dialog).getByLabelText("Repository path") as HTMLInputElement)
      .value,
    "/repo/invalid/src",
  );

  assert.equal(controller.getSnapshot().repository, undefined);
  assert.equal(transport.projects.length, 1);
});

test("a chat project hint prefills registration without registering it automatically", async (t) => {
  const { controller, transport, user } = await setup(t, (transport) =>
    configureProjectRegistration(transport),
  );

  await act(() =>
    controller.applyScope({
      panel_scope: { conversation_id: "chat-project" },
      panel_project_candidate: { repository: "/repo/chat-project" },
    }),
  );

  await user.click(screen.getByRole("button", { name: "Add chat project" }));
  const dialog = await screen.findByRole("dialog");

  assert.equal(
    (within(dialog).getByLabelText("Repository path") as HTMLInputElement)
      .value,
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

  await act(() =>
    controller.applyScope({
      panel_scope: { conversation_id: null, repository: "/repo/other" },
    }),
  );

  await waitFor(() => assertAbsent(screen.queryByRole("dialog")));

  act(() => {
    void controller.addProject();
  });

  const dialog = await screen.findByRole("dialog");

  const path = within(dialog).getByLabelText(
    "Repository path",
  ) as HTMLInputElement;

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

  await user.click(screen.getByRole("button", { name: "New Task" }));
  const dialog = await screen.findByRole("dialog");
  await enterTask(user, "Review this new project with my draft intact");
  await selectOption(user, "Worker", "fixture · reviewer");
  const runtime = screen.getByLabelText("Runtime limit · minutes");
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
    (within(dialog).getByLabelText("Description") as HTMLTextAreaElement).value,
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

  await waitFor(() =>
    assert.equal(
      transport.calls.filter((call) => call.name === "start_agent_task").length,
      1,
    ),
  );

  const started = transport.calls.find(
    (call) => call.name === "start_agent_task",
  )!;

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

  await user.click(screen.getByRole("button", { name: "New Task" }));
  const dialog = await screen.findByRole("dialog");
  await enterTask(user, "Keep this description after registration failure");
  await user.click(within(dialog).getByRole("button", { name: "Browse…" }));
  await within(dialog).findByText("Use repository root");

  assert.equal(
    within(dialog).getByRole("combobox", { name: "Project" }).textContent,
    "/repo/a",
  );

  assert.equal(
    (within(dialog).getByLabelText("Description") as HTMLTextAreaElement).value,
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

  await user.click(screen.getByRole("button", { name: "New Task" }));
  const dialog = await screen.findByRole("dialog");
  await enterTask(user, "Preserve task while browsing");
  await user.click(within(dialog).getByRole("button", { name: "Browse…" }));

  await waitFor(() =>
    assert.equal(
      (
        within(dialog).getByRole("button", {
          name: "Browse…",
        }) as HTMLButtonElement
      ).disabled,
      false,
    ),
  );

  assert.equal(
    within(dialog).getByRole("combobox", { name: "Project" }).textContent,
    "/repo/a",
  );

  assert.equal(
    (within(dialog).getByLabelText("Description") as HTMLTextAreaElement).value,
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

  await user.click(screen.getByRole("button", { name: "New Task" }));
  const dialog = await screen.findByRole("dialog");
  await enterTask(user, "A pending folder selection");

  const start = within(dialog).getByRole("button", {
    name: "Start task",
  }) as HTMLButtonElement;

  await user.click(within(dialog).getByRole("button", { name: "Browse…" }));
  assert.equal(start.disabled, true);

  await act(() =>
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
