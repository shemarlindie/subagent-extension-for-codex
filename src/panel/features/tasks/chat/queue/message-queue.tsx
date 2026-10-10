import { useState } from "react";

import {
  useController,
  useSnapshot,
} from "../../../../app/state/controller-context";
import type { Task } from "../../../../app/state/types";
import { Button } from "../../../../shared/components/button/button";
import {
  Presence,
  useListPresence,
} from "../../../../shared/components/motion/motion";
import { QueuedMessageRow } from "./queued-message-row";

type MessageQueueProps = { task: Task };

/** The queued message being dragged and the insertion point it's over. */
type QueueDrag = { id: string; over?: number };

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
    // Rows fold in when added and out when sent or removed.
    pendingRows = useListPresence(pending, messageId),
    queueRows = useListPresence(queue, messageId);

  const move = async (messageId: string, index: number) => {
    const error = await controller.moveQueued(task, messageId, index);
    setError(error);

    return !error;
  };

  const drop = () => {
    if (!drag || drag.over === undefined) return setDrag(undefined);

    const from = queue.findIndex((message) => message.id === drag.id),
      // The insertion point counts the dragged row, which leaves its place.
      to = Math.max(drag.over > from ? drag.over - 1 : drag.over, first);

    setDrag(undefined);
    if (from >= 0 && to !== from) void move(drag.id, to);
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
                onClick={async () =>
                  setError(await controller.interruptTask(task, true))
                }
              >
                Interrupt and send now
              </Button>
            </div>
            <ul>
              {pendingRows.map(({ item, key, present, added }) => (
                <Presence key={key} as="li" show={present} appear={added}>
                  <div className="chat-queue-item" data-message={key}>
                    <p className="chat-queue-text">{item.message}</p>
                  </div>
                </Presence>
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
                    onClick={async () =>
                      setError(await controller.resumeQueue(task))
                    }
                  >
                    Resume
                  </Button>
                  <Button
                    variant="text"
                    underline
                    disabled={busy}
                    onClick={async () =>
                      setError(await controller.clearQueue(task))
                    }
                  >
                    Clear
                  </Button>
                </span>
              )}
            </div>
            <ul
              onDragOver={(event) => {
                if (drag) event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                drop();
              }}
            >
              {queueRows.map(({ item: message, key, present, added }) => {
                // A row playing its exit keeps the content it last showed.
                const index = positions.get(key) ?? -1;

                return (
                  <Presence key={key} as="li" show={present} appear={added}>
                    {present && (
                      <QueuedMessageRow
                        task={task}
                        message={message}
                        onError={setError}
                        reorderable={reorderable}
                        movable={reorderable && !message.recorded}
                        dragging={drag?.id === key}
                        dropAt={
                          drag?.over === index
                            ? "before"
                            : drag?.over === index + 1 &&
                                index === queue.length - 1
                              ? "after"
                              : undefined
                        }
                        onMove={(offset) => {
                          const to = index + offset;

                          return to >= first && to < queue.length
                            ? move(key, to)
                            : Promise.resolve(false);
                        }}
                        onDragStart={() => setDrag({ id: key })}
                        onDragOver={(after) => {
                          const over = Math.max(index + (after ? 1 : 0), first);

                          if (drag && drag.over !== over)
                            setDrag({ ...drag, over });
                        }}
                        onDragEnd={() => setDrag(undefined)}
                      />
                    )}
                  </Presence>
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

const messageId = (message: { id: string }) => message.id;
