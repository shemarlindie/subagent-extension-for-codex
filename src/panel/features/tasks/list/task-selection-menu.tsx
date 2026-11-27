import { ContextMenu } from "@base-ui/react/context-menu";
import {
  useRef,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";

import type { SelectionAction, useTaskSelection } from "./use-task-selection";

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

  // An action can take rows off the list, such as reading under Unread, so
  // focus moves to the count. The action may finish before the menu closes.
  const acted = useRef(false);

  const act = (action: SelectionAction) => {
    acted.current = true;
    void apply(action);
  };

  const finalFocus = () => {
    const target = acted.current ? count.current : true;
    acted.current = false;

    return target;
  };

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
          <ContextMenu.Popup className="menu-popup" finalFocus={finalFocus}>
            <ContextMenu.Item
              className="menu-item"
              disabled={!archiveCount}
              onClick={() => act("archive")}
            >
              Archive{archiveCount ? ` (${archiveCount})` : ""}
            </ContextMenu.Item>
            <ContextMenu.Item
              className="menu-item"
              disabled={!readCount}
              onClick={() => act("read")}
            >
              Mark read{readCount ? ` (${readCount})` : ""}
            </ContextMenu.Item>
            <ContextMenu.Item
              className="menu-item"
              disabled={!unreadCount}
              onClick={() => act("unread")}
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
