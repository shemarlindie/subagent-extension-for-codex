import { expect, test, vi } from "vitest";

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

test("relay forwards a claimed worker message and records host delivery", async () => {
  const { relay, tool, send } = fixture();
  await relay.forward("parent");

  expect(tool.mock.calls).toEqual([
    ["claim_user_agent_parent_message", { conversation_id: "parent" }],
    ["get_agent_message", { task_id: "worker", message_id: "parent_1" }],
    [
      "record_user_agent_parent_delivery",
      {
        task_id: "worker",
        attempt_id: 2,
        conversation_id: "parent",
        delivered: true,
      },
    ],
  ]);

  expect(send).toHaveBeenCalledExactlyOnceWith(message.text, {
    submit: true,
  });

  expect(send.mock.invocationCallOrder[0]).toBeLessThan(
    tool.mock.invocationCallOrder[2],
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
      "record_user_agent_parent_delivery",
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
    "record_user_agent_parent_delivery",
    expect.objectContaining({ delivered: false }),
  );
});

test("overlapping refreshes share one active delivery and the guard resets afterwards", async () => {
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
  tool.mockResolvedValue(null);
  await relay.forward("parent");
  expect(tool).toHaveBeenCalledTimes(4);
});

test("send failures are logged once with bounded error text and allow later refreshes", async () => {
  const { relay, tool, send } = fixture();
  const failure = "x".repeat(2500);
  send.mockRejectedValueOnce(new Error(failure));
  await expect(relay.forward("parent")).rejects.toThrow(failure);

  expect(tool).toHaveBeenLastCalledWith("record_user_agent_parent_delivery", {
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

  expect(tool).toHaveBeenLastCalledWith("record_user_agent_parent_delivery", {
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
      "record_user_agent_parent_delivery",
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
    "record_user_agent_parent_delivery",
    expect.objectContaining({ delivered: false, error: "Lookup unavailable" }),
  );
});
