import { act } from "@testing-library/react";

import { changePages } from "../../panel-test-support";
import { event, SELECTED, storeChat, type Mounted } from "../base-state";
import {
  addTask,
  askPermission,
  askQuestion,
  refreshWith,
  showTab,
  updateTask,
  type Scenario,
} from "./scenario";

const appendActivity = (mounted: Mounted) =>
  refreshWith(mounted, () => {
    mounted.transport.taskEvents.push(
      event("agent.message", {
        role: "assistant",
        text: "The logout handler clears the session.",
        message_id: "m3",
      }),
      event("agent.thinking_tokens", { tokens: 20 }),
    );

    storeChat(mounted.transport);
  });

/** Data changes the panel reads on a refresh. */
export const readScenarios: Scenario[] = [
  {
    label: "Idle refresh with unchanged data",
    group: "Reads",
    change: (mounted) => refreshWith(mounted, () => {}),
  },
  {
    label: "Another task's status changes",
    group: "Reads",
    change: (mounted) =>
      refreshWith(mounted, () =>
        updateTask(mounted, "three", { status: "waiting" }),
      ),
  },
  {
    label: "Another task's runtime changes",
    group: "Reads",
    change: (mounted) =>
      refreshWith(mounted, () =>
        updateTask(mounted, "three", { runtime_ms: 5_000 }),
      ),
  },
  {
    label: "Another task's title changes",
    group: "Reads",
    change: (mounted) =>
      refreshWith(mounted, () =>
        updateTask(mounted, "three", { title: "Move the config loader" }),
      ),
  },
  {
    label: "The selected task's status changes",
    group: "Reads",
    change: (mounted) =>
      refreshWith(mounted, () =>
        updateTask(mounted, SELECTED, { status: "completed" }),
      ),
  },
  {
    label: "The selected task's runtime changes",
    group: "Reads",
    change: (mounted) =>
      refreshWith(mounted, () =>
        updateTask(mounted, SELECTED, { runtime_ms: 90_000 }),
      ),
  },
  {
    label: "The selected task's cost changes",
    group: "Reads",
    change: (mounted) =>
      refreshWith(mounted, () =>
        updateTask(mounted, SELECTED, { cost_usd: 0.64 }),
      ),
  },
  {
    label: "A task arrives",
    group: "Reads",
    change: addTask,
  },
  {
    label: "A task is archived",
    group: "Reads",
    change: (mounted) =>
      refreshWith(mounted, () =>
        updateTask(mounted, "three", { archived_at: "2026-11-15T12:01:00Z" }),
      ),
  },
  {
    label: "A task is deleted",
    group: "Reads",
    change: (mounted) =>
      refreshWith(mounted, () => {
        mounted.transport.tasks = mounted.transport.tasks.filter(
          ({ id }) => id !== "three",
        );
      }),
  },
  {
    label: "A task becomes read",
    group: "Reads",
    change: (mounted) =>
      refreshWith(mounted, () =>
        updateTask(mounted, "two", { unread: undefined }),
      ),
  },
  {
    label: "A task becomes unread",
    group: "Reads",
    change: (mounted) =>
      refreshWith(mounted, () =>
        updateTask(mounted, "three", { unread: true }),
      ),
  },
  {
    label: "The selected task waits for input",
    group: "Reads",
    change: (mounted) =>
      refreshWith(mounted, () =>
        updateTask(mounted, SELECTED, {
          status: "waiting",
          waiting_reason: "Waiting for your reply",
        }),
      ),
  },
  {
    label: "The selected task asks a question",
    group: "Reads",
    change: askQuestion,
  },
  {
    label: "The selected task asks for permission",
    group: "Reads",
    change: askPermission,
  },
  {
    label: "Activity events append with Activity shown",
    group: "Reads",
    prepare: showTab("activity"),
    change: appendActivity,
  },
  {
    label: "Activity events append with Chat shown",
    group: "Reads",
    change: appendActivity,
  },
  {
    label: "A Chat message is stored",
    group: "Reads",
    change: (mounted) =>
      refreshWith(mounted, () => {
        mounted.transport.taskEvents.push(
          event("agent.message", {
            role: "assistant",
            text: "The logout handler keeps the cookie after sign out.",
            message_id: "m3",
          }),
        );

        storeChat(mounted.transport);
      }),
  },
  {
    label: "Change counts change",
    group: "Reads",
    change: async ({ controller, transport }) => {
      const [first, ...rest] = changePages();
      transport.changes = [{ ...first, additions: 3 }, ...rest];
      await act(() => controller.changes.loadCounts());
    },
  },
  {
    label: "A changed file's content changes",
    group: "Reads",
    prepare: showTab("changes"),
    // A refresh reads changes again once they're stale, as this does.
    change: async ({ controller, transport }) => {
      const [first, ...rest] = changePages();

      transport.changes = [
        {
          ...first,
          files: first.files.map((file) =>
            file.path === "src/a.ts" ? { ...file, additions: 2 } : file,
          ),
          additions: 2,
          diff: `${first.diff}@@ -5 +5 @@\n-old tail\n+new tail\n`,
        },
        ...rest,
      ];

      await act(() => controller.changes.loadChanges());
    },
  },
  {
    label: "Projects change",
    group: "Reads",
    change: (mounted) =>
      refreshWith(mounted, () =>
        mounted.transport.projects.push({
          repository: "/repo/c",
          kind: "repository",
        }),
      ),
  },
  {
    label: "Pending updates change",
    group: "Reads",
    // Pending updates show only in a conversation's panel.
    layout: "scoped",
    // The snapshot shares the transport's array, so this replaces it.
    change: (mounted) =>
      refreshWith(mounted, () => {
        mounted.transport.pendingUpdates = [
          ...mounted.transport.pendingUpdates,
          {
            task_id: "three",
            title: "Migrate the config loader",
            updates: [
              {
                event_id: 2,
                kind: "reply",
                text: "The loader reads TOML now.",
                timestamp: "2026-11-15T12:02:00Z",
              },
            ],
          },
        ];
      }),
  },
];
