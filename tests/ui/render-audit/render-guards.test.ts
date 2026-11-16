// @vitest-environment jsdom
// The recorder must load before React DOM. Import sorting keeps a side-effect
// import in place.
import "./render-recorder";

import { expect, test, type TestContext } from "vitest";

import { mountBase } from "./base-state";
import { recordRenders, type Render } from "./render-recorder";
import { scenario } from "./render-scenarios/index";
import { runScenario } from "./render-scenarios/scenario";

// Each guard protects one render isolation result. Guards name components as
// React does, by their function: `GroupCard` is `ActivityGroupCard`'s inner
// component. A check that a component didn't render pairs with one that the
// changed component did, so a rename fails instead of passing.

type Filter = { mount?: boolean; within?: string };

/** Renders of `name`, updates unless `mount`, optionally inside `within`. */
function renders(
  all: Render[],
  name: string,
  { mount = false, within }: Filter = {},
) {
  return all.filter(
    (render) =>
      render.name === name &&
      render.mount === mount &&
      (!within || render.path.includes(within)),
  );
}

const run = (t: TestContext, label: string) => runScenario(t, scenario(label));

test("the guarded components mount in the base state", async (t) => {
  const recording = recordRenders();
  await mountBase(t);
  const mounted = new Set(recording.stop().renders.map(({ name }) => name));

  for (const name of [
    "AppShell",
    "PageOutlet",
    "EvidenceTabs",
    "ChatPanel",
    "MessageQueue",
    "TaskRow",
    "TaskFilters",
    "ChatTimeline",
    "ChatMessageView",
    "TurnOutcomeRow",
    "ChatNoteRow",
    "MarkdownView",
    "MarkdownPart",
    "GroupCard",
  ]) {
    expect(mounted, name).toContain(name);
  }
});

test("an idle refresh with unchanged data commits and notifies nothing", async (t) => {
  // A conversation's panel also reads pending updates.
  for (const label of [
    "Idle refresh with unchanged data",
    "Idle refresh with unchanged data (scoped)",
  ]) {
    const result = await run(t, label);

    expect(result.commits, label).toBe(0);
    expect(result.notifications, label).toBe(0);
  }
});

test("a streamed delta inside a paragraph commits nothing", async (t) => {
  const result = await run(t, "A streamed delta inside a paragraph");

  expect(result.commits).toBe(0);
});

test("a streamed delta that finishes a paragraph renders only the streaming message", async (t) => {
  const result = await run(t, "A streamed delta that finishes a paragraph");
  const updated = result.renders.filter(({ mount }) => !mount);

  expect(updated.map(({ name }) => name).sort()).toEqual([
    "ChatMessageView",
    "ChatTimeline",
    "LoadingSwap",
    "MarkdownView",
  ]);

  expect(renders(result.renders, "MarkdownPart", { mount: true })).toHaveLength(
    1,
  );
});

test("one task's status change renders only its row", async (t) => {
  const result = await run(t, "Another task's status changes");

  expect(renders(result.renders, "TaskRow")).toHaveLength(1);
});

test("storing a Chat message renders no other timeline row", async (t) => {
  const result = await run(t, "A Chat message is stored");
  const within = "ChatTimeline";

  expect(
    renders(result.renders, "ChatMessageView", { mount: true, within }),
  ).toHaveLength(1);

  for (const name of ["ChatMessageView", "TurnOutcomeRow", "ChatNoteRow"]) {
    expect(renders(result.renders, name, { within }), name).toEqual([]);
  }
});

test("Chat and Activity updates leave Chat's panel alone", async (t) => {
  for (const label of [
    "A Chat message is stored",
    "Activity events append with Chat shown",
  ]) {
    const result = await run(t, label);

    expect(renders(result.renders, "EvidenceTabs"), label).not.toEqual([]);
    expect(renders(result.renders, "ChatPanel"), label).toEqual([]);
  }
});

test("unread and host changes leave the shell's pages alone", async (t) => {
  // The unread count sets the page title without rendering the shell.
  const unread = await run(t, "A task becomes unread");

  expect(renders(unread.renders, "TaskRow")).toHaveLength(1);
  expect(renders(unread.renders, "AppShell")).toEqual([]);

  const host = await run(t, "The host's state changes");

  expect(renders(host.renders, "AppShell")).toHaveLength(1);
  expect(renders(host.renders, "PageOutlet")).toEqual([]);
});

test("the selected task's runtime change renders no Chat message or queue", async (t) => {
  const result = await run(t, "The selected task's runtime changes");

  expect(renders(result.renders, "ChatTimeline")).not.toEqual([]);

  expect(
    renders(result.renders, "ChatMessageView", { within: "ChatTimeline" }),
  ).toEqual([]);

  expect(renders(result.renders, "MessageQueue")).toEqual([]);
});

test("a keystroke in a composer draft leaves the composer alone", async (t) => {
  const task = await run(t, "A keystroke in the task composer");
  const menu = renders(task.renders, "CommandMenu");

  expect(menu).not.toEqual([]);
  expect(menu.filter(({ wasted }) => wasted)).toEqual([]);
  expect(renders(task.renders, "Composer")).toEqual([]);

  const newTask = await run(t, "A keystroke in the new-task composer");

  expect(renders(newTask.renders, "NewTaskRow")).not.toEqual([]);
  expect(renders(newTask.renders, "NewTaskComposer")).toEqual([]);
});

test("checking an archived task renders only its row", async (t) => {
  const result = await run(t, "Check an archived task");

  expect(renders(result.renders, "ArchivedTaskRow")).toHaveLength(1);
});

test("marking one changed file viewed renders only its section", async (t) => {
  const result = await run(t, "Mark a changed file viewed");

  expect(renders(result.renders, "ChangedFileSection")).toHaveLength(1);
});

test("appending Activity events renders only the cards whose groups changed", async (t) => {
  const result = await run(t, "Activity events append with Activity shown");
  const cards = renders(result.renders, "GroupCard");

  expect(cards).not.toEqual([]);
  expect(cards.filter(({ wasted }) => wasted)).toEqual([]);
});

test("the selected task's status and runtime each render one Activity card", async (t) => {
  // The status ends the thinking row. The runtime shows on the completion row.
  for (const label of [
    "The selected task's status changes",
    "The selected task's runtime changes",
  ]) {
    const result = await run(t, label);

    expect(renders(result.renders, "GroupCard"), label).toHaveLength(1);
  }
});

test("another task's runtime change keeps the filters from rendering", async (t) => {
  const result = await run(t, "Another task's runtime changes");

  expect(renders(result.renders, "TaskRow")).toHaveLength(1);
  expect(renders(result.renders, "TaskFilters")).toEqual([]);
});

test("storing a streamed reply renders only its new part and remounts nothing", async (t) => {
  const result = await run(t, "A streamed reply is stored");
  const within = "ChatTimeline";

  expect(
    renders(result.renders, "MarkdownPart", { mount: true, within }),
  ).toHaveLength(1);

  expect(renders(result.renders, "MarkdownPart", { within })).toEqual([]);
  expect(result.remounts).toEqual([]);
});
