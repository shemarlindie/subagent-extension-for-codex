import { act } from "@testing-library/react";

import { event, SELECTED, storeChat, type Mounted } from "../base-state";
import { refreshWith, type Scenario } from "./scenario";

const MESSAGE = "m3";
const STARTED = "The session store keeps tokens forever.\n\nIt also";

/** Streams `text` onto the reply the worker is writing. */
async function stream({ transport }: Mounted, offset: number, text: string) {
  await act(async () =>
    transport.events.draft({
      task_id: SELECTED,
      message_id: MESSAGE,
      offset,
      text,
    }),
  );
}

/** A reply in progress, with one finished paragraph and one open. */
async function startReply(mounted: Mounted) {
  mounted.transport.streamsDrafts = true;
  await stream(mounted, 0, STARTED);
}

/** A reply streaming into Chat as the worker writes it. */
export const streamingScenarios: Scenario[] = [
  {
    label: "A streamed delta inside a paragraph",
    group: "Streaming",
    prepare: startReply,
    change: (mounted) => stream(mounted, STARTED.length, " skips the"),
  },
  {
    label: "A streamed delta that finishes a paragraph",
    group: "Streaming",
    prepare: startReply,
    change: (mounted) =>
      stream(mounted, STARTED.length, " skips expiry.\n\nThe fix"),
  },
  {
    label: "A streamed reply is stored",
    group: "Streaming",
    prepare: async (mounted) => {
      await startReply(mounted);
      await stream(mounted, STARTED.length, " skips expiry.\n\nThe fix");
    },
    change: async (mounted) => {
      const text = `${STARTED} skips expiry.\n\nThe fix sets a TTL.`;

      await refreshWith(mounted, () => {
        mounted.transport.taskEvents.push(
          event("agent.message", {
            role: "assistant",
            text,
            message_id: MESSAGE,
          }),
        );

        storeChat(mounted.transport);
      });

      await act(async () =>
        mounted.transport.events.draft({
          task_id: SELECTED,
          message_id: MESSAGE,
          cleared: true,
        }),
      );
    },
  },
];
