import { ContextMenu } from "@base-ui/react/context-menu";
import type { ReactElement, ReactNode, RefObject } from "react";

import type { useTaskSelection } from "./use-task-selection";

type TaskSelectionMenuProps = {
  selection: ReturnType<typeof useTaskSelection>;
  /** How many rows the list shows, which "Select all shown" picks. */
  shown: number;
  /** The list, which opens the menu anywhere, group headers included. */
  render: ReactElement;
  /** The list header's count, which keeps focus once changed rows leave. */
  count: RefObject<HTMLElement | null>;
  children: ReactNode;
};

/**
 * Right-clicking or long-pressing the list while selecting offers the actions
 * for the selection. Like Finder, a row outside the selection joins it first.
 */
export function TaskSelectionMenu({
  selection,
  shown,
  render,
  count,
  children,
}: TaskSelectionMenuProps) {
  const {
    ids,
    blocked,
    shownCount,
    archiveCount,
    readCount,
    unreadCount,
    apply,
    toggleShown,
  } = selection;

  const allShownSelected = shown > 0 && shownCount === shown;

  const joinRow = (
    open: boolean,
    details: ContextMenu.Root.ChangeEventDetails,
  ) => {
    if (!open) return;

    const target = details.event.target;

    const id =
      target instanceof Element
        ? target.closest<HTMLElement>("[data-task]")?.dataset.task
        : undefined;

    if (id && !ids?.has(id)) selection.clickRow(id, "toggle");
  };

  return (
    <ContextMenu.Root disabled={!ids || blocked} onOpenChange={joinRow}>
      <ContextMenu.Trigger render={render}>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner className="menu-positioner">
          <ContextMenu.Popup
            className="menu-popup"
            // An action can take rows off the list, such as reading under Unread.
            finalFocus={blocked ? count : undefined}
          >
            <ContextMenu.Item
              className="menu-item"
              disabled={!archiveCount}
              onClick={() => void apply("archive")}
            >
              Archive{archiveCount ? ` (${archiveCount})` : ""}
            </ContextMenu.Item>
            <ContextMenu.Item
              className="menu-item"
              disabled={!readCount}
              onClick={() => void apply("read")}
            >
              Mark read{readCount ? ` (${readCount})` : ""}
            </ContextMenu.Item>
            <ContextMenu.Item
              className="menu-item"
              disabled={!unreadCount}
              onClick={() => void apply("unread")}
            >
              Mark unread{unreadCount ? ` (${unreadCount})` : ""}
            </ContextMenu.Item>
            <ContextMenu.Separator className="menu-separator" />
            <ContextMenu.Item
              className="menu-item"
              disabled={!shown}
              onClick={() => toggleShown(!allShownSelected)}
            >
              {allShownSelected ? "Deselect shown" : "Select all shown"}
            </ContextMenu.Item>
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
