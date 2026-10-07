import { useState } from "react";

import type { QueuedMessage } from "../../../../src/shared/contracts";
import { Button } from "../../../shared/components/button";
import {
  useController,
  useSnapshot,
} from "../../../shared/state/controller-context";
import type { Task } from "../../../shared/state/types";

type QueuedMessageRowProps = {
  task: Task;
  message: QueuedMessage;
  onError: (error?: string) => void;
};

/** A message waiting for its turn, which can be edited or removed until then. */
export function QueuedMessageRow({
  task,
  message,
  onError,
}: QueuedMessageRowProps) {
  const controller = useController(),
    busy = useSnapshot().busy,
    [draft, setDraft] = useState<string>();

  const save = async () => {
    if (!draft?.trim()) return;
    const error = await controller.editQueued(task, message.id, draft.trim());
    onError(error);
    if (!error) setDraft(undefined);
  };

  return (
    <li className="chat-queue-item" data-message={message.id}>
      {draft === undefined ? (
        <p className="chat-queue-text">
          {message.from === "parent" && (
            <span className="chat-queue-sender">Parent agent · </span>
          )}
          {message.message}
        </p>
      ) : (
        <textarea
          className="chat-queue-edit"
          aria-label="Queued message"
          value={draft}
          maxLength={20000}
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setDraft(undefined);
            } else if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              void save();
            }
          }}
        />
      )}
      <div className="chat-queue-actions">
        {draft === undefined ? (
          <>
            {/* A steer the worker already has keeps its text. */}
            {!message.recorded && (
              <Button
                variant="text"
                underline
                disabled={busy}
                onClick={() => setDraft(message.message)}
              >
                Edit
              </Button>
            )}
            <Button
              variant="text"
              underline
              disabled={busy}
              onClick={async () =>
                onError(await controller.removeQueued(task, message.id))
              }
            >
              Remove
            </Button>
          </>
        ) : (
          <>
            <Button variant="text" underline disabled={busy} onClick={save}>
              Save
            </Button>
            <Button
              variant="text"
              underline
              onClick={() => setDraft(undefined)}
            >
              Cancel
            </Button>
          </>
        )}
      </div>
    </li>
  );
}
