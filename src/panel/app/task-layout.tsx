import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  Group,
  type Layout,
  type LayoutChangedMeta,
  Panel,
  Separator,
  usePanelRef,
} from "react-resizable-panels";

const DEFAULT_WIDTH = 245;
const MIN_RAIL_WIDTH = 220;
const MAX_RAIL_WIDTH = 480;
const MIN_INSPECTOR_WIDTH = 320;
const STORAGE_KEY = "dw_task_list_width";
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

type TaskLayoutProps = {
  list: ReactNode;
  inspector: ReactNode;
};

export function TaskLayout({ list, inspector }: TaskLayoutProps) {
  const railRef = usePanelRef();
  const groupElementRef = useRef<HTMLDivElement>(null);
  const separatorElementRef = useRef<HTMLDivElement>(null);
  const [initialWidth] = useState(storedWidth);

  const [narrow, setNarrow] = useState(
    () => window.matchMedia("(max-width: 640px)").matches,
  );

  useEffect(() => {
    const media = window.matchMedia("(max-width: 640px)");
    const update = () => setNarrow(media.matches);

    media.addEventListener("change", update);

    return () => media.removeEventListener("change", update);
  }, []);

  function handleLayoutChanged(
    layout: Layout,
    { isUserInteraction }: LayoutChangedMeta,
  ) {
    const group = groupElementRef.current;
    const separator = separatorElementRef.current;

    if (!isUserInteraction || narrow || !group || !separator) return;

    // The callback runs before panel styles commit; use the new layout.
    const availableWidth = group.clientWidth - separator.offsetWidth;

    saveWidth((availableWidth * layout["task-rail-panel"]) / 100);
  }

  function resetWidth() {
    railRef.current?.resize(DEFAULT_WIDTH);
    saveWidth(DEFAULT_WIDTH);
  }

  return (
    <Group
      className="shell"
      elementRef={groupElementRef}
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
        defaultSize={initialWidth}
        minSize={MIN_RAIL_WIDTH}
        maxSize={MAX_RAIL_WIDTH}
        groupResizeBehavior="preserve-pixel-size"
      >
        <aside id="task-rail" aria-label="Delegated tasks">
          {list}
        </aside>
      </Panel>
      <Separator
        className="task-list-resizer"
        elementRef={separatorElementRef}
        aria-label="Resize task list"
        title="Drag to resize task list; use arrow keys when focused"
        disableDoubleClick
        onDoubleClick={resetWidth}
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
