// @vitest-environment jsdom
import { expect } from "vitest";

import {
  act,
  assert,
  assertAbsent,
  changePages,
  screen,
  setup,
  task,
  test,
  waitFor,
  within,
} from "./panel-test-support";

test("the Changes tab reads every page and shows the worktree branch and its commands", async (t) => {
  const { user } = await setup(t, (transport) => {
    transport.tasks = [
      {
        ...task(),
        branch: "agent/one",
        workspace: "/data/worktrees/one",
        base_commit: "abc123",
      },
    ];

    transport.changes = changePages();
  });

  await user.click(screen.getByRole("tab", { name: /^Changes/ }));

  await waitFor(() =>
    assert.match(
      document.querySelector(".diff-row.add")?.textContent ?? "",
      /new line/,
    ),
  );

  assert.ok(screen.getByText("+1 −1, 2 files"));
  assert.ok(screen.getByText(/^Edits recorded from this task/));

  assert.ok(
    screen.getAllByText("An edit to this file wasn't recorded.").length,
  );

  assert.ok(screen.getByText("git diff abc123...agent/one"));
  assert.ok(screen.getByText("git push -u origin agent/one"));
  assert.ok(screen.getByText("cd /data/worktrees/one"));
  // One turn so far: the whole task is the only scope.
  assertAbsent(screen.queryByRole("group", { name: "Changes to show" }));

  await user.click(screen.getByRole("tab", { name: "Details" }));
  assert.ok(screen.getByText("agent/one"));
  assert.ok(screen.getAllByText("+1 −1, 2 files").length);
});

test("the Changes tab offers This turn after a second turn and explains empty states", async (t) => {
  const { controller, transport, user } = await setup(t, (transport) => {
    transport.tasks = [{ ...task(), turn: 2, branch: "agent/one" }];
  });

  await user.click(screen.getByRole("tab", { name: /^Changes/ }));
  // Empty states say no edits were recorded for the scope.
  await screen.findByText("No recorded edits.");
  transport.changes = [{ ...transport.changes[0], scope: "turn" }];
  await user.click(screen.getByRole("button", { name: "This turn" }));
  await screen.findByText("No recorded edits from this turn.");
  assert.equal(transport.calls.at(-1)?.args.scope, "turn");

  transport.tasks = transport.tasks.map((task) => ({
    ...task,
    workspace_removed: true,
  }));

  await act(() => controller.refresh());
  await user.click(screen.getByRole("button", { name: "Refresh changes" }));
  await screen.findByText("git checkout agent/one");

  // A finished turn reloads changes; a failed read labels and retains the
  // last loaded result, so the worktree's branch remains visible.
  const tool = transport.tool.bind(transport);

  transport.tool = async <T>(name: string, args?: Record<string, unknown>) => {
    if (name === "get_changes") {
      throw new Error("This task has no change snapshot.");
    }

    return tool<T>(name, args);
  };

  const [current] = transport.tasks;

  assert.ok(current);
  transport.tasks = [{ ...current, status: "completed" }];
  await act(() => controller.refresh());
  const alert = await screen.findByRole("alert");

  assert.match(alert.textContent ?? "", /This task has no change snapshot\./);
  assert.match(alert.textContent ?? "", /last.*loaded/i);
  assert.ok(screen.getByText(/The worktree was removed/));
  assert.ok(screen.getByText("git checkout agent/one"));
  assertAbsent(screen.queryByRole("progressbar"));
});

test("previews say when a file was deleted, is binary, or can't be read", async (t) => {
  const { controller, transport } = await setup(t);
  const [task] = controller.getSnapshot().tasks;

  assert.ok(task);

  transport.changedFiles = {
    "gone.ts": { path: "gone.ts", state: "deleted", size: 0 },
    "data.bin": { path: "data.bin", state: "binary", size: 2048 },
  };

  const previews: [path: string, text: string][] = [
    ["gone.ts", "Deleted"],
    ["data.bin", "Binary file changed · 2.0 KB"],
    ["missing.ts", "The service returned no file."],
  ];

  for (const [path, text] of previews) {
    if (path === "missing.ts") {
      const tool = transport.tool.bind(transport);

      transport.tool = async <T>(
        name: string,
        args?: Record<string, unknown>,
      ) => {
        if (name === "get_changed_file") {
          throw new Error("The service returned no file.");
        }

        return tool<T>(name, args);
      };
    }

    act(() => controller.open({ kind: "file", task, path }));
    const dialog = await screen.findByRole("dialog", { name: path });
    await within(dialog).findByText(text);
    act(() => controller.dismiss());
    await waitFor(() => assertAbsent(screen.queryByRole("dialog")));
  }
});

test("worktree removal stays disabled until the task stops", async (t) => {
  const { controller, transport, user } = await setup(t, (transport) => {
    transport.tasks = [{ ...task(), status: "running", branch: "agent/one" }];
  });

  await user.click(screen.getByRole("tab", { name: /^Changes/ }));
  const remove = await screen.findByRole("button", { name: "Remove worktree" });
  assert.equal((remove as HTMLButtonElement).disabled, true);
  assert.ok(screen.getByText("Available once the task stops."));

  const [running] = transport.tasks;
  assert.ok(running);
  transport.tasks = [{ ...running, status: "interrupted" }];
  await act(() => controller.refresh());

  await waitFor(() =>
    assert.equal((remove as HTMLButtonElement).disabled, false),
  );
});

test("a current_repo task explains recorded edits and current file previews", async (t) => {
  const { user } = await setup(t, (transport) => {
    transport.tasks = [{ ...task(), workspace_strategy: "current_repo" }];
  });

  await user.click(screen.getByRole("tab", { name: /^Changes/ }));

  assert.ok(await screen.findByText(/^Edits recorded from this task/));

  assertAbsent(screen.queryByText(/git push/));
});

test("command and incomplete edits carry notes and incomplete files add no lines", async (t) => {
  const { user } = await setup(t, (transport) => {
    transport.changes = [
      {
        scope: "task",
        files: [
          {
            path: "command.ts",
            status: "modified",
            additions: 1,
            deletions: 1,
            source: "command",
            incomplete: false,
          },
          {
            path: "missing.ts",
            status: "modified",
            additions: 0,
            deletions: 0,
            source: "command",
            incomplete: true,
          },
        ],
        additions: 1,
        deletions: 1,
        diff: "diff --git a/command.ts b/command.ts\n--- a/command.ts\n+++ b/command.ts\n@@ -1 +1 @@\n-old\n+new\n",
        unrecorded_commands: true,
      },
    ];
  });

  await user.click(screen.getByRole("tab", { name: /^Changes/ }));
  await screen.findByText("+1 −1, 2 files");
  expect(screen.getAllByText("command")).toHaveLength(2);

  expect(screen.getAllByText("Changed by a command.").length).toBeGreaterThan(
    0,
  );

  expect(
    screen.getAllByText("An edit to this file wasn't recorded.").length,
  ).toBeGreaterThan(0);

  expect(
    screen.getByText("Some changes made by commands weren't recorded."),
  ).toBeTruthy();
});

test("Ask Codex about a previewed file prepares its context and restores the preview after sending", async (t) => {
  const { transport, user } = await setup(
    t,
    (transport) => {
      transport.host.canSend = true;
      transport.host.canShare = false;
      transport.changes = changePages("data.bin");

      transport.changedFiles = {
        "src/a.ts": {
          path: "src/a.ts",
          state: "present",
          size: 9,
          encoding: "utf8",
          content: "new line\n",
        },
      };
    },
    { conversation: "thread-one" },
  );

  await user.click(screen.getByRole("tab", { name: /^Changes/ }));

  await user.click(
    await screen.findByRole("button", { name: "Preview src/a.ts" }),
  );

  const preview = await screen.findByRole("dialog", { name: "src/a.ts" });

  const ask = within(preview).getByRole("button", {
    name: "Ask Codex about this file",
  });

  await waitFor(() => expect((ask as HTMLButtonElement).disabled).toBe(false));
  const sharedBeforeClick = [...transport.shared];
  await user.click(ask);

  const dialog = await screen.findByRole("dialog", {
    name: "Ask Codex about this file",
  });

  const field = within(dialog).getByRole<HTMLTextAreaElement>("textbox", {
    name: "Message",
  });

  await waitFor(() => expect(document.activeElement).toBe(field));
  expect(field.value).toContain("src/a.ts");
  expect(field.value).toContain("/repo/a");
  expect(field.value).toContain("one");
  expect(field.value).toContain("new line");
  expect(field.value).toContain("get_changes");
  expect(transport.messages).toEqual([]);
  expect(transport.shared).toEqual(sharedBeforeClick);
  await user.clear(field);
  await user.type(field, "Explain the change in src/a.ts.");

  await user.click(
    within(dialog).getByRole("button", {
      name: "Send to conversation",
    }),
  );

  await waitFor(() =>
    expect(transport.messages).toEqual(["Explain the change in src/a.ts."]),
  );

  const restoredPreview = await screen.findByRole("dialog", {
    name: "src/a.ts",
  });

  await waitFor(() =>
    expect(restoredPreview.contains(document.activeElement)).toBe(true),
  );

  await user.click(
    within(restoredPreview).getByRole("button", {
      name: "Ask Codex about this file",
    }),
  );

  const reopenedHandoff = await screen.findByRole("dialog", {
    name: "Ask Codex about this file",
  });

  const [closeHandoff] = within(reopenedHandoff).getAllByRole("button", {
    name: "Close",
  });

  assert(closeHandoff);
  await user.click(closeHandoff);

  const closedHandoffPreview = await screen.findByRole("dialog", {
    name: "src/a.ts",
  });

  await waitFor(() =>
    expect(closedHandoffPreview.contains(document.activeElement)).toBe(true),
  );
});

test("global mode hides Ask Codex about a previewed file even when the host can send", async (t) => {
  const { controller } = await setup(t, (transport) => {
    transport.host.canSend = true;

    transport.changedFiles = {
      "src/a.ts": {
        path: "src/a.ts",
        state: "present",
        size: 9,
        encoding: "utf8",
        content: "new line\n",
      },
    };
  });

  const [task] = controller.getSnapshot().tasks;

  assert.ok(task);
  act(() => controller.open({ kind: "file", task, path: "src/a.ts" }));

  const preview = await screen.findByRole("dialog", { name: "src/a.ts" });

  await waitFor(() =>
    expect(preview.querySelector(".code-view")?.textContent).toContain(
      "new line",
    ),
  );

  expect(
    within(preview).queryByRole("button", {
      name: "Ask Codex about this file",
    }),
  ).toBeNull();
});
