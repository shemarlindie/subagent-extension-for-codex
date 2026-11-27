import { act, screen } from "@testing-library/react";

import { budgetRow, serveSettings } from "../../panel-test-support";
import type { Mounted } from "../base-state";
import type { Scenario } from "./scenario";

/** Focuses the task composer, as typing starts. A conversation's panel hides it at first. */
async function focusComposer({ user }: Mounted) {
  const show = screen.queryByRole("button", { name: "Show composer" });
  if (show) await user.click(show);
  await user.click(await screen.findByRole("textbox", { name: "Message" }));
}

/**
 * Keystrokes in the panel's text fields. Composer keystrokes follow the first,
 * since the first one enables sending.
 */
export const typingScenarios: Scenario[] = [
  {
    label: "A keystroke in the task composer",
    group: "Typing",
    prepare: async (mounted) => {
      await focusComposer(mounted);
      await mounted.user.keyboard("a");
    },
    change: ({ user }) => user.keyboard("b"),
  },
  {
    label: "A keystroke in the new-task composer",
    group: "Typing",
    prepare: async ({ controller, user }) => {
      await act(async () => controller.newTasks.open());

      await user.click(
        await screen.findByRole("textbox", { name: "Task message" }),
      );

      await user.keyboard("a");
    },
    change: ({ user }) => user.keyboard("b"),
  },
  {
    label: "A keystroke in search",
    group: "Typing",
    prepare: async ({ user }) => {
      await user.click(screen.getByRole("searchbox", { name: "Search tasks" }));
    },
    change: ({ user }) => user.keyboard("a"),
  },
  {
    label: "A keystroke in a settings field",
    group: "Typing",
    prepare: async ({ controller, transport, user }) => {
      serveSettings(transport, {
        values: {
          task: { budget: { max_cost_usd: { enabled: true, amount: 5 } } },
        },
        sections: [{ id: "task", title: "Task", rows: [budgetRow] }],
      });

      await act(() => controller.settings());
      await user.click(await screen.findByRole("spinbutton"));
    },
    change: ({ user }) => user.keyboard("1"),
  },
  {
    label: "Slash opens the command menu",
    group: "Typing",
    prepare: focusComposer,
    change: ({ user }) => user.keyboard("/"),
  },
  {
    label: "A keystroke filters the command menu",
    group: "Typing",
    prepare: async (mounted) => {
      await focusComposer(mounted);
      await mounted.user.keyboard("/");
    },
    change: ({ user }) => user.keyboard("r"),
  },
];
