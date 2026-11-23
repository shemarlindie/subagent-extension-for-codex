import { memo, useRef } from "react";

import type { ChatVisual } from "../../../../../shared/tasks/conversation/chat.js";
import { useAnimatedHeight } from "../../../../shared/components/motion/use-animated-height";
import { VisualFrame } from "./visual-frame";
import { VisualMenu } from "./visual-menu";

type ChatVisualRowProps = {
  item: ChatVisual;
  /** Expands a new row into a conversation that is already showing. */
  arriving?: boolean;
};

/** A visual the worker showed, across Chat's width. */
export const ChatVisualRow = memo(function ChatVisualRow({
  item,
  arriving,
}: ChatVisualRowProps) {
  const ref = useRef<HTMLElement>(null);
  useAnimatedHeight(ref, item.id, arriving);

  return (
    <article
      ref={ref}
      className="chat-message"
      data-from="worker"
      data-kind="visual"
      data-chat-item={item.id}
      aria-label={`Visual: ${item.title}`}
    >
      <VisualFrame title={item.title} code={item.code} />
      <VisualMenu item={item} />
    </article>
  );
});
