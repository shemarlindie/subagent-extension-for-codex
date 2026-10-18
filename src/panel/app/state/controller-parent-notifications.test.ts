import { expect, onTestFinished, test, vi } from "vitest";

import { deferred, flush, setup } from "./controller-test-harness";
import type { PanelData, Transport } from "./types";

const parentNotification = {
  task_id: "worker",
  attempt_id: 2,
  message_id: "parent_1",
  conversation_id: "parent-chat",
  text: "Delegated worker message available. Message ID: parent_1.",
};

/** Answers the first claim with `message`; the queue is empty after it. */
function claimOnce(message: unknown = parentNotification) {
  let claimed = false;

  return () => {
    if (claimed) return null;
    claimed = true;

    return message;
  };
}

test.each([
  {
    label: "supported visible scoped host",
    embedded: true,
    conversation: "parent-chat",
    canSendParent: true,
    expected: true,
  },
  {
    label: "standalone browser",
    embedded: false,
    conversation: "parent-chat",
    canSendParent: true,
    expected: false,
  },
  {
    label: "global scope",
    embedded: true,
    conversation: null,
    canSendParent: true,
    expected: false,
  },
  {
    label: "host without parent routing",
    embedded: true,
    conversation: "parent-chat",
    canSendParent: false,
    expected: false,
  },
])(
  "controller relays parent notifications only in eligible state: $label",
  async (state) => {
    const { controller, transport } = setup();
    onTestFinished(() => controller.dispose());
    transport.embedded = state.embedded;

    transport.send = vi
      .fn<NonNullable<Transport["send"]>>()
      .mockResolvedValue(undefined);

    transport.context = {
      panel_scope: { conversation_id: state.conversation },
    };

    const claim = claimOnce();

    transport.handler = (name) => {
      if (name === "app_claim_parent_message") return claim();
      if (name === "app_record_parent_delivery") return {};

      return undefined;
    };

    await controller.start();

    transport.events.host({
      ...controller.getSnapshot().host,
      canSendParent: state.canSendParent,
    });

    await controller.refresh();
    await flush();

    const claimed = transport.calls.some(
      (call) => call.name === "app_claim_parent_message",
    );

    expect(claimed).toBe(state.expected);

    if (state.expected) {
      expect(transport.send).toHaveBeenCalledExactlyOnceWith(
        parentNotification.text,
        { submit: true },
      );
    } else {
      expect(transport.send).not.toHaveBeenCalled();
    }
  },
);

test.each([
  "scope change",
  "disposal",
  "hidden panel",
  "parent routing disabled",
])(
  "controller handles pending parent notification delivery after %s",
  async (change) => {
    const { controller, transport, environment } = setup();
    onTestFinished(() => controller.dispose());
    transport.context = { panel_scope: { conversation_id: "parent-chat" } };

    transport.send = vi
      .fn<NonNullable<Transport["send"]>>()
      .mockResolvedValue(undefined);

    await controller.start();

    transport.events.host({
      ...controller.getSnapshot().host,
      canSendParent: true,
    });

    const claim = deferred<typeof parentNotification>();
    const claimPending = claimOnce(claim.promise);

    transport.handler = (name) => {
      if (name === "app_claim_parent_message") return claimPending();
      if (name === "app_record_parent_delivery") return {};

      return undefined;
    };

    await controller.refresh();

    expect(
      transport.calls.filter(
        (call) => call.name === "app_claim_parent_message",
      ),
    ).toHaveLength(1);

    if (change === "scope change") {
      controller.applyScope(
        { panel_scope: { conversation_id: "other-chat" } },
        false,
      );
    } else if (change === "disposal") {
      controller.dispose();
    } else if (change === "hidden panel") {
      environment.hidden = () => true;
    } else {
      transport.events.host({
        ...controller.getSnapshot().host,
        canSendParent: false,
      });
    }

    claim.resolve(parentNotification);
    await flush();

    const delivered = change === "hidden panel";
    expect(transport.send).toHaveBeenCalledTimes(delivered ? 1 : 0);

    expect(transport.calls).toContainEqual({
      name: "app_record_parent_delivery",
      args: {
        task_id: "worker",
        attempt_id: 2,
        conversation_id: "parent-chat",
        delivered,
        ...(delivered
          ? {}
          : { error: "Panel parent conversation changed before delivery" }),
      },
    });
  },
);

test("controller waits for known conversation scope before claiming parent notifications", async () => {
  const { controller, transport } = setup();
  onTestFinished(() => controller.dispose());

  transport.send = vi
    .fn<NonNullable<Transport["send"]>>()
    .mockResolvedValue(undefined);

  const context = deferred<PanelData>();

  const claim = claimOnce();

  transport.handler = (name) => {
    if (name === "get_agent_panel_context") return context.promise;
    if (name === "app_claim_parent_message") return claim();
    if (name === "app_record_parent_delivery") return {};

    return undefined;
  };

  const starting = controller.start();
  await flush();

  transport.events.host({
    ...controller.getSnapshot().host,
    canSendParent: true,
  });

  await controller.refresh();
  expect(controller.getSnapshot().scopeKnown).toBe(false);

  expect(
    transport.calls.some((call) => call.name === "app_claim_parent_message"),
  ).toBe(false);

  expect(transport.send).not.toHaveBeenCalled();
  context.resolve({ panel_scope: { conversation_id: "parent-chat" } });
  await starting;
  await flush();
  await controller.refresh();
  await flush();

  expect(transport.send).toHaveBeenCalledWith(parentNotification.text, {
    submit: true,
  });
});

test("the fallback refresh still delivers parent messages while a hidden panel's reads are paused", async (t) => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  t.onTestFinished(() => {
    vi.useRealTimers();
  });

  const { controller, transport, environment } = setup();
  t.onTestFinished(() => controller.dispose());
  transport.context = { panel_scope: { conversation_id: "parent-chat" } };

  transport.send = vi
    .fn<NonNullable<Transport["send"]>>()
    .mockResolvedValue(undefined);

  const claim = claimOnce();

  transport.handler = (name) => {
    if (name === "app_claim_parent_message") return claim();
    if (name === "app_record_parent_delivery") return {};

    return undefined;
  };

  await controller.start();

  transport.events.host({
    ...controller.getSnapshot().host,
    canSendParent: true,
  });

  environment.hidden = () => true;

  const listReads = transport.calls.filter(
    (call) => call.name === "list_agent_tasks",
  ).length;

  vi.advanceTimersByTime(30000);
  await flush();

  expect(transport.send).toHaveBeenCalledExactlyOnceWith(
    parentNotification.text,
    { submit: true },
  );

  expect(
    transport.calls.filter((call) => call.name === "list_agent_tasks"),
  ).toHaveLength(listReads);
});
