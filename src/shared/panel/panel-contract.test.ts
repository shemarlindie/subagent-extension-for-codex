import { expect, expectTypeOf, test } from "vitest";
import { z } from "zod";

import { panelOutputSchema } from "./panel-contract.generated.js";
import type { PanelOutput } from "./panel-contract.js";

test("generated output type matches the panel contract", () => {
  expectTypeOf<
    z.output<typeof panelOutputSchema>
  >().toEqualTypeOf<PanelOutput>();
});

test("accepts optional and nullable panel fields", () => {
  for (const input of [
    { panel_scope: { conversation_id: null } },
    { conversation_id: null, panel_scope: { conversation_id: null } },
    {
      conversation_id: "chat-1",
      panel_scope: {
        conversation_id: "chat-1",
        repository: "/repo",
        revision: "main",
      },
    },
    {
      panel_scope: { conversation_id: "chat-1" },
      panel_project_candidate: { repository: "/repo", auto_register: true },
      panel_selection: { task_id: "task-1", tab: "chat" },
      tasks: [{ id: "task-1", custom: { nested: [1, null, true] } }, {}],
    },
  ]) {
    expect(panelOutputSchema.parse(input), JSON.stringify(input)).toEqual(
      input,
    );
  }
});

test("strips unknown panel fields while retaining arbitrary task records", () => {
  const output: PanelOutput = {
    conversation_id: "chat-1",
    panel_scope: {
      conversation_id: "chat-1",
      repository: "/repo",
      revision: "main",
    },
    panel_project_candidate: { repository: "/repo", auto_register: false },
    panel_selection: { task_id: "task-1", tab: "chat" },
    tasks: [{ arbitrary: { extra: true }, status: "running", future: [1, 2] }],
  };

  expect(
    panelOutputSchema.parse({
      ...output,
      extra: true,
      panel_scope: { ...output.panel_scope, extra: true },
      panel_project_candidate: {
        ...output.panel_project_candidate,
        extra: true,
      },
      panel_selection: { ...output.panel_selection, extra: true },
    }),
  ).toEqual(output);
});

test("rejects malformed panel output", () => {
  for (const input of [
    {},
    { panel_scope: {} },
    { panel_scope: { conversation_id: 1 } },
    { panel_scope: { conversation_id: null, repository: null } },
    { panel_scope: { conversation_id: null }, conversation_id: false },
    {
      panel_scope: { conversation_id: null },
      panel_project_candidate: { repository: "/repo" },
    },
    {
      panel_scope: { conversation_id: null },
      panel_selection: { task_id: "task-1", tab: "activity" },
    },
    { panel_scope: { conversation_id: null }, tasks: [null] },
    { panel_scope: { conversation_id: null }, tasks: ["task-1"] },
  ]) {
    expect(
      panelOutputSchema.safeParse(input).success,
      JSON.stringify(input),
    ).toBe(false);
  }
});
