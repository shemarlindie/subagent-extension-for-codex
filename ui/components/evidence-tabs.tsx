import { useEffect, useRef } from "react";
import { Tabs } from "@base-ui/react/tabs";
import type { Task, Tab } from "../core/types";
import { useController, useSnapshot } from "./controller-context";
import { ResultReport } from "./result-report";
import { EventList } from "./event-list";
import { ArtifactList } from "./artifact-list";
import { TaskDetails } from "./task-details";
const TAB_EDGE_GAP = 12;

// The tab list scrolls sideways on narrow panels, so the selected tab can sit off-screen
// (selection can also come from outside, such as a link to the Changes tab).
// Only the list scrolls, never the page, so the inspector doesn't jump.
function useActiveTabInView(tab: Tab) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = listRef.current,
      // By id rather than aria-selected, which can still show the previous tab here.
      active = list?.querySelector<HTMLElement>(`#tab-${tab}`);
    if (!list || !active) return;
    const left = active.offsetLeft - TAB_EDGE_GAP,
      right = active.offsetLeft + active.offsetWidth + TAB_EDGE_GAP;
    const target =
      left < list.scrollLeft
        ? left
        : right > list.scrollLeft + list.clientWidth
          ? right - list.clientWidth
          : undefined;
    if (target !== undefined)
      list.scrollTo?.({
        left: Math.max(0, target),
        behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)")
          .matches
          ? "auto"
          : "smooth",
      });
  }, [tab]);
  return listRef;
}
export function EvidenceTabs({ task }: { task: Task }) {
  const controller = useController(),
    state = useSnapshot(),
    listRef = useActiveTabInView(state.tab);
  return (
    <Tabs.Root
      className="evidence"
      value={state.tab}
      onValueChange={(tab) => controller.setTab(tab as Tab)}
    >
      <Tabs.List
        ref={listRef}
        activateOnFocus
        className="tabs"
        aria-label="Task evidence"
      >
        <Tabs.Tab value="result" id="tab-result">
          Result
        </Tabs.Tab>
        <Tabs.Tab value="changes" id="tab-changes">
          Artifacts <span className="tab-count">{state.artifacts.length}</span>
        </Tabs.Tab>
        <Tabs.Tab value="activity" id="tab-activity">
          Activity <span className="tab-count">{state.events.length}</span>
        </Tabs.Tab>
        <Tabs.Tab value="details" id="tab-details">
          Details
        </Tabs.Tab>
        <Tabs.Indicator className="tab-indicator" />
      </Tabs.List>
      <Tabs.Panel value="result">
        <ResultReport result={task.result} />
      </Tabs.Panel>
      <Tabs.Panel value="changes">
        <ArtifactList />
      </Tabs.Panel>
      {/* Stays mounted so the reading position survives tab switches. */}
      <Tabs.Panel value="activity" className="activity-panel" keepMounted>
        <EventList
          events={state.events}
          active={state.tab === "activity"}
          running={task.status === "running" && !task.pending_input}
        />
      </Tabs.Panel>
      <Tabs.Panel value="details">
        <TaskDetails task={task} />
      </Tabs.Panel>
    </Tabs.Root>
  );
}
