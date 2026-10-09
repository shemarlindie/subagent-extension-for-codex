import { useSnapshot } from "../../../app/state/controller-context";
import { useSessionState } from "../../../app/state/session/use-session-state";
import type { Task } from "../../../app/state/types";
import { Icon } from "../../../shared/components/icons/icons";
import { Presence } from "../../../shared/components/motion/motion";
import { Composer } from "./composer/composer";
import { MessageQueue } from "./queue/message-queue";
import { ChatTimeline } from "./timeline/chat-timeline";
import { useChatScroll } from "./timeline/use-chat-scroll";

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

  const { viewportRef, pinned, scrollToLatest } = useChatScroll(
    reading,
    state.tab === "chat",
    ready,
  );

  return (
    <div className="chat">
      <ChatTimeline task={task} viewportRef={viewportRef} />
      <div className="chat-footer">
        {/* Never replace a saved reading position with the empty loading layout. */}
        <Presence show={ready && !pinned} variant="pop">
          <button
            type="button"
            className="chat-scroll-latest"
            aria-label="Scroll to latest message"
            title="Scroll to latest message"
            onClick={scrollToLatest}
          >
            <Icon name="chevron-down" size={12} />
          </button>
        </Presence>
        <MessageQueue task={task} />
        {/* Keyed so budget edits and errors stay with their task. */}
        <Composer key={task.id} task={task} />
      </div>
    </div>
  );
}
