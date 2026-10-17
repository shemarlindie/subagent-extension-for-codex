// Public registry for synthetic and recorded panel preview scenarios.
import { decodedEvent } from "../../../src/shared/events/decode";
import type { Event } from "../../../src/shared/events/types";
import type { Task } from "../../../src/shared/tasks/model";
import recordedMcp from "../recorded/mcp.json";
import recordedResume from "../recorded/resume.json";
import recordedSteer from "../recorded/steer.json";
import recordedStream from "../recorded/stream.json";
import type { RecordedFixture } from "../recording/recording";
import { activityTasks, activityTimelines } from "./activity-scenarios";
import {
  conversationTasks,
  conversationTimelines,
} from "./conversation-scenarios";
import { editLogTask, editLogTimeline } from "./edit-log-scenarios";
import { inputTasks, inputTimelines } from "./input-scenarios";
import { lifecycleTasks, lifecycleTimelines } from "./lifecycle-scenarios";
import { liveTasks, liveTimelines, statusTasks } from "./live-scenarios";

export { previewLiveStatus, previewStreamingDraft } from "./live-scenarios";
export { PREVIEW_THREAD, previewProjects } from "./scenario-context";

/**
 * Tasks recorded from real Claude runs and sanitized by `npm run
 * fixture:record` (dev/panel/recording/record-fixture.ts). Their SDK messages are
 * real, so the replay test checks them like the built ones.
 */
const recordedFixtures = [
  recordedSteer,
  recordedStream,
  recordedResume,
  recordedMcp,
] as unknown as RecordedFixture[];

const tasksById = new Map(
  [
    ...activityTasks,
    ...lifecycleTasks,
    ...inputTasks,
    ...conversationTasks,
    ...liveTasks,
  ].map((task) => [task.id, task]),
);

export const previewTasks: Task[] = [
  "preview-audit",
  "preview-failed",
  "preview-question",
  "preview-stacked-questions",
  "preview-refactor",
  "preview-release",
  "preview-queued",
  "preview-starting",
  "preview-blocks",
  "preview-input",
  "preview-interrupted",
  "preview-dependent",
  "preview-signals",
  "preview-long",
  "preview-many-turns",
  "preview-build",
  "preview-profile",
  "preview-resumed",
  "preview-steering",
  "preview-paused",
  "preview-conversation",
  "preview-budget",
  "preview-runtime-budget",
  "preview-long-chat",
  "preview-live-streaming",
]
  .map((id) => tasksById.get(id)!)
  .concat(
    editLogTask,
    statusTasks,
    recordedFixtures.map((recorded) => recorded.task),
  );

const timelinesById = new Map(
  [
    ...activityTimelines,
    ...lifecycleTimelines,
    ...inputTimelines,
    ...conversationTimelines,
    ...liveTimelines,
  ].map((timeline) => [timeline.taskId, timeline]),
);

export const previewEvents: Event[] = [
  ...editLogTimeline.events,
  ...[
    "preview-audit",
    "preview-failed",
    "preview-question",
    "preview-stacked-questions",
    "preview-refactor",
    "preview-release",
    "preview-blocks",
    "preview-signals",
    "preview-long",
    "preview-many-turns",
    "preview-interrupted",
    "preview-input",
    "preview-dependent",
    "preview-build",
    "preview-profile",
    "preview-resumed",
    "preview-steering",
    "preview-paused",
    "preview-conversation",
    "preview-budget",
    "preview-runtime-budget",
    "preview-long-chat",
    "preview-live-streaming",
  ].flatMap((id) => timelinesById.get(id)!.events),
  ...liveTimelines
    .filter((timeline) => timeline.taskId !== "preview-live-streaming")
    .flatMap((timeline) => timeline.events),
  ...recordedFixtures.flatMap((recorded) => recorded.events),
].map(decodedEvent);
