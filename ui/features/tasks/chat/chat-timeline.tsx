import { useLayoutEffect, useRef } from "react";

import { providerMetadata } from "../../../../src/features/providers/metadata.js";
import { useSnapshot } from "../../../shared/state/controller-context";
import { statusLabel } from "../../../shared/state/selectors";
import type { Task } from "../../../shared/state/types";
import { currentActivityStatus } from "../activity/activity-timeline";
import { ChatMessageView } from "./chat-message-view";
import { composerMode } from "./chat-model";
import { ChatNoteRow } from "./chat-note-row";
import { PendingInput } from "./pending-input";
import { TurnOutcomeRow } from "./turn-outcome-row";

/** How close to the end counts as reading the latest messages. */
const END_SLACK_PX = 48;

type ChatTimelineProps = { task: Task };

/**
 * The conversation: messages, turn outcomes and notes, then what the worker
 * is doing now or the input it waits for. It follows new messages while the
 * reader is at the end.
 */
export function ChatTimeline({ task }: ChatTimelineProps) {
  const state = useSnapshot(),
    chat = state.chat?.task === task.id ? state.chat : undefined,
    ref = useRef<HTMLDivElement>(null),
    atEnd = useRef(true),
    worker =
      providerMetadata(
        task.provider,
        state.workers.find((w) => w.provider === task.provider)?.metadata,
      )?.displayName ?? task.provider;

  // Pending steers and queued messages show above the composer until sent.
  const waiting = new Set(
    [...task.pending_steers, ...task.queue].map((m) => m.id),
  );

  const items = chat?.items.filter(
    (item) => !(item.kind === "message" && waiting.has(item.id)),
  );

  // The message being written, until the stored one with its id arrives.
  const draft =
    state.draft?.task === task.id
      ? state.draft
      : task.draft && { task: task.id, ...task.draft };

  const streaming =
    draft && !chat?.items.some((item) => item.id === draft.message_id)
      ? draft
      : undefined;

  const working =
    composerMode(task) === "busy" && !streaming
      ? task.status === "running" && state.events.length
        ? currentActivityStatus(state.events, task).text
        : statusLabel(task)
      : undefined;

  const last = items?.at(-1);

  // The layout can settle after the first render, such as when the
  // inspector stops stacking, so the timeline sticks to its end as its box
  // changes too.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      if (atEnd.current) element.scrollTop = element.scrollHeight;
    });

    observer.observe(element);

    return () => observer.disconnect();
  }, [task.id]);

  useLayoutEffect(() => {
    const element = ref.current;
    if (element && atEnd.current) element.scrollTop = element.scrollHeight;
  }, [
    items?.length,
    last?.event_id,
    working,
    streaming?.text.length,
    task.pending_input?.id,
    task.id,
  ]);

  return (
    <div
      ref={ref}
      className="chat-timeline"
      onScroll={(event) => {
        const element = event.currentTarget;

        atEnd.current =
          element.scrollHeight - element.scrollTop - element.clientHeight <
          END_SLACK_PX;
      }}
    >
      {!items ? (
        <p className="help">Loading the conversation…</p>
      ) : (
        items.map((item) =>
          item.kind === "message" ? (
            <ChatMessageView
              key={item.id}
              message={item.message}
              worker={worker}
            />
          ) : item.kind === "outcome" ? (
            <TurnOutcomeRow key={item.id} outcome={item} />
          ) : (
            <ChatNoteRow key={item.id} note={item} />
          ),
        )
      )}
      {streaming && (
        <ChatMessageView
          message={{
            id: streaming.message_id,
            event_id: Infinity,
            timestamp: "",
            turn: task.turn,
            from: "worker",
            kind: "message",
            text: streaming.text,
          }}
          worker={worker}
          streaming
        />
      )}
      {working && (
        <div className="chat-working" role="status">
          <span className="dot running" aria-hidden="true" />
          <span>{working}</span>
        </div>
      )}
      <PendingInput task={task} />
    </div>
  );
}
