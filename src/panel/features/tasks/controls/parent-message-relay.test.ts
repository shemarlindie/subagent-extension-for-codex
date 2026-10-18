import { assert, expect, test, vi } from "vitest";

import type { ParentMessageNotification } from "../../../../shared/tasks/conversation/messages";
import type { Transport } from "../../../transports/types";
import { ParentMessageRelay } from "./parent-message-relay";

const message = {
  task_id: "worker",
  attempt_id: 2,
  message_id: "parent_1",
  conversation_id: "parent",
  text: "Worker notification",
} satisfies ParentMessageNotification;

function fixture() {
  const tool = vi
    .fn()
    .mockResolvedValueOnce(message)
    .mockResolvedValueOnce({ message: { id: message.message_id } })
    .mockResolvedValue(undefined);

  const send = vi.fn().mockResolvedValue(undefined);
  const transport = { tool, send } as unknown as Transport;
  const scope = { conversation: "parent" as string | undefined };
  const relay = new ParentMessageRelay(transport, () => scope.conversation);

  return { tool, send, transport, scope, relay };
}

test("relay forwards each claimed worker message, records host delivery and stops when none remains", async () => {
  const { relay, tool, send } = fixture();
  await relay.forward("parent");

  expect(tool.mock.calls).toEqual([
    ["app_claim_parent_message", { conversation_id: "parent" }],
    ["get_message", { task_id: "worker", message_id: "parent_1" }],
    [
      "app_record_parent_delivery",
      {
        task_id: "worker",
        attempt_id: 2,
        conversation_id: "parent",
        delivered: true,
      },
    ],
    // It claims again until no message remains.
    ["app_claim_parent_message", { conversation_id: "parent" }],
  ]);

  expect(send).toHaveBeenCalledExactlyOnceWith(message.text, {
    submit: true,
  });

  const [sendOrder] = send.mock.invocationCallOrder;
  const [, , thirdToolOrder] = tool.mock.invocationCallOrder;
  assert.isDefined(sendOrder);
  assert.isDefined(thirdToolOrder);
  expect(sendOrder).toBeLessThan(thirdToolOrder);
});

test("relay sends through a class-based transport with its receiver", async () => {
  const { tool } = fixture();

  class MethodTransport {
    sent: string[] = [];
    tool = tool;
    async send(text: string) {
      this.sent.push(text);
    }
  }

  const transport = new MethodTransport();

  const relay = new ParentMessageRelay(
    transport as unknown as Transport,
    () => "parent",
  );

  await relay.forward("parent");
  expect(transport.sent).toEqual([message.text]);

  expect(tool).toHaveBeenCalledWith(
    "app_record_parent_delivery",
    expect.objectContaining({ delivered: true }),
  );
});

test("an unavailable host or empty claim does not send or log delivery", async () => {
  const { relay, transport, tool, send } = fixture();
  transport.send = undefined;
  await relay.forward("parent");
  expect(tool).not.toHaveBeenCalled();
  transport.send = send;
  tool.mockReset().mockResolvedValue(null);
  await relay.forward("parent");
  expect(tool).toHaveBeenCalledTimes(1);
  expect(send).not.toHaveBeenCalled();
});

test.each(["elsewhere", undefined])(
  "scope change or teardown during claim prevents sending (%s)",
  async (conversation) => {
    const { relay, scope, tool, send } = fixture();
    let resolve!: (value: typeof message) => void;

    tool
      .mockReset()
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      )
      .mockResolvedValue(undefined);

    const pending = relay.forward("parent");
    scope.conversation = conversation;
    resolve(message);

    await expect(pending).rejects.toThrow(/conversation changed/);
    expect(send).not.toHaveBeenCalled();

    expect(tool).toHaveBeenLastCalledWith(
      "app_record_parent_delivery",
      expect.objectContaining({
        delivered: false,
        error: "Panel parent conversation changed before delivery",
      }),
    );
  },
);

test("a claimed message from another conversation cannot be sent", async () => {
  const { relay, tool, send } = fixture();

  tool
    .mockReset()
    .mockResolvedValueOnce({ ...message, conversation_id: "elsewhere" })
    .mockResolvedValue(undefined);

  await expect(relay.forward("parent")).rejects.toThrow(/conversation changed/);
  expect(send).not.toHaveBeenCalled();

  expect(tool).toHaveBeenLastCalledWith(
    "app_record_parent_delivery",
    expect.objectContaining({ delivered: false }),
  );
});

test("a forward during another claims again once that one finishes, and the guard resets afterwards", async () => {
  const { relay, tool, send } = fixture();
  let resolve!: () => void;

  send.mockImplementationOnce(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );

  const pending = relay.forward("parent");
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  await relay.forward("parent");
  expect(tool).toHaveBeenCalledTimes(2);
  resolve();
  await pending;

  // Record, the claim that found none, and the claim the second forward asked for.
  expect(tool).toHaveBeenCalledTimes(5);
  tool.mockResolvedValue(null);
  await relay.forward("parent");
  expect(tool).toHaveBeenCalledTimes(6);
});

test("several queued messages are all delivered by one forward", async () => {
  const { relay, tool, send } = fixture();
  const second = { ...message, attempt_id: 3, text: "Second notification" };

  tool
    .mockReset()
    .mockResolvedValueOnce(message)
    .mockResolvedValueOnce({ message: { id: message.message_id } })
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce(second)
    .mockResolvedValueOnce({ message: { id: second.message_id } })
    .mockResolvedValue(undefined);

  await relay.forward("parent");

  expect(send.mock.calls).toEqual([
    [message.text, { submit: true }],
    [second.text, { submit: true }],
  ]);
});

test("send failures are logged once with bounded error text and allow later refreshes", async () => {
  const { relay, tool, send } = fixture();
  const failure = "x".repeat(2500);
  send.mockRejectedValueOnce(new Error(failure));
  await expect(relay.forward("parent")).rejects.toThrow(failure);

  expect(tool).toHaveBeenLastCalledWith("app_record_parent_delivery", {
    task_id: "worker",
    attempt_id: 2,
    conversation_id: "parent",
    delivered: false,
    error: failure.slice(0, 2000),
  });

  tool.mockResolvedValue(null);
  await relay.forward("parent");
  expect(tool).toHaveBeenCalledTimes(4);
  expect(send).toHaveBeenCalledTimes(1);
});

test("a report acknowledged after claim skips sending and records the reason", async () => {
  const { relay, tool, send } = fixture();

  tool
    .mockReset()
    .mockResolvedValueOnce(message)
    .mockResolvedValueOnce({
      message: { id: message.message_id, acknowledged: true },
    })
    .mockResolvedValue(undefined);

  await relay.forward("parent");
  expect(send).not.toHaveBeenCalled();

  expect(tool).toHaveBeenNthCalledWith(3, "app_record_parent_delivery", {
    task_id: "worker",
    attempt_id: 2,
    conversation_id: "parent",
    delivered: false,
    skipped: "acknowledged",
  });
});

test.each(["elsewhere", undefined])(
  "scope change or teardown during acknowledgement check prevents sending (%s)",
  async (conversation) => {
    const { relay, tool, send, scope } = fixture();
    let resolve!: (value: { message: { id: string } }) => void;

    tool
      .mockReset()
      .mockResolvedValueOnce(message)
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      )
      .mockResolvedValue(undefined);

    const pending = relay.forward("parent");
    await vi.waitFor(() => expect(tool).toHaveBeenCalledTimes(2));
    scope.conversation = conversation;
    resolve({ message: { id: message.message_id } });
    await expect(pending).rejects.toThrow(/conversation changed/);
    expect(send).not.toHaveBeenCalled();

    expect(tool).toHaveBeenLastCalledWith(
      "app_record_parent_delivery",
      expect.objectContaining({
        delivered: false,
        error: "Panel parent conversation changed before delivery",
      }),
    );
  },
);

test("an acknowledgement lookup failure is logged without sending", async () => {
  const { relay, tool, send } = fixture();

  tool
    .mockReset()
    .mockResolvedValueOnce(message)
    .mockRejectedValueOnce(new Error("Lookup unavailable"))
    .mockResolvedValue(undefined);

  await expect(relay.forward("parent")).rejects.toThrow("Lookup unavailable");
  expect(send).not.toHaveBeenCalled();

  expect(tool).toHaveBeenLastCalledWith(
    "app_record_parent_delivery",
    expect.objectContaining({ delivered: false, error: "Lookup unavailable" }),
  );
});
