import {
  LoadingSkeleton,
  SkeletonShape,
} from "../../../../shared/components/loading-skeleton/loading-skeleton";

type SkeletonLine = "long" | "medium" | "short";

type SkeletonMessage =
  | { side: "user"; lines: readonly SkeletonLine[]; richMarkdown: false }
  | { side: "worker"; lines: readonly SkeletonLine[]; richMarkdown: false }
  | { side: "worker"; richMarkdown: true };

const MESSAGES = [
  { side: "user", lines: ["long", "medium", "short"], richMarkdown: false },
  {
    side: "worker",
    lines: ["long", "medium", "short", "medium", "long"],
    richMarkdown: false,
  },
  { side: "user", lines: ["long", "medium"], richMarkdown: false },
  {
    side: "worker",
    lines: ["long", "medium", "short", "medium"],
    richMarkdown: false,
  },
  { side: "user", lines: ["long", "medium", "short"], richMarkdown: false },
  { side: "worker", richMarkdown: true },
] as const satisfies readonly SkeletonMessage[];

const RICH_INTRO_LINES = ["long", "medium"] as const;

const RICH_LIST_ITEMS = [
  ["long", "short"],
  ["medium"],
  ["long", "medium"],
] as const;

/** Mirrors the alternating message shape while the selected chat is read. */
export function ChatSkeleton({ announce = true }: { announce?: boolean } = {}) {
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

function skeletonMessageBody(message: SkeletonMessage) {
  if (message.side === "user") {
    return (
      <div className="chat-skeleton-bubble">
        {message.lines.map((line, lineIndex) => (
          <SkeletonShape
            className={`chat-skeleton-line chat-skeleton-line-${line}`}
            key={`${line}-${lineIndex}`}
          />
        ))}
      </div>
    );
  }

  if (message.richMarkdown) {
    return (
      <div className="chat-skeleton-worker-text chat-skeleton-rich-response">
        <div className="chat-skeleton-rich-heading-row">
          <SkeletonShape className="chat-skeleton-line chat-skeleton-rich-heading" />
        </div>
        <div className="chat-skeleton-rich-paragraph">
          {RICH_INTRO_LINES.map((line, lineIndex) => (
            <SkeletonShape
              className={`chat-skeleton-line chat-skeleton-rich-intro-${line}`}
              key={`${line}-${lineIndex}`}
            />
          ))}
        </div>
        <SkeletonShape className="chat-skeleton-line chat-skeleton-rich-subheading" />
        <div className="chat-skeleton-rich-list">
          {RICH_LIST_ITEMS.map((lines, itemIndex) => (
            <div className="chat-skeleton-rich-list-item" key={itemIndex}>
              <SkeletonShape className="chat-skeleton-rich-bullet" />
              <div className="chat-skeleton-rich-list-lines">
                {lines.map((line, lineIndex) => (
                  <SkeletonShape
                    className={`chat-skeleton-line chat-skeleton-line-${line}`}
                    key={`${line}-${lineIndex}`}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="chat-skeleton-worker-text">
      {message.lines.map((line, lineIndex) => (
        <SkeletonShape
          className={`chat-skeleton-line chat-skeleton-line-${line}`}
          key={`${line}-${lineIndex}`}
        />
      ))}
    </div>
  );
}
