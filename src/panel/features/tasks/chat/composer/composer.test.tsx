// @vitest-environment jsdom
import { Tooltip } from "@base-ui/react/tooltip";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { expect, onTestFinished, test, vi } from "vitest";

import { ControllerContext } from "../../../../app/state/controller-context";
import {
  deferred,
  flush,
  setup as setupController,
  task,
} from "../../../../app/state/controller-test-harness";
import { Composer } from "./composer";

function setup() {
  const { controller } = setupController();
  const current = { ...task("task-1"), status: "completed" as const };
  const write = deferred<unknown>();
  const refresh = deferred<void>();
  const tool = vi.spyOn(controller, "tool").mockReturnValue(write.promise);

  const reload = vi
    .spyOn(controller, "refresh")
    .mockReturnValue(refresh.promise);

  onTestFinished(cleanup);
  onTestFinished(() => controller.dispose());

  let opening = 0;

  const panel = () => (
    <ControllerContext.Provider value={controller}>
      <Tooltip.Provider>
        <Composer key={opening} task={current} budgetApplyVersion={0} />
      </Tooltip.Provider>
    </ControllerContext.Provider>
  );

  const view = render(panel());

  const input = view.getByRole("textbox", {
    name: "Message",
  }) as HTMLTextAreaElement;

  const send = view.getByRole("button", { name: "Send" }) as HTMLButtonElement;

  const reopen = () => {
    opening++;
    view.rerender(panel());
  };

  const type = (text: string) =>
    fireEvent.change(input, { target: { value: text } });

  const enter = () => fireEvent.keyDown(input, { key: "Enter" });

  return {
    controller,
    view,
    input,
    send,
    type,
    enter,
    tool,
    write,
    refresh,
    reload,
    reopen,
  };
}

test("a slow send shows progress and blocks repeated sends until acknowledgement", async () => {
  const { view, input, send, type, enter, tool, write, refresh, reload } =
    setup();

  type("Follow up");

  // Keep these in one render batch to also exercise the synchronous guard.
  act(() => {
    enter();
    enter();
    fireEvent.click(send);
  });

  expect(tool).toHaveBeenCalledExactlyOnceWith("send_user_agent_message", {
    task_id: "task-1",
    message: "Follow up",
    delivery: "steer",
    request_id: expect.any(String),
  });

  expect(send.disabled).toBe(true);
  expect(input.disabled).toBe(false);
  expect(input.value).toBe("Follow up");
  expect(view.getByText("Sending…")).toBeTruthy();

  expect(input.closest(".chat-composer")?.getAttribute("aria-busy")).toBe(
    "true",
  );

  await act(async () => {
    write.resolve({});
    await flush();
  });

  expect(reload).toHaveBeenCalledOnce();
  expect(input.value).toBe("");
  expect(view.queryByText("Sending…")).toBeNull();

  expect(input.closest(".chat-composer")?.getAttribute("aria-busy")).not.toBe(
    "true",
  );

  enter();
  expect(tool).toHaveBeenCalledOnce();

  await act(async () => {
    refresh.resolve();
    await flush();
  });
});

test.each([false, true])(
  "reopening while sending blocks duplicates and preserves a newer draft: %s",
  async (editAfterReopen) => {
    const { controller, view, type, enter, tool, write, refresh, reopen } =
      setup();

    type("Original message");
    enter();
    reopen();

    const input = view.getByRole("textbox", {
      name: "Message",
    }) as HTMLTextAreaElement;

    const send = view.getByRole("button", {
      name: "Sending…",
    }) as HTMLButtonElement;

    expect(input.value).toBe("Original message");
    expect(send.disabled).toBe(true);
    expect(input.disabled).toBe(false);
    expect(view.getByText("Sending…")).toBeTruthy();

    expect(input.closest(".chat-composer")?.getAttribute("aria-busy")).toBe(
      "true",
    );

    if (editAfterReopen) {
      fireEvent.change(input, {
        target: { value: "New draft after reopening" },
      });
    }

    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(send);
    expect(tool).toHaveBeenCalledOnce();

    await act(async () => {
      write.resolve({});
      await flush();
    });

    const expected = editAfterReopen ? "New draft after reopening" : "";
    expect(view.queryByText("Sending…")).toBeNull();

    expect(input.closest(".chat-composer")?.getAttribute("aria-busy")).not.toBe(
      "true",
    );

    expect(input.value).toBe(expected);

    expect(controller.session.get("task", "task-1").composerDraft).toBe(
      expected,
    );

    expect(tool).toHaveBeenCalledOnce();

    await act(async () => {
      refresh.resolve();
      await flush();
    });
  },
);

test("typing a new draft during a send preserves it when the write is acknowledged", async () => {
  const { controller, input, send, type, enter, tool, write, refresh } =
    setup();

  type("First message");
  enter();
  type("A newer draft");
  enter();
  expect(tool).toHaveBeenCalledOnce();
  expect(send.disabled).toBe(true);

  await act(async () => {
    write.resolve({});
    await flush();
  });

  expect(input.value).toBe("A newer draft");

  expect(controller.session.get("task", "task-1").composerDraft).toBe(
    "A newer draft",
  );

  expect(send.disabled).toBe(false);

  await act(async () => {
    refresh.resolve();
    await flush();
  });

  expect(input.value).toBe("A newer draft");
});

test("a failed send retains its draft, explains the failure and allows a single retry", async () => {
  const { view, input, send, type, enter, tool, write, reload } = setup();
  type("Keep this message");
  enter();

  await act(async () => {
    write.reject(new Error("Message could not be sent"));
    await flush();
  });

  expect(view.getByRole("alert").textContent).toBe("Message could not be sent");
  expect(input.value).toBe("Keep this message");
  expect(send.disabled).toBe(false);
  expect(view.queryByText("Sending…")).toBeNull();
  expect(reload).not.toHaveBeenCalled();

  const retry = deferred<unknown>();
  tool.mockReturnValue(retry.promise);

  act(() => {
    fireEvent.click(send);
    enter();
  });

  expect(tool).toHaveBeenCalledTimes(2);
  expect(view.queryByRole("alert")).toBeNull();
  expect(view.getByText("Sending…")).toBeTruthy();

  await act(async () => {
    retry.reject(new Error("Still unavailable"));
    await flush();
  });

  expect(input.value).toBe("Keep this message");
  expect(view.getByRole("alert").textContent).toBe("Still unavailable");
});

test.each(["before rejection", "after rejection"])(
  "reopening %s preserves a failed send's feedback and allows retry",
  async (reopenWhen) => {
    const { view, type, enter, tool, write, reload, reopen } = setup();
    type("Retain this draft");
    enter();
    if (reopenWhen === "before rejection") reopen();

    await act(async () => {
      write.reject(new Error("Send unavailable"));
      await flush();
    });

    if (reopenWhen === "after rejection") reopen();

    const input = view.getByRole("textbox", {
      name: "Message",
    }) as HTMLTextAreaElement;

    const send = view.getByRole("button", {
      name: "Send",
    }) as HTMLButtonElement;

    expect(view.getByRole("alert").textContent).toBe("Send unavailable");
    expect(view.queryByText("Sending…")).toBeNull();

    expect(input.closest(".chat-composer")?.getAttribute("aria-busy")).not.toBe(
      "true",
    );

    expect(input.value).toBe("Retain this draft");
    expect(send.disabled).toBe(false);
    expect(reload).not.toHaveBeenCalled();

    const retry = deferred<unknown>();
    tool.mockReturnValue(retry.promise);

    act(() => {
      fireEvent.click(send);
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(tool).toHaveBeenCalledTimes(2);
    expect(view.queryByRole("alert")).toBeNull();
    expect(view.getByText("Sending…")).toBeTruthy();

    await act(async () => {
      retry.reject(new Error("Retry unavailable"));
      await flush();
    });

    expect(input.value).toBe("Retain this draft");
    expect(view.getByRole("alert").textContent).toBe("Retry unavailable");
  },
);

test("a timed out send retains its draft and retry ID while late delivery leaves the retry intact", async () => {
  vi.useFakeTimers();

  onTestFinished(() => {
    vi.useRealTimers();
  });

  const { controller, view, input, send, type, enter, tool, write } = setup();
  type("Keep this message");
  enter();
  const original = tool.mock.calls[0];

  await act(async () => {
    await vi.advanceTimersByTimeAsync(30000);
  });

  expect(view.getByRole("alert").textContent).toContain(
    "Delivery could not be confirmed",
  );

  expect(input.value).toBe("Keep this message");
  expect(send.disabled).toBe(false);
  expect(controller.getSnapshot().busy).toBe(false);

  const retry = deferred<unknown>();
  tool.mockReturnValue(retry.promise);
  enter();
  expect(tool.mock.calls[1]).toEqual(original);
  type("A newer draft");

  await act(async () => {
    write.resolve({});
    await flush();
  });

  expect(input.value).toBe("A newer draft");
  expect(send.disabled).toBe(true);
  expect(controller.getSnapshot().busy).toBe(true);
  expect(view.getByText("Sending…")).toBeTruthy();

  await act(async () => {
    retry.resolve({});
    await flush();
  });

  expect(input.value).toBe("A newer draft");
  expect(send.disabled).toBe(false);
  expect(controller.getSnapshot().busy).toBe(false);

  tool.mockResolvedValue({});
  type("Keep this message");

  await act(async () => {
    enter();
    await flush();
  });

  expect(tool.mock.calls[2]).not.toEqual(original);
  expect(input.value).toBe("");
});

test("a late acknowledgement clears the timed out draft and error, so the same text sends anew", async () => {
  vi.useFakeTimers();

  onTestFinished(() => {
    vi.useRealTimers();
  });

  const { view, input, type, enter, tool, write } = setup();
  type("Continue");
  enter();
  const original = tool.mock.calls[0];

  await act(async () => {
    await vi.advanceTimersByTimeAsync(30000);
  });

  expect(view.getByRole("alert").textContent).toContain(
    "Delivery could not be confirmed",
  );

  await act(async () => {
    write.resolve({});
    await flush();
  });

  expect(input.value).toBe("");
  expect(view.queryByRole("alert")).toBeNull();

  tool.mockResolvedValue({});
  type("Continue");

  await act(async () => {
    enter();
    await flush();
  });

  expect(tool.mock.calls[1]?.[1]).toMatchObject({ message: "Continue" });
  expect(tool.mock.calls[1]).not.toEqual(original);
});

test("a late acknowledgement keeps a newer draft and a newer error", async () => {
  vi.useFakeTimers();

  onTestFinished(() => {
    vi.useRealTimers();
  });

  const { controller, view, input, type, enter, write } = setup();
  type("Continue");
  enter();

  await act(async () => {
    await vi.advanceTimersByTimeAsync(30000);
  });

  type("Something else");
  controller.session.update("task", "task-1", { composerError: "Newer" });

  await act(async () => {
    write.resolve({});
    await flush();
  });

  expect(input.value).toBe("Something else");
  expect(view.getByRole("alert").textContent).toBe("Newer");
});
