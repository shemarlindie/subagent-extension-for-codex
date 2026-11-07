// @vitest-environment jsdom
import { expect } from "vitest";

import { decodedEvent } from "../../src/shared/events/decode.js";
import {
  act,
  assert,
  assertAbsent,
  pasteText,
  screen,
  setup,
  test,
  vi,
  waitFor,
  within,
} from "./panel-test-support";

test("handoff sends only after explicit submit and uses the edited message", async (t) => {
  const { controller, transport, user } = await setup(t);

  await act(async () =>
    transport.events.host({
      canSend: true,
      canShare: false,
      canExpand: false,
      displayMode: "fullscreen",
    }),
  );

  assertAbsent(screen.queryByRole("button", { name: "Bring to Codex" }));
  await user.click(screen.getByRole("button", { name: "Task actions" }));

  await user.click(
    await screen.findByRole("menuitem", { name: "Bring to Codex" }),
  );

  await screen.findByRole("dialog");

  await waitFor(() =>
    expect(
      document.activeElement,
      "Handoff dialog should focus its message field",
    ).toBe(document.getElementById("handoff-message")),
  );

  assert.deepEqual(transport.messages, []);
  await act(() => controller.refresh());
  assert.deepEqual(transport.messages, []);
  const field = document.getElementById("handoff-message")!;
  await user.clear(field);
  await pasteText(user, field, "Edited handoff for this chat");

  await user.click(
    screen.getByRole("button", { name: "Send to conversation" }),
  );

  await waitFor(() =>
    assert.deepEqual(transport.messages, ["Edited handoff for this chat"]),
  );
});

test("Ask Codex about an older reply prepares that reply and sends only the edited draft", async (t) => {
  const { controller, transport, user } = await setup(
    t,
    (transport) => {
      transport.host.canSend = true;
      transport.host.canShare = false;

      const [current] = transport.tasks;

      assert.ok(current);

      current.reply = {
        text: "Latest reply is unrelated to the selected reply.",
      } as (typeof transport.tasks)[0]["reply"];

      transport.chat = [
        {
          kind: "message",
          id: "older-reply",
          event_id: 1,
          message: {
            id: "older-reply",
            event_id: 1,
            timestamp: "",
            turn: 1,
            from: "worker",
            kind: "reply",
            text: "Earlier reply about the authentication bug.",
          },
        },
      ];
    },
    { conversation: "thread-one" },
  );

  await user.click(
    screen.getByRole("button", { name: "Ask Codex about this reply" }),
  );

  const dialog = await screen.findByRole("dialog", {
    name: "Ask Codex about this reply",
  });

  const field = within(dialog).getByRole<HTMLTextAreaElement>("textbox", {
    name: "Message",
  });

  expect(field.value).toContain("older-reply");
  expect(field.value).toContain("Earlier reply about the authentication bug.");
  expect(field.value).not.toContain("Latest reply is unrelated");
  expect(field.value).toContain("/repo/a");
  expect(field.value).toContain("list_messages");
  expect(transport.messages).toEqual([]);
  const sharedBeforeRefresh = [...transport.shared];
  await act(() => controller.refresh());
  expect(transport.messages).toEqual([]);
  expect(transport.shared).toEqual(sharedBeforeRefresh);

  await user.clear(field);
  await pasteText(user, field, "Explain the earlier authentication finding.");

  await user.click(
    within(dialog).getByRole("button", {
      name: "Send to conversation",
    }),
  );

  await waitFor(() =>
    expect(transport.messages).toEqual([
      "Explain the earlier authentication finding.",
    ]),
  );
});

test("closing a reply handoff sends nothing and hosts without message support can prepare it", async (t) => {
  const { transport, user } = await setup(
    t,
    (transport) => {
      transport.chat = [
        {
          kind: "message",
          id: "reply",
          event_id: 1,
          message: {
            id: "reply",
            event_id: 1,
            timestamp: "",
            turn: 1,
            from: "worker",
            kind: "reply",
            text: "A reply to ask about.",
          },
        },
      ];
    },
    { conversation: "thread-one" },
  );

  const sharedBeforeClick = [...transport.shared];

  await user.click(
    screen.getByRole("button", {
      name: "Ask Codex about this reply",
    }),
  );

  const dialog = await screen.findByRole("dialog", {
    name: "Ask Codex about this reply",
  });

  expect(
    within(dialog).queryByRole("button", {
      name: "Send to conversation",
    }),
  ).toBeNull();

  expect(
    within(dialog).getByRole<HTMLTextAreaElement>("textbox", {
      name: "Message",
    }).value,
  ).toContain("A reply to ask about.");

  const [close] = within(dialog).getAllByRole("button", { name: "Close" });

  assert.ok(close);
  await user.click(close);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(transport.messages).toEqual([]);
  expect(transport.shared).toEqual(sharedBeforeClick);
});

test("a standalone reply handoff copies the edited message without sending", async (t) => {
  const { transport, user } = await setup(
    t,
    (transport) => {
      transport.embedded = false;

      transport.chat = [
        {
          kind: "message",
          id: "reply",
          event_id: 1,
          message: {
            id: "reply",
            event_id: 1,
            timestamp: "",
            turn: 1,
            from: "worker",
            kind: "reply",
            text: "Copy this reply's context.",
          },
        },
      ];
    },
    { conversation: "thread-one" },
  );

  const writeText = vi.spyOn(navigator.clipboard, "writeText");
  t.onTestFinished(() => writeText.mockRestore());

  await user.click(
    screen.getByRole("button", {
      name: "Ask Codex about this reply",
    }),
  );

  const dialog = await screen.findByRole("dialog", {
    name: "Ask Codex about this reply",
  });

  const field = within(dialog).getByRole("textbox", { name: "Message" });
  await user.clear(field);
  await pasteText(user, field, "Copied question for Codex.");

  await user.click(
    within(dialog).getByRole("button", { name: "Copy message" }),
  );

  await waitFor(() =>
    expect(writeText).toHaveBeenCalledWith("Copied question for Codex."),
  );

  expect(transport.messages).toEqual([]);
});

test("View activity scrolls to a recent turn and reads an older one on its own", async (t) => {
  const { controller, transport, user } = await setup(t, (transport) => {
    const events: ReturnType<typeof decodedEvent>[] = [];

    const add = (type: string, data: Record<string, unknown> = {}) =>
      events.push(
        decodedEvent({
          id: events.length + 1,
          task_id: "one",
          timestamp: "2026-10-08T18:30:00.000Z",
          type,
          data,
        }),
      );

    // Cross the event window with grouped progress updates. This checks turn
    // navigation without rendering hundreds of unrelated message cards.
    const turns: [turn: number, count: number][] = [
      [1, 197],
      [2, 1],
    ];

    for (const [turn, count] of turns) {
      add("task.started", { turn });

      for (let i = 0; i < count; i++) {
        add("agent.thinking_tokens", { tokens: i + 1 });
      }

      add("agent.message", { role: "assistant", text: `turn ${turn}` });

      add("task.turn_ended", {
        turn,
        outcome: "completed",
        runtime_ms: 1000,
        cost_usd: 0,
      });

      add("task.completed");
    }

    transport.taskEvents = events as unknown as Record<string, unknown>[];

    transport.chat = [1, 2].map((turn) => ({
      kind: "outcome",
      id: `turn-${turn}`,
      event_id: turn === 1 ? 201 : 206,
      timestamp: "2026-10-08T18:30:00.000Z",
      turn,
      outcome: "completed",
      runtime_ms: 1000,
      cost_usd: 0,
    }));
  });

  const [first, second] = screen.getAllByRole("button", {
    name: "View activity",
  });

  assert.ok(first && second);
  await user.click(second);
  assert.equal(controller.getSnapshot().tab, "activity");
  assertAbsent(screen.queryByText(/Showing activity for/));

  assert.equal(
    transport.calls.some((call) => call.name === "app_get_turn_activity"),
    false,
  );

  await user.click(screen.getByRole("tab", { name: "Chat" }));
  await user.click(first);

  assert.ok(await screen.findByText("Showing activity for"));

  assert.deepEqual(
    transport.calls.find((call) => call.name === "app_get_turn_activity")?.args,
    { task_id: "one", turn: 1 },
  );

  assert.ok(screen.getByText("turn 1", { selector: "strong" }));

  assert.ok(
    screen.getByText(/Showing the last 200 events of turn 1\./),
    "A turn longer than the window says it is trimmed",
  );

  await user.click(
    screen.getByRole("button", { name: "Show latest activity" }),
  );

  assertAbsent(screen.queryByText(/Showing activity for/));
  assert.ok(screen.getByText(/Showing the most recent 200 events\./));
});

test("global mode hides Ask Codex about this reply even when the host can send", async (t) => {
  const { user } = await setup(t, (transport) => {
    transport.host.canSend = true;

    transport.chat = [
      {
        kind: "message",
        id: "reply",
        event_id: 1,
        message: {
          id: "reply",
          event_id: 1,
          timestamp: "",
          turn: 1,
          from: "worker",
          kind: "reply",
          text: "A global reply.",
        },
      },
    ];
  });

  expect(screen.getByText("A global reply.")).toBeTruthy();

  expect(
    screen.queryByRole("button", { name: "Ask Codex about this reply" }),
  ).toBeNull();

  await user.click(screen.getByRole("button", { name: "Task actions" }));

  expect(
    await screen.findByRole("menuitem", { name: "Bring to Codex" }),
  ).toBeTruthy();
});

test("pending worker updates send only the checked ones and stay counted until Codex reads them", async (t) => {
  const reply = (event_id: number, text: string) => ({
    event_id,
    kind: "reply" as const,
    text,
    timestamp: "2026-10-02T03:00:00Z",
  });

  const { transport, user } = await setup(
    t,
    (transport) => {
      transport.host.canSend = true;

      transport.pendingUpdates = [
        {
          task_id: "upload",
          title: "Limit upload sizes",
          updates: [
            reply(12, "Newest upload reply."),
            reply(7, "Older upload reply."),
          ],
        },
        {
          task_id: "loader",
          title: "Migrate the config loader",
          updates: [
            {
              event_id: 9,
              kind: "request",
              text: "Which format\nshould it support?",
              timestamp: "2026-10-02T02:00:00Z",
            },
          ],
        },
      ];
    },
    { conversation: "parent-chat" },
  );

  const label = "3 pending worker updates";
  await user.click(await screen.findByRole("button", { name: label }));
  const dialog = within(await screen.findByRole("dialog"));
  const upload = document.querySelector<HTMLElement>('[data-task="upload"]')!;
  const loader = document.querySelector<HTMLElement>('[data-task="loader"]')!;
  const [uploadTask, , older] = within(upload).getAllByRole("checkbox");
  // A task's only update has no checkbox of its own.
  const [loaderTask, ...loaderRest] = within(loader).getAllByRole("checkbox");
  assert.deepEqual(loaderRest, []);
  const markSeen = dialog.getByRole("button", { name: "Mark seen" });
  const send = dialog.getByRole("button", { name: "Send to Codex" });

  await user.click(older!);
  assert.equal(uploadTask!.getAttribute("aria-checked"), "mixed");

  // From partial, the task checkbox checks every update, then clears them.
  await user.click(uploadTask!);
  await user.click(uploadTask!);
  await user.click(loaderTask!);
  assert.equal(markSeen.hasAttribute("disabled"), true);
  assert.equal(send.hasAttribute("disabled"), true);

  await user.click(uploadTask!);
  await user.click(older!);
  await user.click(loaderTask!);
  await user.click(send);
  await waitFor(() => assertAbsent(screen.queryByRole("dialog")));

  assert.equal(transport.messages.length, 1);
  const [message] = transport.messages;
  expect(message).toContain('task_id="upload", after=11');
  expect(message).toContain("Newest upload reply.");
  expect(message).not.toContain("Older upload reply.");
  expect(message).toContain('task_id="loader", after=8');
  expect(message).toContain("Which format should it support?");

  // Sending leaves them counted until Codex reads them.
  assert.ok(screen.getByRole("button", { name: label }));

  assert.ok(
    !transport.calls.some((call) => call.name === "app_mark_updates_seen"),
  );
});
