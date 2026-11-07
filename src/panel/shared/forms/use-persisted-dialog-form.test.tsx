// @vitest-environment jsdom
import assert from "node:assert/strict";

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import { test } from "vitest";

import { Controller } from "../../app/state/controller";
import { ControllerContext } from "../../app/state/controller-context";
import type { Task, Transport } from "../../app/state/types";
import { usePersistedDialogForm } from "./use-persisted-dialog-form";

function makeTask(): Task {
  return {
    id: "task-1",
    repository: "/repo",
    revision: "HEAD",
    provider: "claude",
    worker_profile: "reviewer",
    title: "Review",
    description: "Review",
    depends_on: [],
    workspace_strategy: "worktree",
    budget: { max_runtime_minutes: 20, max_cost_usd: null },
    owner: "owner",
    status: "running",
    created_at: "",
    updated_at: "",
    created_by: "user",
    instructions_sent: 0,
    pending_steers: [],
    queue: [],
    turn: 1,
    runtime_ms: 0,
  };
}

function DraftForm() {
  const { register } = usePersistedDialogForm("handoff", {
    instruction: "initial value",
  });

  return createElement("input", {
    "aria-label": "Instruction",
    ...register("instruction"),
  });
}

test("shared form hook restores and records values through the controller", (t) => {
  t.onTestFinished(cleanup);

  const transport = {
    embedded: true,
    async connect() {},
    async tool() {
      return undefined;
    },
    watch() {},
    dispose() {},
  } as unknown as Transport;

  const first = new Controller(transport, {
    hidden: () => false,
    wide: () => false,
  });

  t.onTestFinished(() => first.dispose());
  first.open({ kind: "handoff", task: makeTask() });

  let view = render(
    createElement(
      ControllerContext.Provider,
      { value: first },
      createElement(DraftForm),
    ),
  );
  const input = view.getByRole("textbox", { name: "Instruction" });

  act(() => {
    fireEvent.change(input, { target: { value: "edited request" } });
  });

  assert.deepEqual(first.getDialogDraft("handoff"), {
    instruction: "edited request",
  });

  view.unmount();

  const restored = new Controller(
    transport,
    {
      hidden: () => false,
      wide: () => false,
    },
    {
      initial: {
        view: {},
        dialogs: [
          {
            kind: "handoff",
            taskId: "task-1",
            draft: { instruction: "edited request" },
          },
        ],
      },
      save() {},
    },
  );

  t.onTestFinished(() => restored.dispose());
  restored.open({ kind: "handoff", task: makeTask() });

  view = render(
    createElement(
      ControllerContext.Provider,
      { value: restored },
      createElement(DraftForm),
    ),
  );

  assert.equal(
    (view.getByRole("textbox", { name: "Instruction" }) as HTMLInputElement)
      .value,
    "edited request",
  );
});
