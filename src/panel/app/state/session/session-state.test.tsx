// @vitest-environment jsdom
import assert from "node:assert/strict";

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, test, vi } from "vitest";

import type { Controller } from "../controller";
import { ControllerContext } from "../controller-context";
import type { QuestionDraft } from "../types";
import { SessionStateStore } from "./session-state";
import { useSessionState } from "./use-session-state";

afterEach(cleanup);

const questionDraft: QuestionDraft = {
  values: { answers: { "0": "YAML" }, custom: {} },
  skipped: [],
  active: 0,
};

test("subscriptions notify only meaningful updates to their own entry", () => {
  const session = new SessionStateStore();
  const changed = vi.fn();
  const unsubscribe = session.subscribe("task", "a", changed);
  const original = session.get("task", "a");
  session.update("task", "a", { composerDraft: "" });
  session.update("question", "a", { draft: questionDraft });
  session.update("task", "b", { tab: "details" });

  assert.equal(changed.mock.calls.length, 0);
  assert.equal(session.get("task", "a"), original);
  session.update("task", "a", { composerDraft: "draft" });

  assert.equal(changed.mock.calls.length, 1);
  assert.notEqual(session.get("task", "a"), original);
  unsubscribe();
  session.update("task", "a", { tab: "details" });

  assert.equal(changed.mock.calls.length, 1);
});

test("removing state resets defaults and preserves active subscriptions", () => {
  const session = new SessionStateStore();
  const changed = vi.fn();
  const unsubscribe = session.subscribe("question", "request", changed);
  session.update("question", "request", { draft: questionDraft });
  session.remove("question", "request");

  assert.deepEqual(session.get("question", "request"), {});
  session.update("question", "request", { draft: questionDraft });

  assert.equal(changed.mock.calls.length, 3);
  unsubscribe();
  session.remove("question", "request");

  assert.deepEqual(session.get("question", "request"), {});
});

test("draft and tab updates preserve stable scroll cells without scroll notifications", () => {
  const session = new SessionStateStore();
  const reading = session.get("task", "a").reading;
  const changed = vi.fn();
  session.subscribe("task", "a", changed);
  reading.chat.position = { top: 120, pinned: false };

  assert.equal(changed.mock.calls.length, 0);
  session.update("task", "a", { tab: "changes", composerDraft: "draft" });

  assert.equal(session.get("task", "a").reading, reading);
  assert.deepEqual(reading.chat.position, { top: 120, pinned: false });
  assert.deepEqual(reading.activity, {});
  assert.deepEqual(session.get("task", "b").reading.chat, {});
  assert.deepEqual(new SessionStateStore().get("task", "a").reading.chat, {});
});

type DraftEditorProps = { id: string; rendered: () => void };

function DraftEditor({ id, rendered }: DraftEditorProps) {
  const [draft, update] = useSessionState(
    "task",
    id,
    (state) => state.composerDraft,
  );

  rendered();

  return (
    <input
      aria-label="Draft"
      value={draft}
      onChange={(event) => update({ composerDraft: event.target.value })}
    />
  );
}

test("the hook isolates field renders and switches subscriptions and updates with the identifier", () => {
  const session = new SessionStateStore();
  const controller = { session } as Controller;
  const rendered = vi.fn();

  const editor = (id: string) => (
    <ControllerContext.Provider value={controller}>
      <DraftEditor id={id} rendered={rendered} />
    </ControllerContext.Provider>
  );

  const view = render(editor("a"));
  const input = () => view.getByLabelText("Draft") as HTMLInputElement;
  const initialRenders = rendered.mock.calls.length;
  act(() => session.update("task", "a", { tab: "activity" }));

  assert.equal(rendered.mock.calls.length, initialRenders);
  fireEvent.change(input(), { target: { value: "draft a" } });

  assert.equal(session.get("task", "a").composerDraft, "draft a");
  act(() => session.update("task", "b", { composerDraft: "draft b" }));
  view.rerender(editor("b"));

  assert.equal(input().value, "draft b");
  const switchedRenders = rendered.mock.calls.length;
  act(() => session.update("task", "a", { composerDraft: "changed a" }));

  assert.equal(rendered.mock.calls.length, switchedRenders);
  fireEvent.change(input(), { target: { value: "changed b" } });

  assert.equal(session.get("task", "b").composerDraft, "changed b");
  view.unmount();
  const restored = render(editor("a"));

  assert.equal(
    (restored.getByLabelText("Draft") as HTMLInputElement).value,
    "changed a",
  );
});
