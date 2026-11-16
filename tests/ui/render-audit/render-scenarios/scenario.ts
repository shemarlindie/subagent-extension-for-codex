import { act } from "@testing-library/react";
import { vi, type TestContext } from "vitest";

import type { Task } from "../../../../src/panel/app/state/types";
import {
  listedTask,
  mountBase,
  SELECTED,
  settle,
  type Layout,
  type Mounted,
} from "../base-state";
import { recordRenders, type RenderResult } from "../render-recorder";

type Group = "Reads" | "Streaming" | "Host" | "Timers" | "Typing" | "One-off";

/** One kind of change, applied to the settled base state. */
export type Scenario = {
  label: string;
  group: Group;
  layout?: Layout;
  /** Brings the panel to the state the change starts from. */
  prepare?: (mounted: Mounted) => Promise<void>;
  change: (mounted: Mounted) => Promise<void>;
};

export type ScenarioResult = RenderResult & {
  /** How many times the controller notified its subscribers. */
  notifications: number;
  /** `useSnapshot` warnings about selections that change on every patch. */
  warnings: number;
};

/** Mounts the base state, prepares it, then records the change. */
export async function runScenario(
  t: TestContext,
  scenario: Scenario,
): Promise<ScenarioResult> {
  const mounted = await mountBase(t, scenario.layout);

  if (scenario.prepare) {
    await scenario.prepare(mounted);
    await settle();
  }

  let notifications = 0;
  const unsubscribe = mounted.controller.subscribe(() => notifications++);
  // An existing spy, such as the report's, is reused.
  const warn = vi.spyOn(console, "warn");
  const warned = warn.mock.calls.length;
  const recording = recordRenders();
  let result: RenderResult;

  try {
    await scenario.change(mounted);
    await settle();
  } finally {
    unsubscribe();
    result = recording.stop();
  }

  const warnings = warn.mock.calls
    .slice(warned)
    .filter(([message]) => String(message).startsWith("useSnapshot")).length;

  return { ...result, notifications, warnings };
}

/** Changes the transport's data, then reads it as a refresh does. */
export async function refreshWith({ controller }: Mounted, change: () => void) {
  change();
  await act(() => controller.refresh());
}

/** Replaces a listed task's fields in the transport. */
export function updateTask(
  { transport }: Mounted,
  id: string,
  fields: Partial<Task>,
) {
  transport.tasks = transport.tasks.map((task) =>
    task.id === id ? { ...task, ...fields } : task,
  );
}

export const showTab =
  (tab: "activity" | "changes") =>
  async ({ controller }: Mounted) => {
    await act(async () => controller.setTab(tab));
  };

/** A new task arrives in the second project. */
export const addTask = (mounted: Mounted) =>
  refreshWith(mounted, () =>
    mounted.transport.tasks.push(
      listedTask("five", {
        title: "Add rate limits",
        repository: "/repo/b",
        status: "queued",
      }),
    ),
  );

/** The selected task waits for an answer to a question. */
export const askQuestion = (mounted: Mounted) =>
  refreshWith(mounted, () =>
    updateTask(mounted, SELECTED, {
      status: "waiting",
      pending_input: {
        id: "question-1",
        tool: "AskUserQuestion",
        kind: "question",
        input: {
          questions: [
            {
              question: "Which session store should it use?",
              header: "Store",
              multiSelect: false,
              options: [
                { label: "Redis", description: "Shared across hosts" },
                { label: "Memory", description: "One host only" },
              ],
            },
          ],
        },
      },
    }),
  );

/** The selected task waits for permission to run a command. */
export const askPermission = (mounted: Mounted) =>
  refreshWith(mounted, () =>
    updateTask(mounted, SELECTED, {
      status: "waiting",
      pending_input: {
        id: "permission-1",
        tool: "Bash",
        kind: "permission",
        input: { command: "npm test" },
      },
    }),
  );
