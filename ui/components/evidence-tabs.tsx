import { Tabs } from "@base-ui/react/tabs";
import type { Task, Tab } from "../core/types";
import { useController, useSnapshot } from "./controller-context";
import { ResultReport } from "./result-report";
import { EventList } from "./event-list";
import { ArtifactList } from "./artifact-list";
import { TaskDetails } from "./task-details";
export function EvidenceTabs({ task }: { task: Task }) {
  const controller = useController(),
    state = useSnapshot();
  return (
    <Tabs.Root
      className="evidence"
      value={state.tab}
      onValueChange={(tab) => controller.setTab(tab as Tab)}
    >
      <Tabs.List activateOnFocus className="tabs" aria-label="Task evidence">
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
        <EventList events={state.events} active={state.tab === "activity"} />
      </Tabs.Panel>
      <Tabs.Panel value="details">
        <TaskDetails task={task} />
      </Tabs.Panel>
    </Tabs.Root>
  );
}
