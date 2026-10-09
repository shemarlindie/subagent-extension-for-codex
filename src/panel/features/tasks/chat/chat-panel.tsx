import { useSnapshot } from "../../../app/state/controller-context";
import { useSessionState } from "../../../app/state/session/use-session-state";
import type { Task } from "../../../app/state/types";
import { ScrollLatestButton } from "../../../shared/components/scroll-latest-button/scroll-latest-button";
import { useReadingScroll } from "../evidence/use-reading-scroll";
import { Composer } from "./composer/composer";
import { MessageQueue } from "./queue/message-queue";
import { ChatTimeline } from "./timeline/chat-timeline";

type ChatPanelProps = { task: Task };

/** The task as a conversation, with the composer always at the bottom. */
export function ChatPanel({ task }: ChatPanelProps) {
  const state = useSnapshot();
  const ready = state.chat?.task === task.id;

  const [reading] = useSessionState(
    "task",
    task.id,
    (state) => state.reading.chat,
  );

  const { viewportRef, pinned, scrollToLatest } = useReadingScroll({
    reading,
    active: state.tab === "chat",
    ready,
    itemAttribute: "data-chat-item",
  });

  return (
    <div className="chat">
      <ChatTimeline task={task} viewportRef={viewportRef} />
      <div className="chat-footer">
        {/* Never replace a saved reading position with the empty loading layout. */}
        <ScrollLatestButton
          show={ready && !pinned}
          direction="down"
          label="Scroll to latest message"
          className="chat-scroll-latest"
          onClick={scrollToLatest}
        />
        <MessageQueue task={task} />
        {/* Keyed so budget edits and errors stay with their task. */}
        <Composer key={task.id} task={task} />
      </div>
    </div>
  );
}
