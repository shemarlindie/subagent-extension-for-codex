import { providerMetadata } from "../../../../src/features/providers/metadata.js";
import { useSnapshot } from "../../../shared/state/controller-context";
import { statusLabel } from "../../../shared/state/selectors";
import type { Task } from "../../../shared/state/types";
import { useSessionState } from "../../../shared/state/use-session-state";
import { currentActivityStatus } from "../activity/activity-timeline";
import { ChatMessageView } from "./chat-message-view";
import { composerMode } from "./chat-model";
import { ChatNoteRow } from "./chat-note-row";
import { PendingInput } from "./pending-input";
import { TurnOutcomeRow } from "./turn-outcome-row";
import { useChatScroll } from "./use-chat-scroll";

type ChatTimelineProps = { task: Task };

/**
 * The conversation: messages, turn outcomes and notes, then what the worker
 * is doing now or the input it waits for. It follows new messages while the
 * reader is at the end.
 */
export function ChatTimeline({ task }: ChatTimelineProps) {
  const state = useSnapshot(),
    chat = state.chat?.task === task.id ? state.chat : undefined,
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

  const [reading] = useSessionState(
    "task",
    task.id,
    (state) => state.reading.chat,
  );

  const ref = useChatScroll(reading, state.tab === "chat", items !== undefined);

  return (
    <div ref={ref} className="chat-timeline">
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
