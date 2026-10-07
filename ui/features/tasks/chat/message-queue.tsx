import { useState } from "react";

import { Button } from "../../../shared/components/button";
import {
  useController,
  useSnapshot,
} from "../../../shared/state/controller-context";
import type { Task } from "../../../shared/state/types";
import { QueuedMessageRow } from "./queued-message-row";

type MessageQueueProps = { task: Task };

/**
 * Messages not sent yet, above the composer: steers the running turn takes
 * after its next tool call, then queued messages that each start a turn.
 */
export function MessageQueue({ task }: MessageQueueProps) {
  const controller = useController(),
    busy = useSnapshot().busy,
    [error, setError] = useState<string>(),
    pending = task.pending_steers,
    queue = task.queue;

  if (!pending.length && !queue.length) return null;

  return (
    <section className="chat-queue" aria-label="Messages not sent yet">
      {pending.length > 0 && (
        <div className="chat-queue-group" data-group="steers">
          <div className="chat-queue-header">
            <span>Sent after the next tool call</span>
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
            {pending.map((message) => (
              <li
                key={message.id}
                className="chat-queue-item"
                data-message={message.id}
              >
                <p className="chat-queue-text">{message.message}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
      {queue.length > 0 && (
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
          <ul>
            {queue.map((message) => (
              <QueuedMessageRow
                key={message.id}
                task={task}
                message={message}
                onError={setError}
              />
            ))}
          </ul>
        </div>
      )}
      {error && (
        <p className="chat-error error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
