// @vitest-environment jsdom
import { expect } from "vitest";

import {
  act,
  assert,
  assertAbsent,
  configureProjectRegistration,
  pasteText,
  screen,
  setup,
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

test("browsing a folder fills the project draft without granting access", async (t) => {
  const { controller, transport, user } = await setup(
    t,
    (transport) =>
      configureProjectRegistration(transport, { picked: "/repo/picked" }),
    { view: "dialogs" },
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
    transport.calls.filter((call) => call.name === "app_register_project")
      .length,
    0,
  );

  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => assertAbsent(screen.queryByRole("dialog")));

  assert.equal(
    transport.calls.filter((call) => call.name === "app_register_project")
      .length,
    0,
  );
});

test("cancelling the native picker preserves the manual project path", async (t) => {
  const { controller, transport, user } = await setup(
    t,
    (transport) => configureProjectRegistration(transport),
    { view: "dialogs" },
  );

  act(() => {
    void controller.addProject();
  });

  const dialog = await screen.findByRole("dialog");

  const path =
    within(dialog).getByLabelText<HTMLInputElement>("Repository path");

  await pasteText(user, path, "/repo/manual-draft");
  await user.click(within(dialog).getByRole("button", { name: "Browse…" }));

  await waitFor(() =>
    assert.ok(
      transport.calls.some((call) => call.name === "app_browse_project"),
    ),
  );

  assert.equal(path.value, "/repo/manual-draft");

  assert.equal(
    transport.calls.filter((call) => call.name === "app_register_project")
      .length,
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
    { view: "dialogs" },
  );

  act(() => {
    void controller.addProject();
  });

  const dialog = await screen.findByRole("dialog");

  await pasteText(
    user,
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
    transport.calls.filter((call) => call.name === "app_register_project")
      .length,
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
    { view: "dialogs" },
  );

  act(() => {
    void controller.addProject();
  });

  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "Browse…" }));
  await within(dialog).findByText("Native folder picker unavailable");
  const path = within(dialog).getByLabelText("Repository path");
  await pasteText(user, path, "/repo/manual-fallback");
  await user.click(within(dialog).getByRole("button", { name: "Add project" }));

  await waitFor(() =>
    assert.equal(
      transport.calls.find((call) => call.name === "app_register_project")?.args
        .repository,
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
        if (name === "app_browse_project") {
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

  await pasteText(user, path, "/repo/new-draft");

  await act(async () => {
    finish({ repository: "/repo/stale-selection" });
  });

  assert.equal(path.value, "/repo/new-draft");

  assert.equal(
    transport.calls.filter((call) => call.name === "app_register_project")
      .length,
    0,
  );
});
