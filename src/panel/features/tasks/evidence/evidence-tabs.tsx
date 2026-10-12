import { Tabs } from "@base-ui/react/tabs";
import { useEffect, useMemo, useRef } from "react";

import {
  useController,
  useSnapshot,
} from "../../../app/state/controller-context";
import { useSessionState } from "../../../app/state/session/use-session-state";
import type { Tab, Task } from "../../../app/state/types";
import { LoadingSwap } from "../../../shared/components/loading-skeleton/loading-swap";
import { scrollChildIntoView } from "../../../shared/utils/scroll-into-view";
import { ChangesPanel } from "../../changes/changes-panel";
import { ActivitySkeleton } from "../activity/activity-skeleton";
import { turnStart } from "../activity/event-history";
import { EventList } from "../activity/event-list";
import { TurnActivityBanner } from "../activity/turn-activity-banner";
import { ChatPanel } from "../chat/chat-panel";
import { TaskDetails } from "../inspector/task-details";
import { TabLabel } from "./tab-label";

const TAB_EDGE_GAP = 12;

type EvidenceTabsProps = { task?: Task; taskId: string };

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

/** Keeps one tab shell mounted while only its header or content changes with data. */
export function EvidenceTabs({ task, taskId }: EvidenceTabsProps) {
  const controller = useController(),
    state = useSnapshot(),
    [reading] = useSessionState(
      "task",
      taskId,
      (state) => state.reading.activity,
    ),
    listRef = useActiveTabInView(state.tab),
    counts =
      task && state.changeCounts?.task === task.id
        ? state.changeCounts
        : undefined,
    focus =
      task && state.activityFocus?.task === task.id
        ? state.activityFocus
        : undefined,
    range = focus?.range;

  // A turn the latest activity holds scrolls into view there; a turn read on
  // its own opens at its first row. Stable objects keep the list memoized.
  const focusEventId = !focus
    ? undefined
    : range
      ? range === "loading"
        ? undefined
        : range.events[0]?.id
      : turnStart(
          { events: state.events, dropped: state.droppedEvents },
          focus.turn,
        );

  const request = focus?.request;

  const activityLoading =
    !task ||
    (state.activityHistoryLoading === task.id &&
      !state.events.some((event) => event.task_id === task.id));

  const activityBusy = activityLoading || range === "loading";

  const rowFocus = useMemo(
    () =>
      focusEventId === undefined || request === undefined
        ? undefined
        : { eventId: focusEventId, request },
    [focusEventId, request],
  );

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
          <TabLabel count={counts?.data?.files ?? 0}>Changes</TabLabel>
        </Tabs.Tab>
        <Tabs.Tab value="activity" id="tab-activity">
          Activity
        </Tabs.Tab>
        <Tabs.Tab value="details" id="tab-details">
          Details
        </Tabs.Tab>
        <Tabs.Indicator className="tab-indicator" />
      </Tabs.List>
      {/* Stays mounted so the reading position and draft survive tab switches. */}
      <Tabs.Panel
        value="chat"
        className="chat-panel"
        keepMounted
        aria-busy={!task || state.chatHistoryLoading === task.id || undefined}
      >
        <ChatPanel task={task} taskId={taskId} />
      </Tabs.Panel>
      <Tabs.Panel value="changes">
        <ChangesPanel task={task} taskId={taskId} />
      </Tabs.Panel>
      {/* Stays mounted so the reading position survives tab switches. */}
      <Tabs.Panel
        value="activity"
        className="activity-panel"
        keepMounted
        aria-busy={activityBusy || undefined}
      >
        <div className="activity-content">
          {task && focus && range && (
            <TurnActivityBanner
              turn={focus.turn}
              loading={range === "loading"}
              onShowLatest={() => controller.showLatestActivity()}
            />
          )}
          <LoadingSwap
            loading={activityBusy}
            busy={false}
            skeleton={
              <ActivitySkeleton announce={!(focus && range === "loading")} />
            }
          >
            {task ? (
              focus && range ? (
                range === "loading" ? (
                  <EventList
                    reading={reading}
                    events={state.events}
                    runtimeMs={task.runtime_ms}
                    dropped={state.droppedEvents}
                    preferences={state.host}
                    active={false}
                  />
                ) : (
                  <EventList
                    key={focus.request}
                    turn={focus.turn}
                    events={range.events}
                    dropped={range.dropped}
                    runtimeMs={task.runtime_ms}
                    preferences={state.host}
                    active={state.tab === "activity"}
                    focus={rowFocus}
                  />
                )
              ) : activityLoading ? null : (
                <EventList
                  reading={reading}
                  events={state.events}
                  runtimeMs={task.runtime_ms}
                  dropped={state.droppedEvents}
                  preferences={state.host}
                  active={state.tab === "activity"}
                  running={task.status === "running" && !task.pending_input}
                  focus={rowFocus}
                />
              )
            ) : null}
          </LoadingSwap>
        </div>
      </Tabs.Panel>
      <Tabs.Panel
        value="details"
        aria-busy={
          (!task && state.tab === "details") ||
          (task && !counts?.data && !counts?.error) ||
          undefined
        }
      >
        <TaskDetails task={task} counts={counts} />
      </Tabs.Panel>
    </Tabs.Root>
  );
}
