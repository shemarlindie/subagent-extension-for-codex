import type { Task } from "../../../app/state/types";
import { Composer } from "./composer/composer";
import { MessageQueue } from "./queue/message-queue";
import { ChatTimeline } from "./timeline/chat-timeline";

type ChatPanelProps = { task: Task };

/** The task as a conversation, with the composer always at the bottom. */
export function ChatPanel({ task }: ChatPanelProps) {
  return (
    <div className="chat">
      <ChatTimeline task={task} />
      <div className="chat-footer">
        <MessageQueue task={task} />
        {/* Keyed so budget edits and errors stay with their task. */}
        <Composer key={task.id} task={task} />
      </div>
    </div>
  );
}
