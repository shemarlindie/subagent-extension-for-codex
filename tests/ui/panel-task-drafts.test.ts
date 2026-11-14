// @vitest-environment jsdom
import { expect } from "vitest";

import {
  defaults,
  deferred,
} from "../../src/panel/app/state/controller-test-harness";
import { type Defaults } from "../../src/panel/app/state/types";
import {
  act,
  assert,
  enterTask,
  openAdvancedTask,
  pasteText,
  screen,
  selectOption,
  setup,
  setupDelegate,
  test,
  waitFor,
  within,
} from "./panel-test-support";

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

  await pasteText(user, field, "Keep this draft");

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

  assert.ok(
    controller
      .getSnapshot()
      .projects.some((project) => project.repository === "/repo/b"),
  );

  assert.equal(
    screen
      .getByRole("switch", { name: "Runtime limit" })
      .getAttribute("aria-checked"),
    "true",
  );

  assert.equal(
    screen.getByLabelText<HTMLInputElement>("Runtime limit (mins)").value,
    "0.5",
  );

  assert.equal(
    screen
      .getByRole("switch", { name: "Cost limit" })
      .getAttribute("aria-checked"),
    "false",
  );

  assert.equal(
    screen.getByLabelText<HTMLInputElement>("Cost limit (USD)").value,
    "5",
  );

  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

  await waitFor(() =>
    expect(document.activeElement, "Dialog should restore trigger focus").toBe(
      trigger,
    ),
  );
});

test("changing projects resets the revision while retaining the task draft", async (t) => {
  const { user } = await setupDelegate(t, (transport) => {
    transport.projects.push({ repository: "/repo/b", kind: "repository" });
  });

  await screen.findByRole("dialog");
  await selectOption(user, "Project", /repo\/a$/);
  await enterTask(user, "Persistent task");
  await selectOption(user, "Workspace", "Isolated worktree");
  await user.clear(screen.getByLabelText("Revision"));
  await pasteText(user, screen.getByLabelText("Revision"), "edited-branch");
  await selectOption(user, "Project", /repo\/b$/);

  assert.equal(
    screen.getByLabelText<HTMLInputElement>("Revision").value,
    "HEAD",
  );

  assert.equal(
    screen.getByLabelText<HTMLTextAreaElement>("Description").value,
    "Persistent task",
  );
});

test("delegation selects support keyboard choice and Escape preserves the draft dialog", async (t) => {
  const { user, transport } = await setupDelegate(t);
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
      transport.calls.find((call) => call.name === "start_task")?.args.provider,
      "fixture",
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
      const menu = await screen.findByRole("menu");

      await waitFor(() =>
        expect(document.activeElement).toBe(
          within(menu).getByRole("menuitem", { name: "New task" }),
        ),
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
      if (name === "get_settings") {
        transport.calls.push({ name, args });

        return (await settings.promise) as T;
      }

      return original<T>(name, args);
    };
  });

  await user.click(screen.getByRole("button", { name: "New task" }));
  const message = await screen.findByRole("textbox", { name: "Task message" });
  await pasteText(user, message, "Preserve the pending request");
  expect(controller.getSnapshot().newTask?.statuses.settings).toBe("loading");
  await user.click(screen.getByRole("button", { name: "More options…" }));

  const dialog = within(await screen.findByRole("dialog"));

  const description = dialog.getByRole<HTMLTextAreaElement>("textbox", {
    name: "Description",
  });

  expect(description.value).toBe("Preserve the pending request");
  await pasteText(user, description, " and the Advanced edit");

  expect(
    dialog.getByRole<HTMLButtonElement>("button", { name: "Start task" })
      .disabled,
  ).toBe(true);

  await act(async () => {
    settings.resolve({
      values: {
        ...defaults,
        providers: {
          ...defaults.providers,
          claude: {
            ...defaults.providers.claude,
            permission_mode: "acceptEdits",
          },
        },
        models: {
          ...defaults.models,
          providers: {
            ...defaults.models.providers,
            claude: {
              model: defaults.models.providers.claude?.model ?? "",
              reasoning_effort: "high",
            },
          },
        },
      },
    });
  });

  await waitFor(() => {
    expect(dialog.getByRole("combobox", { name: "Worker" }).textContent).toBe(
      "claude · reviewer",
    );

    expect(
      dialog.getByRole("combobox", { name: "Reasoning" }).textContent,
    ).toBe("Use default (high)");

    // A read-only profile starts in plan mode, whatever the saved mode.
    expect(
      dialog.getByRole("combobox", { name: "Permission mode" }).textContent,
    ).toBe("Plan — read only");
  });

  expect(description.value).toBe(
    "Preserve the pending request and the Advanced edit",
  );

  await user.click(dialog.getByRole("button", { name: "Start task" }));

  await waitFor(() => {
    const submissions = transport.calls.filter(
      (call) => call.name === "start_task",
    );

    expect(submissions).toHaveLength(1);

    expect(submissions[0]?.args).toMatchObject({
      description: "Preserve the pending request and the Advanced edit",
      repository: "/repo/a",
      provider: "claude",
      worker_profile: "reviewer",
      reasoning_effort: "default",
      provider_options: {
        claude: { permission_mode: "plan", approval_decider: "user" },
      },
    });
  });
});
