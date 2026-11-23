import { memo, useCallback, useRef, useState, type CSSProperties } from "react";

import type { ChatVisual } from "../../../../../shared/tasks/conversation/chat.js";
import { useAnimatedHeight } from "../../../../shared/components/motion/use-animated-height";
import { VisualFrame } from "./visual-frame";
import { VisualMenu } from "./visual-menu";

type ChatVisualRowProps = {
  item: ChatVisual;
  /** Expands a new row into a conversation that is already showing. */
  arriving?: boolean;
};

/** The width a version of a visual reported for its lone element. */
type Fit = { code: string; width: number };

/**
 * A visual the worker showed, in a card across Chat's width. A lone element
 * that draws narrower than Chat fits the card to its width. The card keeps that
 * width while the element fills a narrower Chat, so it can grow back, and a new
 * version measures again.
 */
export const ChatVisualRow = memo(function ChatVisualRow({
  item,
  arriving,
}: ChatVisualRowProps) {
  const ref = useRef<HTMLElement>(null);
  const { code } = item;
  const [fit, setFit] = useState<Fit>();

  const onWidth = useCallback(
    (width: number) => setFit({ code, width }),
    [code],
  );

  const width = fit?.code === code ? fit.width : undefined;
  useAnimatedHeight(ref, item.id, arriving);

  return (
    <article
      ref={ref}
      className="chat-message"
      data-from="worker"
      data-kind="visual"
      data-chat-item={item.id}
      aria-label={`Visual: ${item.title}`}
      style={
        width
          ? ({ "--visual-width": `${width}px` } as CSSProperties)
          : undefined
      }
    >
      <VisualFrame title={item.title} code={code} onWidth={onWidth} />
      <VisualMenu item={item} />
    </article>
  );
});
