import { Tabs } from "@base-ui/react/tabs";
import { useEffect, useRef } from "react";

import {
  useController,
  useSnapshot,
} from "../../../app/state/controller-context";
import { useSessionState } from "../../../app/state/session/use-session-state";
import type { Tab, Task } from "../../../app/state/types";
import { MotionContent } from "../../../shared/components/motion/motion";
import { scrollChildIntoView } from "../../../shared/utils/scroll-into-view";
import { ChangesPanel } from "../../changes/changes-panel";
import { EventList } from "../activity/event-list";
import { ChatPanel } from "../chat/chat-panel";
import { TaskDetails } from "../inspector/task-details";

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
    [reading] = useSessionState(
      "task",
      task.id,
      (state) => state.reading.activity,
    ),
    listRef = useActiveTabInView(state.tab),
    changes = state.changes?.task === task.id ? state.changes : undefined;

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
        <Tabs.Tab value="chat" id="tab-chat">
          Chat
        </Tabs.Tab>
        <Tabs.Tab value="changes" id="tab-changes">
          Changes
          {/* Changes are read only while Changes or Details is open, so the count waits for that read. */}
          {changes?.data && (
            <>
              {" "}
              <TabCount value={changes.data.files.length} />
            </>
          )}
        </Tabs.Tab>
        <Tabs.Tab value="activity" id="tab-activity">
          Activity <TabCount value={state.events.length} />
        </Tabs.Tab>
        <Tabs.Tab value="details" id="tab-details">
          Details
        </Tabs.Tab>
        <Tabs.Indicator className="tab-indicator" />
      </Tabs.List>
      {/* Stays mounted so the reading position and draft survive tab switches. */}
      <Tabs.Panel value="chat" className="chat-panel" keepMounted>
        <ChatPanel task={task} />
      </Tabs.Panel>
      <Tabs.Panel value="changes">
        <ChangesPanel task={task} />
      </Tabs.Panel>
      {/* Stays mounted so the reading position survives tab switches. */}
      <Tabs.Panel value="activity" className="activity-panel" keepMounted>
        <EventList
          reading={reading}
          events={state.events}
          runtimeMs={task.runtime_ms}
          dropped={state.droppedEvents}
          active={state.tab === "activity"}
          running={task.status === "running" && !task.pending_input}
        />
      </Tabs.Panel>
      <Tabs.Panel value="details">
        <TaskDetails task={task} changes={changes} />
      </Tabs.Panel>
    </Tabs.Root>
  );
}
