import { tmpdir } from "node:os";

import type {
  query,
  SDKControlGetUsageResponse,
  SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";

import type { ActivityRateLimitWindow } from "../../../../../shared/providers/activity/types.js";
import { claudeOverrideDefaults } from "../../../../../shared/providers/claude/permissions.js";
import { claudeRateLimitLabels } from "../../../../../shared/providers/claude/rate-limit-windows.js";
import type { PlanUsage } from "../../../../../shared/providers/plan-usage.js";
import type { SettingsValues } from "../../../../../shared/settings/settings-schema.js";
import { logError, logEvent } from "../../../../platform/logging/logger.js";
import type { PlanUsageReader } from "../../types.js";
import type { ClaudeCli } from "../configuration/executable.js";
import { turnlessSession } from "./session-reads.js";

/** The least time between reads, which also spaces retries after a failure. */
export const PLAN_USAGE_INTERVAL_MS = 30_000;

/** How old a read may be before showing it starts another. */
const PLAN_USAGE_STALE_MS = 5 * 60_000;

/** The windows a rate limit event's undocumented `unifiedWindows` carries. */
const EVENT_WINDOWS = ["five_hour", "seven_day"] as const;

type Limits = NonNullable<SDKControlGetUsageResponse["rate_limits"]>;

type Window = { utilization: number | null; resets_at: string | null };

/** Plan usage from Claude Code's `/usage` data, or null when no plan limits apply. */
export function claudePlanUsage(
  usage: SDKControlGetUsageResponse,
  readAt = Date.now(),
): PlanUsage | null {
  const limits = usage.rate_limits;
  if (!usage.rate_limits_available || !limits) return null;

  const windows = [
    toWindow("five_hour", claudeRateLimitLabels.five_hour, limits.five_hour),
    toWindow("seven_day", claudeRateLimitLabels.seven_day, limits.seven_day),
    ...modelWindows(limits),
  ].filter((window) => window !== undefined);

  if (!windows.length) return null;

  return {
    ...(usage.subscription_type ? { plan: usage.subscription_type } : {}),
    windows,
    read_at: readAt,
  };
}

/** Per-model weekly windows, from `model_scoped` when the CLI reports it. */
function modelWindows(limits: Limits) {
  if (!limits.model_scoped) {
    return [
      toWindow(
        "seven_day_opus",
        claudeRateLimitLabels.seven_day_opus,
        limits.seven_day_opus,
      ),
      toWindow(
        "seven_day_sonnet",
        claudeRateLimitLabels.seven_day_sonnet,
        limits.seven_day_sonnet,
      ),
    ];
  }

  return limits.model_scoped.map((model) =>
    toWindow(
      `seven_day_${model.display_name.toLowerCase()}`,
      `7-day ${model.display_name} window`,
      model,
    ),
  );
}

function toWindow(
  id: string,
  label: string,
  window: Window | null | undefined,
): ActivityRateLimitWindow | undefined {
  const percent = window?.utilization;

  if (typeof percent !== "number" || !Number.isFinite(percent)) {
    return undefined;
  }

  const resets = window?.resets_at ? Date.parse(window.resets_at) : NaN;

  return {
    id,
    label,
    utilization: percent / 100,
    ...(Number.isFinite(resets) ? { resetsAt: Math.floor(resets / 1000) } : {}),
  };
}

type EventWindow = Pick<ActivityRateLimitWindow, "utilization" | "resetsAt">;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** A `unifiedWindows` entry, whose utilization is already a fraction. */
function eventWindow(value: unknown): EventWindow | undefined {
  if (!isObject(value)) return undefined;

  const { utilization, resetsAt } = value;

  if (typeof utilization !== "number" || !Number.isFinite(utilization)) {
    return undefined;
  }

  return typeof resetsAt === "number" && Number.isFinite(resetsAt)
    ? { utilization, resetsAt }
    : { utilization };
}

/**
 * The account's plan usage, read through a session without a turn. Reads run
 * one at a time, at most every `PLAN_USAGE_INTERVAL_MS`, and a request made
 * while one runs or waits is served by the next. A failed read keeps the last
 * value. Each successful read notifies the watchers.
 */
export class ClaudePlanUsage implements PlanUsageReader {
  /** Undefined until a read succeeds, and null when no plan limits apply. */
  private value?: PlanUsage | null;
  private lastStart = -Infinity;
  private running = false;
  private again = false;
  private timer?: ReturnType<typeof setTimeout>;
  private watchers = new Set<() => void>();
  private warnedEventShape = false;
  private settingsFiles = claudeOverrideDefaults.settings_files;

  constructor(
    private launch: typeof query,
    private cli: Pick<ClaudeCli, "executable">,
  ) {}

  /** Reads load settings files as the latest caller's settings say. */
  current(settings?: SettingsValues) {
    const settingsFiles = settings?.providers.claude.settings_files;
    if (settingsFiles !== undefined) this.settingsFiles = settingsFiles;
    if (Date.now() - this.lastStart >= PLAN_USAGE_STALE_MS) this.refresh();

    return this.value;
  }

  watch(listener: () => void) {
    this.watchers.add(listener);
  }

  /**
   * Updates the 5-hour and 7-day windows from a rate limit event, which fires
   * as any window moves a point. Its documented `utilization` covers only a
   * window past a warning threshold, so this reads the undocumented
   * `unifiedWindows`. Anything unexpected leaves the value as it is.
   */
  fromMessage(message: SDKMessage) {
    if (message.type !== "rate_limit_event") return;

    // Typed, but checked anyway, as throwing here would fail the turn.
    const info: unknown = message.rate_limit_info;
    const field = isObject(info) ? info.unifiedWindows : undefined;
    const unified = isObject(field) ? field : undefined;
    const updates = new Map<string, EventWindow>();

    for (const id of EVENT_WINDOWS) {
      const window = eventWindow(unified?.[id]);
      if (window) updates.set(id, window);
    }

    if (!updates.size) {
      // Once per run, so a changed event shape shows without repeating.
      if (!this.warnedEventShape) {
        this.warnedEventShape = true;

        logEvent("warn", "provider.plan_usage_event_unreadable", {
          info_keys: isObject(info) ? Object.keys(info).join(",") : typeof info,
          unified_keys: unified && Object.keys(unified).join(","),
        });
      }

      return;
    }

    // Only a read gives the plan and the per-model windows.
    if (!this.value) {
      this.refresh();

      return;
    }

    logEvent("debug", "provider.plan_usage_event", {
      unified_keys: Object.keys(unified ?? {}).join(","),
      ...Object.fromEntries(
        [...updates].map(([id, w]) => [
          `${id}_percent`,
          Math.round(w.utilization * 100),
        ]),
      ),
    });

    this.value = {
      ...this.value,
      windows: this.value.windows.map((w) => {
        const update = updates.get(w.id);

        return update ? { ...w, ...update } : w;
      }),
      read_at: Date.now(),
    };

    for (const watcher of this.watchers) watcher();
  }

  /**
   * Reads now, or as soon as the interval allows. Without a watcher nothing
   * would show the result, so nothing is read.
   */
  refresh() {
    if (!this.watchers.size) return;

    if (this.running) {
      this.again = true;

      return;
    }

    if (this.timer) return;

    const wait = this.lastStart + PLAN_USAGE_INTERVAL_MS - Date.now();

    if (wait > 0) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        void this.run();
      }, wait);

      this.timer.unref();

      return;
    }

    void this.run();
  }

  private async run() {
    this.running = true;
    this.lastStart = Date.now();
    const started = performance.now();

    try {
      this.value = await this.read();

      logEvent("debug", "provider.plan_usage", {
        duration_ms: performance.now() - started,
        windows: this.value?.windows.length ?? 0,
        highest_percent: this.value
          ? Math.round(
              Math.max(...this.value.windows.map((w) => w.utilization)) * 100,
            )
          : undefined,
      });

      for (const watcher of this.watchers) watcher();
    } catch (error) {
      logError("provider.plan_usage_failed", error, {
        duration_ms: performance.now() - started,
      });
    } finally {
      this.running = false;

      if (this.again) {
        this.again = false;
        this.refresh();
      }
    }
  }

  private async read() {
    const turnless = turnlessSession(this.launch, this.settingsFiles, {
      pathToClaudeCodeExecutable: await this.cli.executable(),
      // Outside any project, as plan usage belongs to the account.
      cwd: tmpdir(),
    });

    try {
      const usage = await Promise.race([
        turnless.session.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET(
          { skipBehaviors: true },
        ),
        turnless.timeout,
      ]);

      return claudePlanUsage(usage);
    } finally {
      turnless.close();
    }
  }
}
