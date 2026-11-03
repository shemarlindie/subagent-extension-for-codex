interface RevisionContext {
  closed(): boolean;
  hidden(): boolean;
  busy(): boolean;
  refresh(): void;
}

/** How long changes gather before the refresh they trigger. */
const THROTTLE_MS = 100;

/**
 * Turns the service revisions a transport reports into refreshes. A new
 * revision schedules one refresh, which later changes join until it runs,
 * so a task streaming events still refreshes every `THROTTLE_MS`. A hidden
 * or busy panel keeps the refresh pending until `resume`.
 */
export class RevisionTrigger {
  private last?: string;
  private timer?: ReturnType<typeof setTimeout>;
  private pending = false;
  constructor(private context: RevisionContext) {}

  /** A revision from the transport; the first always counts as new. */
  report(revision: string) {
    if (revision === this.last) return;
    this.last = revision;
    if (this.timer) return;

    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.pending = true;
      this.resume();
    }, THROTTLE_MS);
  }

  /** Runs a pending refresh once the panel is visible and not busy. */
  resume() {
    const context = this.context;
    if (!this.pending || context.closed() || context.hidden()) return;
    if (context.busy()) return;
    this.pending = false;
    this.context.refresh();
  }

  dispose() {
    clearTimeout(this.timer);
  }
}
