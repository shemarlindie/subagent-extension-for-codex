import { Tooltip } from "@base-ui/react/tooltip";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import { onTestFinished, vi } from "vitest";

import type { ChatItem } from "../../../../shared/tasks/conversation/chat";
import { Controller } from "../../../app/state/controller";
import { ControllerContext } from "../../../app/state/controller-context";
import type { Event, Task, Transport } from "../../../app/state/types";
import { ChatPanel } from "./chat-panel";

const base: Task = {
  id: "task-1",
  repository: "/repo",
  revision: "HEAD",
  provider: "claude",
  worker_profile: "implementer",
  title: "Implement",
  description: "Implement the change",
  depends_on: [],
  context: [],
  workspace_strategy: "worktree",
  budget: { max_runtime_minutes: 20, max_cost_usd: 5 },
  owner: "owner",
  status: "completed",
  created_at: "",
  updated_at: "",
  instructions: [],
  created_by: "user",
  instructions_sent: 0,
  pending_steers: [],
  queue: [],
  turn: 1,
  runtime_ms: 60000,
  cost_usd: 1,
};

function setup(
  patch: Partial<Task> = {},
  events: Event[] = [],
  chatItems: ChatItem[] = [],
) {
  onTestFinished(cleanup);
  const task = { ...base, ...patch };

  const controller = new Controller(
    { embedded: true, dispose() {} } as unknown as Transport,
    { hidden: () => false, wide: () => false },
  );

  onTestFinished(() => controller.dispose());
  const tool = vi.spyOn(controller, "tool").mockResolvedValue({});
  vi.spyOn(controller, "refresh").mockResolvedValue();

  const snapshot = {
    ...controller.getSnapshot(),
    events,
    chat: { task: task.id, items: chatItems, cursor: chatItems.length },
  };

  const getSnapshot = controller.getSnapshot.bind(controller);
  let snapshotBusy = snapshot.busy;
  let snapshotMark = snapshot.newMark;
  let visibleSnapshot = snapshot;

  vi.spyOn(controller, "getSnapshot").mockImplementation(() => {
    const { busy, newMark } = getSnapshot();

    // Actions that change these show here; the rest of the snapshot stays fixed.
    if (busy !== snapshotBusy || newMark !== snapshotMark) {
      snapshotBusy = busy;
      snapshotMark = newMark;
      visibleSnapshot = { ...snapshot, busy, newMark };
    }

    return visibleSnapshot;
  });

  // Chat remounts for each opening, as the inspector keys it by task.
  let opening = 0;

  const panel = (current: Task) =>
    createElement(
      ControllerContext.Provider,
      { value: controller },
      createElement(
        Tooltip.Provider,
        null,
        createElement(ChatPanel, {
          key: opening,
          task: current,
          taskId: current.id,
        }),
      ),
    );

  const view = render(panel(task));

  const updateTask = (patch: Partial<Task>) =>
    view.rerender(panel({ ...task, ...patch }));

  const updateChat = (items: ChatItem[]) => {
    snapshot.chat = { task: task.id, items, cursor: items.length };
    visibleSnapshot = { ...snapshot };
    view.rerender(panel(task));
  };

  const reopen = (patch: Partial<Task>) => {
    opening++;
    updateTask(patch);
  };

  const getComposer = () => view.getByRole("textbox", { name: "Message" });

  const type = (text: string) =>
    fireEvent.change(getComposer(), { target: { value: text } });

  return {
    controller,
    task,
    tool,
    view,
    reopen,
    get composer() {
      return getComposer();
    },
    type,
    updateTask,
    updateChat,
  };
}

const sent = (tool: ReturnType<typeof setup>["tool"]) =>
  tool.mock.calls.map(([name, args]) => [name, args]);

export { base, sent, setup };

const noteItems: ChatItem[] = Array.from({ length: 6 }, (_, index) => ({
  kind: "note",
  id: `note-${index}`,
  event_id: index,
  timestamp: "",
  note: "compaction",
  text: `Note ${index}`,
}));

/** A Chat history 600 px tall in a 200 px viewport, scrolled into its history. */
function scrollIntoHistory(view: ReturnType<typeof setup>["view"]) {
  const history = view.getByRole("region", { name: "Chat history" });
  let scrollTop = 400;

  Object.defineProperties(history, {
    clientHeight: { configurable: true, value: 200 },
    scrollHeight: { configurable: true, value: 600 },
    scrollTop: {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
    },
  });

  history.scrollTop = 100;
  fireEvent.scroll(history);
}

export { noteItems, scrollIntoHistory };
