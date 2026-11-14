import {
  promptCacheEnd,
  type PromptCacheLeft,
  promptCacheLeft,
} from "../../../../../shared/providers/claude/prompt-cache";
import type { Task } from "../../../../app/state/types";
import { Icon } from "../../../../shared/components/icons/icons";
import { useNow } from "../../../../shared/utils/use-now";

type PromptCacheTimerProps = { task: Task };

const MINUTE_MS = 60_000;

/** Whole minutes rounded down, then seconds in the last minute. */
function timeLeft(ms: number, units: { minutes: string; seconds: string }) {
  return ms >= MINUTE_MS
    ? `${Math.floor(ms / MINUTE_MS)}${units.minutes}`
    : `${Math.max(1, Math.floor(ms / 1000))}${units.seconds}`;
}

const short = (ms: number) => timeLeft(ms, { minutes: "m", seconds: "s" });

const long = (ms: number) => timeLeft(ms, { minutes: " min", seconds: " sec" });

function description(left: PromptCacheLeft) {
  switch (left.state) {
    case "warm":
      return [
        `Prompt cache: about ${long(left.ms)} left (${left.ttl === "1h" ? "1 hour" : "5 min"} lifetime).`,
        "Replies sent before then reuse the cached conversation.",
        ...(left.earlierMs
          ? [
              `The earlier conversation stays cached for about ${long(left.earlierMs)}.`,
            ]
          : []),
      ].join(" ");
    case "partial":
      return `Prompt cache partly expired. The latest messages need rewriting, and the earlier conversation stays cached for about ${long(left.ms)}.`;
    case "expired":
      return "Prompt cache has probably expired. The next reply rewrites it.";
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

  const text = description(left);

  return (
    <li
      className="prompt-cache-timer"
      data-warning={
        left.state === "warm" && left.ms < MINUTE_MS ? "" : undefined
      }
      title={text}
    >
      <Icon name={STATE_ICONS[left.state]} size={12} />
      {left.state !== "expired" && (
        <span aria-hidden="true">{short(left.ms)}</span>
      )}
      <span className="visually-hidden">{text}</span>
    </li>
  );
}
