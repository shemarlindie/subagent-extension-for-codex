import { type DragEvent, useState } from "react";

import {
  useController,
  useSnapshot,
} from "../../../../app/state/controller-context";
import type { Task } from "../../../../app/state/types";
import { Button } from "../../../../shared/components/button/button";
import { useAutoList } from "../../../../shared/components/motion/auto-list";
import { Presence } from "../../../../shared/components/motion/presence";
import { QueuedMessageRow } from "./queued-message-row";

type MessageQueueProps = { task: Task };

/** The queued message being dragged and the insertion point it's over. */
type QueueDrag = { id: string; over?: number };

/** Where a dragged message would land relative to the row at `index`. */
function dropEdge(
  over: number | undefined,
  index: number,
  count: number,
): "before" | "after" | undefined {
  if (over === index) return "before";
  if (over === index + 1 && index === count - 1) return "after";

  return undefined;
}

/**
 * Messages not sent yet, above the composer: steers the running turn takes
 * after its next tool call, then queued messages that each start a turn.
 * Queued messages can be reordered by dragging or with Alt+Up/Down.
 */
export function MessageQueue({ task }: MessageQueueProps) {
  const controller = useController(),
    busy = useSnapshot().busy,
    [error, setError] = useState<string>(),
    [drag, setDrag] = useState<QueueDrag>(),
    pending = task.pending_steers,
    queue = task.queue,
    // Steers the worker already has lead the queue and stay there.
    first = queue.filter((message) => message.recorded).length,
    reorderable = queue.length - first > 1,
    positions = new Map(queue.map((message, index) => [message.id, index])),
    // Rows fade in when added, out when sent or removed, and slide when reordered.
    [pendingList] = useAutoList<HTMLUListElement>(),
    [queueList] = useAutoList<HTMLUListElement>();

  const move = async (messageId: string, index: number) => {
    const error = await controller.taskActions.moveQueued(
      task,
      messageId,
      index,
    );

    setError(error);

    return !error;
  };

  const interrupt = async () => {
    setError(await controller.taskActions.interruptTask(task, true));
  };

  const resume = async () => {
    setError(await controller.taskActions.resumeQueue(task));
  };

  const clear = async () => {
    setError(await controller.taskActions.clearQueue(task));
  };

  const drop = () => {
    if (!drag || drag.over === undefined) return setDrag(undefined);

    const from = queue.findIndex((message) => message.id === drag.id),
      // The insertion point counts the dragged row, which leaves its place.
      to = Math.max(drag.over > from ? drag.over - 1 : drag.over, first);

    setDrag(undefined);
    if (from >= 0 && to !== from) controller.run(() => move(drag.id, to));
  };

  const moveRow = (messageId: string, index: number, offset: number) => {
    const to = index + offset;

    return to >= first && to < queue.length
      ? move(messageId, to)
      : Promise.resolve(false);
  };

  const dragOverRow = (index: number, after: boolean) => {
    const over = Math.max(index + (after ? 1 : 0), first);

    if (drag && drag.over !== over) setDrag({ ...drag, over });
  };

  const dragOverQueue = (event: DragEvent<HTMLUListElement>) => {
    if (drag) event.preventDefault();
  };

  const dropOnQueue = (event: DragEvent<HTMLUListElement>) => {
    event.preventDefault();
    drop();
  };

  return (
    <Presence show={pending.length > 0 || queue.length > 0}>
      <section className="chat-queue" aria-label="Messages not sent yet">
        <Presence show={pending.length > 0}>
          <div className="chat-queue-group" data-group="steers">
            <div className="chat-queue-header">
              <span>Steer</span>
              <Button
                variant="text"
                underline
                disabled={busy}
                onClick={() => controller.run(interrupt)}
              >
                Interrupt and send now
              </Button>
            </div>
            <ul ref={pendingList}>
              {pending.map((item) => (
                <li key={item.id}>
                  <div className="chat-queue-item" data-message={item.id}>
                    <p className="chat-queue-text">{item.message}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </Presence>
        <Presence show={queue.length > 0}>
          <div
            className="chat-queue-group"
            data-group="queue"
            data-paused={task.queue_paused || undefined}
          >
            <div className="chat-queue-header">
              <span>
                {task.queue_paused ? "Queue paused" : "Queued"} · {queue.length}
              </span>
              {task.queue_paused && (
                <span className="chat-queue-controls">
                  <Button
                    variant="text"
                    underline
                    disabled={busy}
                    onClick={() => controller.run(resume)}
                  >
                    Resume
                  </Button>
                  <Button
                    variant="text"
                    underline
                    disabled={busy}
                    onClick={() => controller.run(clear)}
                  >
                    Clear
                  </Button>
                </span>
              )}
            </div>
            <ul ref={queueList} onDragOver={dragOverQueue} onDrop={dropOnQueue}>
              {queue.map((message) => {
                const key = message.id,
                  index = positions.get(key) ?? -1;

                return (
                  <li key={key}>
                    <QueuedMessageRow
                      task={task}
                      message={message}
                      onError={setError}
                      reorderable={reorderable}
                      movable={reorderable && !message.recorded}
                      dragging={drag?.id === key}
                      dropAt={dropEdge(drag?.over, index, queue.length)}
                      onMove={(offset) => moveRow(key, index, offset)}
                      onDragStart={() => setDrag({ id: key })}
                      onDragOver={(after) => dragOverRow(index, after)}
                      onDragEnd={() => setDrag(undefined)}
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        </Presence>
        {error && (
          <p className="chat-error error" role="alert">
            {error}
          </p>
        )}
      </section>
    </Presence>
  );
}
