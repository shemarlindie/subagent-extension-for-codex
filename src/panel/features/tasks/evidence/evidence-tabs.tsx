import { Tabs } from "@base-ui/react/tabs";
import { useMemo } from "react";

import {
  useController,
  useSnapshot,
} from "../../../app/state/controller-context";
import { useSessionState } from "../../../app/state/session/use-session-state";
import type { Tab, Task } from "../../../app/state/types";
import { LoadingSwap } from "../../../shared/components/loading-skeleton/loading-swap";
import { TabList } from "../../../shared/components/tabs/tab-list";
import { useActiveTabInView } from "../../../shared/components/tabs/use-active-tab-in-view";
import { ChangesPanel } from "../../changes/changes-panel";
import { ActivitySkeleton } from "../activity/activity-skeleton";
import { turnStart } from "../activity/event-history";
import { EventList } from "../activity/event-list";
import { TurnActivityBanner } from "../activity/turn-activity-banner";
import { ChatPanel } from "../chat/chat-panel";
import { TaskDetails } from "../inspector/task-details";
import { TabLabel } from "./tab-label";

type EvidenceTabsProps = { task?: Task; taskId: string };

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
  let focusEventId: number | undefined;

  if (focus && range) {
    if (range !== "loading") focusEventId = range.events[0]?.id;
  } else if (focus) {
    focusEventId = turnStart(
      { events: state.events, dropped: state.droppedEvents },
      focus.turn,
    );
  }

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

  // The focused turn's events, or a loading placeholder for them; without focus, the whole activity log.
  const renderActivityEvents = () => {
    if (!task) return null;

    if (!focus || !range) {
      if (activityLoading) return null;

      return (
        <EventList
          task={task}
          reading={reading}
          events={state.events}
          runtimeMs={task.runtime_ms}
          dropped={state.droppedEvents}
          preferences={state.host}
          active={state.tab === "activity"}
          running={task.status === "running" && !task.pending_input}
          focus={rowFocus}
        />
      );
    }

    if (range === "loading") {
      return (
        <EventList
          task={task}
          reading={reading}
          events={state.events}
          runtimeMs={task.runtime_ms}
          dropped={state.droppedEvents}
          preferences={state.host}
          active={false}
        />
      );
    }

    return (
      <EventList
        task={task}
        key={focus.request}
        turn={focus.turn}
        events={range.events}
        dropped={range.dropped}
        runtimeMs={task.runtime_ms}
        preferences={state.host}
        active={state.tab === "activity"}
        focus={rowFocus}
      />
    );
  };

  return (
    <Tabs.Root
      className="evidence"
      value={state.tab}
      onValueChange={(tab) => controller.setTab(tab as Tab)}
    >
      <TabList ref={listRef} label="Task evidence">
        <Tabs.Tab value="chat" id="tab-chat">
          Chat
        </Tabs.Tab>
        <Tabs.Tab value="activity" id="tab-activity">
          Activity
        </Tabs.Tab>
        <Tabs.Tab value="changes" id="tab-changes">
          <TabLabel count={counts?.data?.files ?? 0}>Changes</TabLabel>
        </Tabs.Tab>
        <Tabs.Tab value="details" id="tab-details">
          Details
        </Tabs.Tab>
      </TabList>
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
            {renderActivityEvents()}
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
        <TaskDetails task={task} counts={counts} preferences={state.host} />
      </Tabs.Panel>
    </Tabs.Root>
  );
}
