import { act, screen, within } from "@testing-library/react";

import { SELECTED, type Mounted } from "../base-state";
import {
  addTask,
  askPermission,
  askQuestion,
  showTab,
  type Scenario,
} from "./scenario";

const button = (name: string | RegExp) => screen.getByRole("button", { name });

/** The first of several buttons with this name. */
function firstOf(name: string | RegExp) {
  const [first] = screen.getAllByRole("button", { name });
  if (!first) throw new Error(`No ${String(name)} button`);

  return first;
}

const selectedTask = ({ controller }: Mounted) => {
  const task = controller.getSnapshot().tasks.find(({ id }) => id === SELECTED);

  if (!task) throw new Error("The selected task is missing");

  return task;
};

/** Opens the archive page of the first project. */
async function openArchive({ controller, user }: Mounted) {
  await act(async () => controller.manageProjects());

  const open = await screen.findAllByRole("button", { name: /archive/i });
  const first = open[0];
  if (!first) throw new Error("No project archive button");
  await user.click(first);
  await screen.findByRole("list", { name: "Archived tasks" });
}

/** Single user actions and the views they open. */
export const oneOffScenarios: Scenario[] = [
  {
    label: "Select another task",
    group: "One-off",
    change: ({ user }) => user.click(button(/^Migrate the config loader/)),
  },
  {
    label: "Switch to the Activity tab",
    group: "One-off",
    change: ({ user }) =>
      user.click(screen.getByRole("tab", { name: /Activity/ })),
  },
  {
    label: "Filter the task list",
    group: "One-off",
    change: ({ user }) =>
      user.click(screen.getByRole("radio", { name: /^Unread/ })),
  },
  {
    label: "Collapse a project group",
    group: "One-off",
    change: async ({ user }) => {
      const trigger = document.querySelector<HTMLElement>(
        ".task-group-toggle[aria-expanded='true']",
      );

      if (!trigger) throw new Error("No expanded project group");
      await user.click(trigger);
    },
  },
  {
    label: "Open the task menu",
    group: "One-off",
    change: ({ user }) => user.click(button("Task actions")),
  },
  {
    label: "Show a tooltip",
    group: "One-off",
    change: ({ user }) => user.hover(button("Settings")),
  },
  {
    label: "Queue a message",
    group: "One-off",
    prepare: async ({ user }) => {
      await user.click(screen.getByRole("textbox", { name: "Message" }));
      await user.paste("Also check the refresh token.");
    },
    change: ({ user }) => user.keyboard("{Enter}"),
  },
  {
    label: "Reorder a queued message",
    group: "One-off",
    change: async (mounted) => {
      await act(() =>
        mounted.controller.taskActions.moveQueued(
          selectedTask(mounted),
          "q2",
          0,
        ),
      );
    },
  },
  {
    label: "Remove a queued message",
    group: "One-off",
    change: async ({ user }) => {
      await user.click(firstOf("Remove"));
    },
  },
  {
    label: "Undo removing a queued message",
    group: "One-off",
    prepare: async ({ user }) => {
      await user.click(firstOf("Remove"));
    },
    change: ({ user }) => user.click(button("Undo")),
  },
  {
    label: "Open a dialog",
    group: "One-off",
    change: async ({ controller }) => {
      await act(() => controller.delegate());
    },
  },
  {
    label: "Close a dialog",
    group: "One-off",
    prepare: async ({ controller }) => {
      await act(() => controller.delegate());
    },
    change: ({ user }) => user.keyboard("{Escape}"),
  },
  {
    label: "Dismiss a notice",
    group: "One-off",
    prepare: addTask,
    change: async ({ user }) => {
      // The toast region is hidden from the accessibility tree until focused.
      const dismiss = document.querySelector<HTMLElement>(
        '[aria-label="Dismiss new task notification"]',
      );

      if (!dismiss) throw new Error("No new task notification");
      await user.click(dismiss);
    },
  },
  {
    label: "Check an archived task",
    group: "One-off",
    prepare: openArchive,
    change: async ({ user }) => {
      const list = screen.getByRole("list", { name: "Archived tasks" });
      const [first] = within(list).getAllByRole("checkbox");
      if (!first) throw new Error("No archived task");
      await user.click(first);
    },
  },
  {
    label: "Answer a question",
    group: "One-off",
    prepare: askQuestion,
    change: ({ user }) =>
      user.click(screen.getByRole("radio", { name: /Redis/ })),
  },
  {
    label: "Answer a permission request",
    group: "One-off",
    prepare: askPermission,
    change: ({ user }) => user.click(button("Deny")),
  },
  {
    label: "Expand an Activity group",
    group: "One-off",
    prepare: showTab("activity"),
    change: async ({ user }) => {
      const timeline = screen.getByRole("region", { name: "Activity history" });

      const [trigger] = within(timeline)
        .getAllByRole("button")
        .filter((element) => element.getAttribute("aria-expanded") === "false");

      if (!trigger) throw new Error("No collapsed Activity group");
      await user.click(trigger);
    },
  },
  {
    label: "Mark a changed file viewed",
    group: "One-off",
    prepare: showTab("changes"),
    change: ({ user }) =>
      user.click(screen.getByRole("checkbox", { name: "Viewed src/a.ts" })),
  },
  {
    label: "Open a changed file",
    group: "One-off",
    prepare: showTab("changes"),
    change: ({ user }) => user.click(button("Preview src/a.ts")),
  },
  {
    label: "Switch changed files",
    group: "One-off",
    prepare: async (mounted) => {
      await showTab("changes")(mounted);
      await mounted.user.click(button("Preview src/a.ts"));
    },
    // The open preview covers the file list, so this switches as its file menu does.
    change: async ({ controller }) => {
      await act(async () => controller.showChangedFile("logo.png"));
    },
  },
  {
    label: "Open the file preview options",
    group: "One-off",
    prepare: async (mounted) => {
      await showTab("changes")(mounted);
      await mounted.user.click(button("Preview src/a.ts"));
    },
    change: ({ user }) => user.click(button("File preview options")),
  },
  {
    label: "Copy a Chat message",
    group: "One-off",
    change: async ({ user }) => {
      await user.click(firstOf("Copy response"));
    },
  },
];
