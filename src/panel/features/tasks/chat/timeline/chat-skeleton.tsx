import {
  LoadingSkeleton,
  SkeletonShape,
} from "../../../../shared/components/loading-skeleton/loading-skeleton";

type SkeletonLine = "long" | "medium" | "short";

type SkeletonMessage =
  | { side: "user"; size: "wide" | "narrow"; lines: readonly SkeletonLine[] }
  | { side: "worker"; lines: readonly SkeletonLine[] }
  | { side: "worker"; richMarkdown: true };

// A few short turns read as a conversation without crowding the view.
const MESSAGES = [
  { side: "user", size: "wide", lines: ["long", "medium"] },
  { side: "worker", lines: ["long", "long", "medium", "long", "short"] },
  { side: "user", size: "narrow", lines: ["long"] },
  { side: "worker", richMarkdown: true },
] as const satisfies readonly SkeletonMessage[];

const RICH_PARAGRAPH = ["long", "long", "medium"] as const;
const RICH_LIST_ITEMS = ["medium", "long", "short"] as const;

type ChatSkeletonProps = { announce?: boolean };

/** Mirrors the alternating message shape while the selected chat is read. */
export function ChatSkeleton({ announce = true }: ChatSkeletonProps = {}) {
  return (
    <LoadingSkeleton
      label="Loading conversation"
      announce={announce}
      blockScroll
      className="chat-skeleton"
    >
      {MESSAGES.map((message, index) => (
        <div
          className="chat-skeleton-message"
          data-side={message.side}
          key={`${message.side}-${index}`}
        >
          {skeletonMessageBody(message)}
        </div>
      ))}
    </LoadingSkeleton>
  );
}

function skeletonLines(lines: readonly SkeletonLine[]) {
  return lines.map((line, lineIndex) => (
    <SkeletonShape
      className={`chat-skeleton-line chat-skeleton-line-${line}`}
      key={`${line}-${lineIndex}`}
    />
  ));
}

function skeletonMessageBody(message: SkeletonMessage) {
  if (message.side === "user") {
    return (
      <div className="chat-skeleton-bubble" data-size={message.size}>
        {skeletonLines(message.lines)}
      </div>
    );
  }

  if ("richMarkdown" in message) {
    return (
      <div className="chat-skeleton-worker-text">
        <SkeletonShape className="chat-skeleton-line chat-skeleton-rich-heading" />
        {skeletonLines(RICH_PARAGRAPH)}
        <ul className="chat-skeleton-rich-list">
          {RICH_LIST_ITEMS.map((line, itemIndex) => (
            <li className="chat-skeleton-rich-list-item" key={itemIndex}>
              <SkeletonShape className="chat-skeleton-rich-bullet" />
              <SkeletonShape
                className={`chat-skeleton-line chat-skeleton-line-${line}`}
              />
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="chat-skeleton-worker-text">
      {skeletonLines(message.lines)}
    </div>
  );
}
