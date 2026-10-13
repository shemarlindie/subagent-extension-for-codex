import { conversation } from "../../../../shared/tasks/conversation/messages";
import type { Task } from "../../../app/state/types";
import type { UserDateTimePreferences } from "../../../shared/utils/user-date-time";
import { ChatMessageView } from "../chat/timeline/chat-message-view";
import { ActivityTime } from "./activity-time";
import { TimelineDot, TimelineItem } from "./timeline";

type TaskRequestActivityProps = {
  task: Task;
  last: boolean;
  preferences?: UserDateTimePreferences;
};

/** The initial request is task data, not a provider event with a raw response. */
export function TaskRequestActivity({
  task,
  last,
  preferences,
}: TaskRequestActivityProps) {
  const message = conversation(task, [])[0];

  return (
    <TimelineItem
      render={<article />}
      first
      last={last}
      className="activity-group activity-request"
      data-activity-id={`activity-${task.id}-request`}
    >
      <div className="activity-group-heading">
        <TimelineDot />
        <span className="activity-group-title">
          <strong>Initial request</strong>
        </span>
        <ActivityTime timestamp={task.created_at} preferences={preferences} />
      </div>
      <ChatMessageView message={message} worker="" />
    </TimelineItem>
  );
}
