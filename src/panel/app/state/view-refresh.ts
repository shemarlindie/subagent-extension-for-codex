import type { TimingReporter } from "../../features/tasks/controls/timing-reporter";
import {
  olderRevision,
  type UpdateRead,
  type ViewRead,
  type ViewRequest,
} from "./panel-view";

/** How a load ended: applied, overtaken by a newer scope or read, or failed. */
export type RefreshOutcome = "applied" | "stale" | { error: unknown };

/**
 * How applying one view ended: `done`, `again` to read again at once,
 * `dropped` to read again after this load, or `partial` when some parts were
 * too old and are read again at once.
 */
export type ApplyResult = "done" | "again" | "dropped" | "partial";

interface ViewRefreshContext {
  timing: Pick<TimingReporter, "fetch" | "deliver" | "observe">;
  tool<T>(name: string, args: Record<string, unknown>): Promise<T>;
  /** Whether the panel is open and connected, so it can read. */
  connected(): boolean;
  /** The scope version, which every scope change moves on. */
  scope(): number;
  /** Whether the panel closed or `version` is no longer the scope. */
  stale(version: number): boolean;
  /** Reads the panel scope when it isn't known yet, resolving to false when the scope changed meanwhile. */
  ensureScope(): Promise<boolean>;
  /** The view arguments for the panel now, with the counters that guard them. */
  request(): ViewRequest;
  /** Applies each part of a view that still fits the panel. */
  apply(read: ViewRead): Promise<ApplyResult>;
  /** Reports how a load ended, before any rerun it left due. */
  settled(outcome: RefreshOutcome): void;
}

/**
 * Decides when the panel reads its view and whether a view is too old to
 * apply. Loads run one at a time, and the active load runs once more for any
 * refresh asked for meanwhile.
 */
export class ViewRefresh {
  private refreshing = false;
  private rerun = false;
  private latest?: string;

  constructor(private context: ViewRefreshContext) {}

  /** The revision of the last view that passed ordering. */
  get revision() {
    return this.latest;
  }

  /** Applies `held`, a view an update wait returned, or reads one at once. */
  async load(held?: ViewRead): Promise<void> {
    if (!this.context.connected()) return;

    if (this.refreshing) {
      this.rerun = true;

      return;
    }

    this.refreshing = true;
    let version = this.context.scope();
    let outcome: RefreshOutcome = "stale";

    try {
      if (!held && !(await this.context.ensureScope())) return;
      version = this.context.scope();

      let read = held ?? (await this.read());

      // Parts that no longer fit are read again at once, in the scope a
      // project change may have moved to.
      while (await this.apply(read)) {
        version = this.context.scope();
        read = await this.read();
      }

      if (this.context.stale(version)) return;
      outcome = "applied";
    } catch (error) {
      // A queued refresh determines the outcome after this read has failed.
      if (this.context.stale(version) || this.rerun) return;
      outcome = { error };

      throw error;
    } finally {
      await this.finish(version, outcome);
    }
  }

  private async read(): Promise<ViewRead> {
    const request = this.context.request();

    const { revision, view } = await this.context.timing.fetch("view", () =>
      this.context.tool<UpdateRead>("app_wait_for_updates", {
        view: request.args,
      }),
    );

    if (!view) throw new Error("The service returned no panel view.");

    return { revision, view, request };
  }

  /** Applies a view, resolving to true when parts are to be read again at once. */
  private async apply(read: ViewRead) {
    this.context.timing.deliver(read.view);

    // A held wait and an immediate read can return out of order.
    if (olderRevision(read.revision, this.latest)) {
      this.countDrop();

      return false;
    }

    this.latest = read.revision;
    const result = await this.context.apply(read);

    if (result === "dropped" || result === "partial") this.countDrop();
    // The update wait has moved past the change a dropped view carried.
    if (result === "dropped") this.rerun = true;

    return result === "again" || result === "partial";
  }

  private countDrop() {
    this.context.timing.observe("view", "merge", 0, { stale_count: 1 });
  }

  /** Every load outcome is reported, then runs the refresh it left due. */
  private async finish(version: number, outcome: RefreshOutcome) {
    this.refreshing = false;
    this.context.settled(outcome);

    if (this.rerun || this.context.scope() !== version) {
      this.rerun = false;
      await this.load();
    }
  }
}
