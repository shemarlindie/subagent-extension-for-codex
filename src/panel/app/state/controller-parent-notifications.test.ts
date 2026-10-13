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

test.each([
  {
    label: "supported visible scoped host",
    embedded: true,
    conversation: "parent-chat",
    canSendParent: true,
    hidden: false,
    expected: true,
  },
  {
    label: "standalone browser",
    embedded: false,
    conversation: "parent-chat",
    canSendParent: true,
    hidden: false,
    expected: false,
  },
  {
    label: "global scope",
    embedded: true,
    conversation: null,
    canSendParent: true,
    hidden: false,
    expected: false,
  },
  {
    label: "host without parent routing",
    embedded: true,
    conversation: "parent-chat",
    canSendParent: false,
    hidden: false,
    expected: false,
  },
  {
    label: "hidden panel",
    embedded: true,
    conversation: "parent-chat",
    canSendParent: true,
    hidden: true,
    expected: true,
  },
])(
  "controller relays parent notifications only in eligible state: $label",
  async (state) => {
    const { controller, transport, environment } = setup();
    onTestFinished(() => controller.dispose());
    transport.embedded = state.embedded;

    transport.send = vi
      .fn<NonNullable<Transport["send"]>>()
      .mockResolvedValue(undefined);

    transport.context = {
      panel_scope: { conversation_id: state.conversation },
    };

    environment.hidden = () => state.hidden;

    transport.handler = (name) => {
      if (name === "claim_user_agent_parent_message") return parentNotification;
      if (name === "record_user_agent_parent_delivery") return {};

      return undefined;
    };

    await controller.start();

    transport.events.host({
      ...controller.getSnapshot().host,
      canSendParent: state.canSendParent,
    });

    await controller.refresh();
    await flush();

    const claims = transport.calls.filter(
      (call) => call.name === "claim_user_agent_parent_message",
    );

    expect(claims).toEqual(
      state.expected
        ? [
            {
              name: "claim_user_agent_parent_message",
              args: { conversation_id: "parent-chat" },
            },
          ]
        : [],
    );

    expect(transport.send).toHaveBeenCalledTimes(state.expected ? 1 : 0);

    if (state.expected) {
      expect(transport.send).toHaveBeenCalledWith(parentNotification.text, {
        submit: true,
      });

      expect(transport.calls).toContainEqual({
        name: "record_user_agent_parent_delivery",
        args: {
          task_id: "worker",
          attempt_id: 2,
          conversation_id: "parent-chat",
          delivered: true,
        },
      });
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

    transport.handler = (name) => {
      if (name === "claim_user_agent_parent_message") return claim.promise;
      if (name === "record_user_agent_parent_delivery") return {};

      return undefined;
    };

    await controller.refresh();

    expect(
      transport.calls.filter(
        (call) => call.name === "claim_user_agent_parent_message",
      ),
    ).toHaveLength(1);

    if (change === "scope change")
      controller.applyScope(
        { panel_scope: { conversation_id: "other-chat" } },
        false,
      );
    else if (change === "disposal") controller.dispose();
    else if (change === "hidden panel") environment.hidden = () => true;
    else
      transport.events.host({
        ...controller.getSnapshot().host,
        canSendParent: false,
      });
    claim.resolve(parentNotification);
    await flush();

    const delivered = change === "hidden panel";
    expect(transport.send).toHaveBeenCalledTimes(delivered ? 1 : 0);

    expect(transport.calls).toContainEqual({
      name: "record_user_agent_parent_delivery",
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

  transport.handler = (name) => {
    if (name === "get_agent_panel_context") return context.promise;
    if (name === "claim_user_agent_parent_message") return parentNotification;
    if (name === "record_user_agent_parent_delivery") return {};

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
    transport.calls.some(
      (call) => call.name === "claim_user_agent_parent_message",
    ),
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

test("scheduled parent delivery continues while hidden UI polling is paused", async (t) => {
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

  transport.handler = (name) => {
    if (name === "claim_user_agent_parent_message") return parentNotification;
    if (name === "record_user_agent_parent_delivery") return {};

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

  vi.advanceTimersByTime(5000);
  await flush();

  expect(transport.send).toHaveBeenCalledExactlyOnceWith(
    parentNotification.text,
    { submit: true },
  );

  expect(
    transport.calls.filter((call) => call.name === "list_agent_tasks"),
  ).toHaveLength(listReads);
});
