import { type DragEvent, type KeyboardEvent, useRef, useState } from "react";

import type { QueuedMessage } from "../../../../../shared/tasks/model";
import {
  useController,
  useSnapshot,
} from "../../../../app/state/controller-context";
import type { Task } from "../../../../app/state/types";
import { Button } from "../../../../shared/components/button/button";
import { Icon } from "../../../../shared/components/icons/icons";
import { Presence } from "../../../../shared/components/motion/presence";
import { useAnimatedHeight } from "../../../../shared/components/motion/use-animated-height";
import { TooltipWrapper } from "../../../../shared/components/tooltip";

type QueuedMessageRowProps = {
  task: Task;
  message: QueuedMessage;
  onError: (error?: string) => void;
  /** Whether the queue can be reordered, so every row keeps a grip slot. */
  reorderable: boolean;
  /** Whether the row can change places with another queued message. */
  movable: boolean;
  dragging: boolean;
  /** Where a dragged message would land relative to this row. */
  dropAt?: "before" | "after";
  /** Moves the message by `offset` places; resolves whether it moved. */
  onMove: (offset: number) => Promise<boolean>;
  onDragStart: () => void;
  /** Reports the pointer over the row's top or bottom half. */
  onDragOver: (after: boolean) => void;
  onDragEnd: () => void;
};

/**
 * A message waiting for its turn, which can be edited, moved or removed until
 * then.
 */
export function QueuedMessageRow({
  task,
  message,
  onError,
  reorderable,
  movable,
  dragging,
  dropAt,
  onMove,
  onDragStart,
  onDragOver,
  onDragEnd,
}: QueuedMessageRowProps) {
  const controller = useController(),
    busy = useSnapshot().busy,
    [draft, setDraft] = useState<string>(),
    // Only a switch between reading and editing fades, not the first render.
    [switched, setSwitched] = useState(false),
    row = useRef<HTMLDivElement>(null),
    editing = draft !== undefined,
    canMove = movable && !editing,
    swap = switched ? " motion-swap" : "";

  useAnimatedHeight(row, editing);

  /** Starts editing with `text`, or stops with nothing. */
  const toggleEditing = (text?: string) => {
    setSwitched(true);
    setDraft(text);
  };

  const save = async () => {
    if (!draft?.trim()) return;

    const error = await controller.taskActions.editQueued(
      task,
      message.id,
      draft.trim(),
    );

    onError(error);
    if (!error) toggleEditing();
  };

  const remove = async () => {
    onError(await controller.taskActions.removeQueued(task, message.id));
  };

  const handleDragStart = (event: DragEvent<HTMLDivElement>) => {
    if (!canMove || busy) return;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", message.message);
    onDragStart();
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    onDragOver(event.clientY > box.top + box.height / 2);
  };

  const handleRowKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      !canMove ||
      event.target !== event.currentTarget ||
      !event.altKey ||
      (event.key !== "ArrowUp" && event.key !== "ArrowDown")
    ) {
      return;
    }

    event.preventDefault();
    if (busy) return;
    const offset = event.key === "ArrowUp" ? -1 : 1;

    controller.run(async () => {
      // Reordering can move the focused row out of the DOM and back.
      if (await onMove(offset)) row.current?.focus();
    });
  };

  const handleEditKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      toggleEditing();
    } else if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      controller.run(save);
    }
  };

  return (
    <div
      ref={row}
      className="chat-queue-item"
      data-message={message.id}
      data-dragging={dragging || undefined}
      data-drop={dropAt}
      draggable={canMove && !busy}
      // Stays focusable while busy, so a move in flight keeps focus.
      tabIndex={canMove ? 0 : undefined}
      aria-keyshortcuts={canMove ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={onDragEnd}
      onKeyDown={handleRowKeyDown}
    >
      {/* The slot folds with reordering, and the handle pops with movability. */}
      <Presence show={reorderable} as="span" variant="fold">
        <span className="chat-queue-grip">
          <Presence show={canMove} as="span" variant="pop">
            <Icon name="grip-vertical-double" size={10} />
          </Presence>
        </span>
      </Presence>
      {!editing ? (
        <p className={`chat-queue-text${swap}`}>
          {message.from === "parent" && (
            <span className="chat-queue-sender">Parent agent · </span>
          )}
          {message.message}
        </p>
      ) : (
        <textarea
          className={`chat-queue-edit${swap}`}
          aria-label="Queued message"
          value={draft}
          maxLength={20000}
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleEditKeyDown}
        />
      )}
      {/* Keyed so the other action set fades in after a switch. */}
      <div key={String(editing)} className={`chat-queue-actions${swap}`}>
        {!editing ? (
          <>
            {/* A steer the worker already has keeps its text. */}
            {!message.recorded && (
              <TooltipWrapper label="Edit">
                <Button
                  variant="ghost"
                  className="chat-queue-icon-button"
                  aria-label="Edit"
                  disabled={busy}
                  onClick={() => toggleEditing(message.message)}
                >
                  <Icon name="pencil-simple" size={10} />
                </Button>
              </TooltipWrapper>
            )}
            <TooltipWrapper label="Remove">
              <Button
                variant="ghost"
                className="chat-queue-icon-button"
                aria-label="Remove"
                disabled={busy}
                onClick={() => controller.run(remove)}
              >
                <Icon name="close" size={10} />
              </Button>
            </TooltipWrapper>
          </>
        ) : (
          <>
            <TooltipWrapper label="Save">
              <Button
                variant="ghost"
                className="chat-queue-icon-button"
                aria-label="Save"
                disabled={busy}
                onClick={() => controller.run(save)}
              >
                <Icon name="check" size={10} />
              </Button>
            </TooltipWrapper>
            <TooltipWrapper label="Cancel">
              <Button
                variant="ghost"
                className="chat-queue-icon-button"
                aria-label="Cancel"
                onClick={() => toggleEditing()}
              >
                <Icon name="minus" size={10} />
              </Button>
            </TooltipWrapper>
          </>
        )}
      </div>
    </div>
  );
}
