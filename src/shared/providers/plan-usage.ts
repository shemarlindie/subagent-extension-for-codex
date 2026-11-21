import type { ActivityRateLimitWindow } from "./activity/types.js";

/** How much of the account's plan usage limits a provider last read as used. */
export interface PlanUsage {
  /** The subscription, such as `pro`, when the provider names it. */
  plan?: string;
  /** Each limit window, the shortest first. */
  windows: ActivityRateLimitWindow[];
  /** When it was read, in epoch milliseconds. */
  read_at: number;
}
