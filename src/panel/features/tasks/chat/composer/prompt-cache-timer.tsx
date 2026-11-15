import {
  promptCacheEnd,
  type PromptCacheLeft,
  promptCacheLeft,
} from "../../../../../shared/providers/claude/prompt-cache";
import type { Task } from "../../../../app/state/types";
import { Icon } from "../../../../shared/components/icons/icons";
import { TooltipWrapper } from "../../../../shared/components/tooltip";
import { useNow } from "../../../../shared/utils/use-now";

type PromptCacheTimerProps = { task: Task };

const MINUTE_MS = 60_000;
/** Time left when the warning color starts, by cache lifetime. */
const WARNING_MS = { "5m": 2 * MINUTE_MS, "1h": 10 * MINUTE_MS };

/** Whole minutes rounded down, `2m`, or `<1m` in the last minute. */
function short(ms: number) {
  return ms < MINUTE_MS ? "<1m" : `${Math.floor(ms / MINUTE_MS)}m`;
}

/** `about 2 more mins`, or `less than a minute` in the last minute. */
function more(ms: number) {
  const count = Math.floor(ms / MINUTE_MS);
  if (count === 0) return "less than a minute";

  return `about ${count} more min${count === 1 ? "" : "s"}`;
}

/** The tooltip's status line and the note that explains it. */
function description(left: PromptCacheLeft) {
  switch (left.state) {
    case "warm":
      return {
        status:
          left.ms < MINUTE_MS
            ? "Prompt cache expires soon"
            : `Prompt cache warm for ${more(left.ms)}`,
        note: [
          "Replying while it's warm costs less.",
          ...(left.earlierMs
            ? [`Earlier messages stay cached for ${more(left.earlierMs)}.`]
            : []),
        ].join(" "),
      };
    case "partial":
      return {
        status: "Prompt cache partly expired",
        note: `Recent messages need rewriting. Earlier ones stay cached for ${more(left.ms)}.`,
      };
    case "expired":
      return {
        status: "Prompt cache probably expired",
        note: "The next reply costs more.",
      };
  }
}

const STATE_ICONS = {
  warm: "timer",
  partial: "timer-dashed",
  expired: "timer-off",
} as const;

/**
 * Roughly how long the task's prompt cache stays warm, as the first run
 * setting. A follow-up sent in time reuses the cached conversation.
 */
export function PromptCacheTimer({ task }: PromptCacheTimerProps) {
  const end = promptCacheEnd(task);
  const now = useNow(end !== undefined, end);
  const left = promptCacheLeft(task, now);

  if (!left) return null;

  const { status, note } = description(left);

  // An empty title keeps the list's own tooltip off the timer.
  return (
    <li
      className="prompt-cache-timer"
      data-warning={
        left.state === "warm" && left.ms < WARNING_MS[left.ttl] ? "" : undefined
      }
      title=""
    >
      <TooltipWrapper
        label={`${status}. ${note}`}
        content={
          <>
            <span className="prompt-cache-tooltip-status">{status}</span>
            <span className="prompt-cache-tooltip-note">{note}</span>
          </>
        }
      >
        <span className="prompt-cache-timer-trigger" tabIndex={0}>
          <Icon name={STATE_ICONS[left.state]} size={12} />
          {left.state !== "expired" && (
            <span aria-hidden="true">{short(left.ms)}</span>
          )}
        </span>
      </TooltipWrapper>
    </li>
  );
}
