import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import {
  Group,
  type Layout,
  type LayoutChangedMeta,
  Panel,
  Separator,
  usePanelRef,
} from "react-resizable-panels";

import { canAnimate, MOTION } from "../shared/components/motion/motion-utils";

const DEFAULT_WIDTH = 245;
const MIN_RAIL_WIDTH = 220;
const MAX_RAIL_WIDTH = 480;
const MIN_INSPECTOR_WIDTH = 320;
const STORAGE_KEY = "dw_task_list_width";
const COLLAPSED_KEY = "dw_task_list_collapsed";
const PANEL_STYLE = { overflow: "hidden" } as const;

function storedWidth() {
  try {
    const width = Number(localStorage.getItem(STORAGE_KEY));

    return Number.isFinite(width) && width >= MIN_RAIL_WIDTH
      ? Math.min(width, MAX_RAIL_WIDTH)
      : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

function saveWidth(width: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(width));
  } catch {
    // Resizing remains available when browser storage is unavailable.
  }
}

function storedCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function saveCollapsed(collapsed: boolean) {
  try {
    if (collapsed) localStorage.setItem(COLLAPSED_KEY, "true");
    else localStorage.removeItem(COLLAPSED_KEY);
  } catch {
    // Collapsing remains available when browser storage is unavailable.
  }
}

/** Collapsed state for the task list, shared by the layout and the header toggle. */
export function useTaskRail() {
  const panelRef = usePanelRef();

  const [narrow, setNarrow] = useState(
    () => window.matchMedia("(max-width: 640px)").matches,
  );

  useEffect(() => {
    const media = window.matchMedia("(max-width: 640px)");
    const update = () => setNarrow(media.matches);

    media.addEventListener("change", update);

    return () => media.removeEventListener("change", update);
  }, []);

  const panelElementRef = useRef<HTMLDivElement>(null);
  const motionTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [collapsed, setCollapsedState] = useState(storedCollapsed);
  // The list's width while the toggle eases it open or closed.
  const [motionWidth, setMotionWidth] = useState<number>();

  useEffect(() => () => clearTimeout(motionTimer.current), []);

  function setCollapsed(value: boolean) {
    setCollapsedState(value);
    saveCollapsed(value);
  }

  function toggle() {
    const rail = panelRef.current;
    const element = panelElementRef.current;

    if (!rail) return;

    const opening = rail.isCollapsed();
    const width = opening ? storedWidth() : (element?.offsetWidth ?? 0);

    if (canAnimate(element)) {
      clearTimeout(motionTimer.current);
      // The transition must be on before the panel sizes change.
      flushSync(() => setMotionWidth(width));

      motionTimer.current = setTimeout(
        () => setMotionWidth(undefined),
        MOTION.base,
      );
    }

    // Reopen at the saved width, which the library cannot know after a reload.
    if (opening) rail.resize(width);
    else rail.collapse();
  }

  return {
    panelRef,
    narrow,
    panelElementRef,
    collapsed,
    setCollapsed,
    motionWidth,
    toggle,
  };
}

export type TaskRail = ReturnType<typeof useTaskRail>;

type TaskLayoutProps = {
  rail: TaskRail;
  list: ReactNode;
  inspector: ReactNode;
};

export function TaskLayout({ rail, list, inspector }: TaskLayoutProps) {
  const railRef = rail.panelRef;
  const groupElementRef = useRef<HTMLDivElement>(null);
  const separatorElementRef = useRef<HTMLDivElement>(null);
  const reopenOnClick = useRef(false);
  const [initialWidth] = useState(storedWidth);
  const [initiallyCollapsed] = useState(rail.collapsed);

  const { narrow } = rail;

  // Narrow panels switch between the list and a task, so they ignore collapsing.
  const railCollapsed = rail.collapsed && !narrow;

  const separatorTitle = rail.collapsed
    ? "Drag or click to show the task list"
    : "Drag or use arrow keys to resize the task list, or drag past its edge to hide it";

  function handleLayoutChanged(
    layout: Layout,
    { isUserInteraction }: LayoutChangedMeta,
  ) {
    const group = groupElementRef.current;
    const separator = separatorElementRef.current;

    const railPercent = layout["task-rail-panel"];

    // Narrow panels show one column, so their layout says nothing about the rail.
    if (narrow || railPercent === undefined) return;

    const collapsed = railPercent === 0;

    if (collapsed !== rail.collapsed) rail.setCollapsed(collapsed);

    // Collapsing keeps the width to reopen at.
    if (!isUserInteraction || collapsed || !group || !separator) return;

    // The callback runs before panel styles commit; use the new layout.
    const availableWidth = group.clientWidth - separator.offsetWidth;

    saveWidth((availableWidth * railPercent) / 100);
  }

  // A click that ends a collapsing drag must not reopen the list at once.
  function reopenFromEdge() {
    if (reopenOnClick.current && railRef.current?.isCollapsed()) rail.toggle();
  }

  // The library's Enter can't reopen at the saved width after a reload. The
  // capture phase runs first, and the library skips handled events.
  function toggleOnEnter(event: KeyboardEvent) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    rail.toggle();
  }

  function resetWidth() {
    railRef.current?.resize(DEFAULT_WIDTH);
    saveWidth(DEFAULT_WIDTH);
  }

  return (
    <Group
      className="shell"
      elementRef={groupElementRef}
      data-rail-motion={rail.motionWidth === undefined ? undefined : ""}
      disabled={narrow}
      disableCursor
      resizeTargetMinimumSize={{ fine: 8, coarse: 24 }}
      onLayoutChanged={handleLayoutChanged}
    >
      <Panel
        id="task-rail-panel"
        className="task-layout-panel"
        style={PANEL_STYLE}
        panelRef={railRef}
        elementRef={rail.panelElementRef}
        defaultSize={initiallyCollapsed ? 0 : initialWidth}
        minSize={MIN_RAIL_WIDTH}
        collapsible
        maxSize={MAX_RAIL_WIDTH}
        groupResizeBehavior="preserve-pixel-size"
      >
        <aside
          id="task-rail"
          aria-label="Delegated tasks"
          // Stays visible while it eases closed, but out of reach.
          hidden={railCollapsed && rail.motionWidth === undefined}
          inert={railCollapsed}
          // Keeps its width while its panel clips it, so rows don't rewrap.
          style={{ minWidth: rail.motionWidth }}
        >
          {list}
        </aside>
      </Panel>
      <Separator
        className="task-list-resizer"
        elementRef={separatorElementRef}
        aria-label="Resize task list"
        title={separatorTitle}
        disableDoubleClick
        onDoubleClick={resetWidth}
        onPointerDown={() => {
          reopenOnClick.current = Boolean(railRef.current?.isCollapsed());
        }}
        onClick={reopenFromEdge}
        onKeyDownCapture={toggleOnEnter}
      >
        <svg
          className="task-list-resizer-grip"
          viewBox="0 0 4 24"
          aria-hidden="true"
          focusable="false"
        >
          <circle cx="1.5" cy="7" r="0.8" />
          <circle cx="1.5" cy="12" r="0.8" />
          <circle cx="1.5" cy="17" r="0.8" />
        </svg>
      </Separator>
      <Panel
        id="task-inspector-panel"
        className="task-layout-panel"
        style={PANEL_STYLE}
        minSize={narrow ? 0 : MIN_INSPECTOR_WIDTH}
      >
        {inspector}
      </Panel>
    </Group>
  );
}
