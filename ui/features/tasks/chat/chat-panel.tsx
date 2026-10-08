import type { Task } from "../../../shared/state/types";
import { ChatTimeline } from "./chat-timeline";
import { Composer } from "./composer";
import { MessageQueue } from "./message-queue";

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
