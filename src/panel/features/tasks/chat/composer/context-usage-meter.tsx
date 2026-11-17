import { claudeTaskOptionsSchema } from "../../../../../shared/providers/claude/task-options";
import { optionsForProvider } from "../../../../../shared/providers/options";
import type { Task } from "../../../../app/state/types";
import { TooltipWrapper } from "../../../../shared/components/tooltip";
import { formatCount } from "../../../../shared/utils/format";

type ContextUsageMeterProps = { task: Task };

/** Share of the window where the warning color starts. */
const WARNING_SHARE = 0.8;

/** Circumference of the ring's radius-4.5 circle. */
const RING = 2 * Math.PI * 4.5;

/** How full the window is, as a whole percentage. */
const percent = (tokens: number, window: number) =>
  Math.round((tokens / window) * 100);

/**
 * How full the task's context window was after its latest response, as the
 * second run setting. Narrow panels show the ring alone.
 */
export function ContextUsageMeter({ task }: ContextUsageMeterProps) {
  const usage = claudeTaskOptionsSchema.safeParse(
    optionsForProvider(task.provider_options, "claude"),
  ).data?.context_usage;

  if (!usage) return null;

  const share = Math.min(usage.total_tokens / usage.window_tokens, 1);
  const used = percent(usage.total_tokens, usage.window_tokens);
  const status = `${formatCount(usage.total_tokens)} of ${formatCount(usage.window_tokens)} tokens used (${used}%)`;

  const compaction = usage.auto_compact_tokens
    ? `Auto-compacts at ${percent(usage.auto_compact_tokens, usage.window_tokens)}%`
    : "Auto-compact is off";

  const categories = usage.categories.toSorted((a, b) => b.tokens - a.tokens);

  // The whole item, separator included, opens the tooltip.
  return (
    <TooltipWrapper
      label={`Context window: ${status}. ${compaction}.`}
      content={
        <>
          <span className="run-setting-tooltip-status">{status}</span>
          <span className="run-setting-tooltip-note">{compaction}</span>
          <span className="run-setting-tooltip-rows context-usage-tooltip-rows">
            {categories.map(({ name, tokens }) => (
              <span key={name}>
                <span>{name}</span>
                <span>{formatCount(tokens)}</span>
              </span>
            ))}
          </span>
        </>
      }
    >
      <li
        className="context-usage-meter run-setting-trigger"
        data-warning={share >= WARNING_SHARE ? "" : undefined}
        tabIndex={0}
      >
        <span className="run-setting-value">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <circle
              className="context-usage-ring-track"
              cx="6"
              cy="6"
              r="4.5"
            />
            <circle
              className="context-usage-ring-fill"
              cx="6"
              cy="6"
              r="4.5"
              strokeDasharray={`${share * RING} ${RING}`}
            />
          </svg>
          <span className="context-usage-meter-percent" aria-hidden="true">
            {used}%
          </span>
        </span>
      </li>
    </TooltipWrapper>
  );
}
