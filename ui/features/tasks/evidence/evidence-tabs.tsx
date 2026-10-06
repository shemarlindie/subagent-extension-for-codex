import { Tabs } from "@base-ui/react/tabs";
import { useEffect, useRef } from "react";

import { MotionContent } from "../../../shared/components/motion";
import { scrollChildIntoView } from "../../../shared/components/scroll-into-view";
import {
  useController,
  useSnapshot,
} from "../../../shared/state/controller-context";
import type { Tab, Task } from "../../../shared/state/types";
import { ChangesPanel } from "../../changes/changes-panel";
import { EventList } from "../activity/event-list";
import { TaskDetails } from "../inspector/task-details";
import { ResultReport } from "./result-report";

const TAB_EDGE_GAP = 12;

// The tab list scrolls sideways on narrow panels, so the selected tab can sit off-screen
// (selection can also come from outside, such as the host selecting a task).
// Only the list scrolls, never the page, so the inspector doesn't jump.
function useActiveTabInView(tab: Tab) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const list = listRef.current,
      // By id rather than aria-selected, which can still show the previous tab here.
      active = list?.querySelector<HTMLElement>(`#tab-${tab}`);

    if (list && active) scrollChildIntoView(list, active, TAB_EDGE_GAP);
  }, [tab]);

  return listRef;
}

// A changed count rises into place so new evidence is noticed without moving the tabs.
function TabCount({ value }: { value: number }) {
  return (
    <span className="tab-count">
      <MotionContent changeKey={value} variant="rise">
        {value}
      </MotionContent>
    </span>
  );
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
          Changes
        </Tabs.Tab>
        <Tabs.Tab value="activity" id="tab-activity">
          Activity <TabCount value={state.events.length} />
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
        <ChangesPanel task={task} />
      </Tabs.Panel>
      {/* Stays mounted so the reading position survives tab switches. */}
      <Tabs.Panel value="activity" className="activity-panel" keepMounted>
        <EventList
          events={state.events}
          runtimeMs={task.runtime_ms}
          dropped={state.droppedEvents}
          active={state.tab === "activity"}
          running={task.status === "running" && !task.pending_input}
        />
      </Tabs.Panel>
      <Tabs.Panel value="details">
        <TaskDetails
          task={task}
          changes={state.changes?.task === task.id ? state.changes : undefined}
        />
      </Tabs.Panel>
    </Tabs.Root>
  );
}
