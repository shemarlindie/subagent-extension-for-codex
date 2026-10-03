import { Tabs } from "@base-ui/react/tabs";
import type { Task, Tab } from "../core/types";
import { useController, useSnapshot } from "./controller-context";
import { ResultReport } from "./result-report";
import { EventList } from "./event-list";
import { ArtifactList } from "./artifact-list";
export function EvidenceTabs({ task }: { task: Task }) {
  const controller = useController(),
    state = useSnapshot();
  return (
    <Tabs.Root
      value={state.tab}
      onValueChange={(tab) => controller.setTab(tab as Tab)}
    >
      <Tabs.List activateOnFocus className="tabs" aria-label="Task evidence">
        <Tabs.Tab value="result" id="tab-result">
          Result
        </Tabs.Tab>
        <Tabs.Tab value="changes" id="tab-changes">
          Artifacts ({state.artifacts.length})
        </Tabs.Tab>
        <Tabs.Tab value="activity" id="tab-activity">
          Activity ({state.events.length})
        </Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="result">
        <ResultReport result={task.result} />
      </Tabs.Panel>
      <Tabs.Panel value="changes">
        <ArtifactList />
      </Tabs.Panel>
      <Tabs.Panel value="activity">
        <EventList events={state.events} task={task} />
      </Tabs.Panel>
    </Tabs.Root>
  );
}
