// @vitest-environment jsdom
import { expect } from "vitest";

import {
  act,
  assert,
  assertAbsent,
  screen,
  setup,
  test,
  userEvent,
  vi,
  waitFor,
  within,
} from "./react-ui-test-support";

type User = ReturnType<typeof userEvent.setup>;

// Outcome details explain themselves in a hover tooltip, not a native title.
async function hoverTooltip(user: User, element: Element) {
  await user.hover(element);
  const text = (await screen.findByRole("tooltip")).textContent;
  await user.unhover(element);

  return text;
}

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
  await user.type(field, "Edited handoff for this chat");

  await user.click(
    screen.getByRole("button", { name: "Send to conversation" }),
  );

  await waitFor(() =>
    assert.deepEqual(transport.messages, ["Edited handoff for this chat"]),
  );
});

test("completed chat turns show a quiet summary with a completion time on hover", async (t) => {
  // Freeze the calendar without replacing the timers used by async UI interactions.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-09T18:00:00Z"));

  t.onTestFinished(() => {
    vi.useRealTimers();
  });

  const timestamp = "2026-10-08T18:30:00.000Z";

  const { user, controller, transport } = await setup(t, (transport) => {
    transport.tasks[0].status = "completed";
    transport.host.locale = "en-US";
    transport.host.timeZone = "America/Los_Angeles";

    transport.chat = [
      {
        kind: "outcome",
        id: "completed-turn",
        event_id: 1,
        timestamp,
        turn: 1,
        outcome: "completed",
        runtime_ms: 95_000,
        cost_usd: 0,
      },
    ];
  });

  const row = document.querySelector(".chat-outcome")!;
  const label = row.querySelector(".chat-outcome-label")!;
  const duration = row.querySelector("time")!;
  const turn = row.querySelector<HTMLElement>(".chat-outcome-timestamp")!;

  assert.equal(label.tagName, "SPAN");
  assert.equal(label.textContent, "Oct 8, 11:30 AM");

  assertAbsent(
    within(row as HTMLElement).queryByRole("button", { name: "Copy response" }),
  );

  assert.equal(duration.textContent, "1m 35s");
  assert.equal(duration.getAttribute("datetime"), timestamp);

  assert.equal(await hoverTooltip(user, duration), "Responded after 1m 35s");

  assert.equal(
    await hoverTooltip(user, turn),
    "Responded on Oct 8, 2026, 11:30:00 AM",
  );

  expect(row.querySelector(".chat-outcome-line")?.lastElementChild).toBe(
    within(row as HTMLElement).getByRole("button", { name: "View activity" }),
  );

  assert.equal(
    await hoverTooltip(user, within(row as HTMLElement).getByText("$0.00")),
    "Reported cost",
  );

  assertAbsent(within(row as HTMLElement).queryByRole("separator"));

  await act(() =>
    transport.events.host({
      ...transport.host,
      timeZone: "America/New_York",
    }),
  );

  assert.equal(
    await hoverTooltip(user, turn),
    "Responded on Oct 8, 2026, 2:30:00 PM",
  );

  assert.equal(label.textContent, "Oct 8, 2:30 PM");

  assert.equal(await hoverTooltip(user, duration), "Responded after 1m 35s");

  await user.click(screen.getByRole("button", { name: "View activity" }));
  assert.equal(controller.getSnapshot().tab, "activity");
});

for (const outcome of ["failed", "interrupted"] as const)
  test(`${outcome} chat turns retain their status and error beside the compact summary`, async (t) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-09T18:00:00Z"));

    t.onTestFinished(() => {
      vi.useRealTimers();
    });

    const error = outcome === "failed" ? "Worker failed <script>" : undefined;

    const { user } = await setup(t, (transport) => {
      transport.tasks[0].status = outcome;
      transport.host.locale = "en-US";
      transport.host.timeZone = "America/Los_Angeles";

      transport.chat = [
        {
          kind: "outcome",
          id: `${outcome}-turn`,
          event_id: 1,
          timestamp: "2026-10-08T18:30:00.000Z",
          turn: 2,
          outcome,
          runtime_ms: 95_000,
          error,
        },
      ];
    });

    const row = document.querySelector<HTMLElement>(".chat-outcome")!;
    assert.equal(row.dataset.outcome, outcome);

    assert.equal(
      within(row).getByRole("separator").textContent,
      outcome === "failed" ? "Failed" : "Interrupted",
    );

    assert.equal(
      row.querySelector(".chat-outcome-label")?.textContent,
      "Oct 8, 11:30 AM",
    );

    assert.equal(row.querySelector("time")?.textContent, "1m 35s");

    const label = outcome === "failed" ? "Failed" : "Interrupted";

    assert.equal(
      await hoverTooltip(user, row.querySelector("time")!),
      `${label} after 1m 35s`,
    );

    assert.equal(
      await hoverTooltip(user, row.querySelector(".chat-outcome-timestamp")!),
      `${label} on Oct 8, 2026, 11:30:00 AM`,
    );

    assert.equal(row.querySelector(".chat-outcome-error")?.textContent, error);
    assertAbsent(row.querySelector("script"));
    assertAbsent(row.querySelector('[aria-label^="Reported cost"]'));
    assert.ok(within(row).getByRole("button", { name: "View activity" }));
  });

test("task and reply text render literally without HTML interpretation", async (t) => {
  const injection = '<img src=x onerror="window.injected=true">';

  const { user } = await setup(t, (transport) => {
    transport.tasks[0].title = injection;

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
          text: "<script>window.injected=true</script>",
        },
      },
    ];
  });

  assert.equal(
    screen.getByRole("heading", { level: 1 }).textContent,
    injection,
  );

  await user.click(screen.getByRole("tab", { name: "Chat" }));

  assert.equal(
    document.querySelector(".chat-worker-text")?.textContent,
    "<script>window.injected=true</script>",
  );

  expect(document.querySelector("img, script")).toBeNull();
  assert.equal((window as any).injected, undefined);
});
