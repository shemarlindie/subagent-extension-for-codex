import { errorMessage } from "../../shared/utils/error-message";
import type { Snapshot, Tab } from "./types";

/** Where a change shows, so a step taken elsewhere can name it. */
export type UndoView = {
  visible(state: Snapshot): boolean;
  /** Names what changed, such as its task's title. */
  name(state: Snapshot): string | undefined;
};

/** A partial step returns a warning and keeps the part it changed reversible. */
type UndoStep = () => Promise<void | { warning: string }>;

/** A change the user made that the panel can reverse and apply again. */
export type UndoEntry = {
  /** What the change did, such as "Archived 3 tasks". */
  label: string;
  /** What a bulk change touched, such as each archived task's title. */
  items?: string[];
  /**
   * Set when the change takes something off the screen. Making it shows a
   * toast with Undo, for users without the shortcut and for the changes
   * people most often regret.
   */
  toast?: boolean;
  /** Where the change shows. A step taken while it's hidden names it. */
  view?: UndoView;
  /** Reverses the change, rejecting with a message the user can read. */
  undo: UndoStep;
  /** Applies the change again. */
  redo: UndoStep;
};

/** What actions use to remember their changes. */
export type UndoRecorder = Pick<UndoHistory, "record" | "change">;

/** The undo toast's message and the step it offers next. */
export type UndoNotice = {
  /** Changes with each notice, so the toast restarts its timer. */
  id: number;
  text: string;
  /** Up to three lines listed under the text. */
  items?: string[];
  /** Counts the lines left out, such as "and 2 more". */
  rest?: string;
  offer?: "undo" | "redo";
  /** How many steps the offer takes: all the steps the toast lists. */
  steps?: number;
  /** Set when a step reports a problem, so the toast warns and stays longer. */
  failed?: boolean;
};

type Direction = "undo" | "redo";

/** Steps taken the same way while one toast stays open, newest line first. */
type Streak = { direction: Direction; lines: string[]; notice: number };

interface UndoContext {
  snapshot(): Snapshot;
  closed(): boolean;
  patch(patch: Partial<Snapshot>): void;
}

/** How many changes the panel can undo in a row. */
const LIMIT = 20;
/** How many lines the toast lists before counting the rest. */
const LISTED = 3;

/**
 * A change to a task, shown while the task is open on `tab`, or any tab. It's
 * named by the task's current title, or `title` once another scope hides it.
 */
export function taskView(task: string, tab?: Tab, title?: string): UndoView {
  return {
    visible: (state) =>
      state.page === "tasks" &&
      !state.newTask &&
      state.selected === task &&
      (!tab || state.tab === tab),
    name: (state) => state.tasks.find((t) => t.id === task)?.title ?? title,
  };
}

/** Quotes text in a label, on one line and shortened past `max` characters. */
export function quote(text: string, max = 60) {
  const line = text.replace(/\s+/g, " ").trim();

  return `“${line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line}”`;
}

/** Lists the first lines, counting the rest with `word`. */
function listed(lines: string[] | undefined, word: string) {
  if (!lines?.length) return {};
  const left = lines.length - LISTED;

  return {
    items: lines.slice(0, LISTED),
    ...(left > 0 ? { rest: `and ${left} ${word}` } : {}),
  };
}

/**
 * Remembers the user's reversible changes in this panel. Recording a change
 * clears what could be redone. A step that fails is dropped, since what it
 * would reverse has changed since. The history lasts as long as the panel,
 * across project and conversation changes, since each toast names what it
 * changed.
 *
 * One thing happens at a time: changes, records and steps run in the order
 * the user asked for them, so quick presses all count and none overtakes
 * another. A change counts once the service confirms it, and reads the
 * state it changes when its turn comes. `undoPending` lets the toast wait
 * meanwhile.
 *
 * Undo and redo always show what they did, since a shortcut gives no other
 * feedback. Steps taken while their toast is open collect in it. A change
 * itself stays quiet unless it takes something off the screen, and a quiet
 * change closes any older toast, whose button would step through it unseen.
 * Failures always show.
 */
export class UndoHistory {
  private readonly past: UndoEntry[] = [];
  private readonly future: UndoEntry[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  /** Changes and steps asked for and not yet finished. */
  private queued = 0;
  /** Counts local changes made while steps wait, which cancel those steps. */
  private interruptions = 0;
  private notices = 0;
  /** The steps the open toast lists. */
  private streak?: Streak;
  /** The change whose own toast is open. */
  private announced?: { entry: UndoEntry; notice: number };

  constructor(private context: UndoContext) {}

  /**
   * Remembers a change already made, such as a local one that needs no
   * service, after the changes and steps asked for before it. Its effect
   * already shows, so it cancels undo and redo steps still waiting, which
   * could reverse what it just changed.
   */
  record(entry: UndoEntry) {
    if (this.queued) {
      this.interruptions++;
      void this.enqueue(async () => this.remember(entry));
    } else {
      this.remember(entry);
    }
  }

  private remember(entry: UndoEntry) {
    if (this.context.closed()) return;
    this.past.push(entry);
    this.past.splice(0, this.past.length - LIMIT);
    this.future.length = 0;
    this.streak = undefined;

    if (entry.toast) {
      this.announce(entry);
    } else {
      this.context.patch({ undoNotice: undefined });
    }
  }

  /**
   * Starts a change once earlier changes and steps finish, then remembers
   * what `describe` says it did. Undefined means nothing changed, which
   * leaves the history as it was.
   */
  change<T>(
    start: () => Promise<T>,
    describe: (value: T) => UndoEntry | undefined,
  ): Promise<T> {
    return this.enqueue(async () => {
      const value = await start();
      const entry = describe(value);
      if (entry) this.remember(entry);

      return value;
    });
  }

  private announce(entry: UndoEntry) {
    if (this.context.closed()) return;

    const notice = this.show({
      text: entry.label,
      ...listed(entry.items, "more"),
      offer: "undo",
    });

    this.announced = { entry, notice };
  }

  /** Drops a change that didn't happen, with its toast. */
  private forget(entry: UndoEntry) {
    for (const list of [this.past, this.future]) {
      const index = list.indexOf(entry);
      if (index >= 0) list.splice(index, 1);
    }

    if (this.announced?.entry === entry) {
      this.dismiss(this.announced.notice);
      this.announced = undefined;
    }
  }

  /** Undoes `count` changes, newest first, stopping at a failure. */
  undo(count = 1) {
    return this.repeat(count, "undo");
  }

  /** Redoes `count` changes, stopping at a failure. */
  redo(count = 1) {
    return this.repeat(count, "redo");
  }

  /** Takes up to `count` steps, stopping at a failure or a local change. */
  private repeat(count: number, direction: Direction) {
    const interruptions = this.interruptions;

    return this.enqueue(async () => {
      for (let done = 0; done < count; done++) {
        if (this.interruptions !== interruptions) return;
        if (!(await this.step(direction))) return;
      }
    });
  }

  /** Runs `work` after everything asked for earlier. */
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    this.queued++;
    this.updatePending();

    const run = this.queue.then(work).finally(() => {
      this.queued--;
      this.updatePending();
    });

    this.queue = run.catch(() => undefined);

    return run;
  }

  private updatePending() {
    const undoPending = this.queued > 0;

    if (
      !this.context.closed() &&
      this.context.snapshot().undoPending !== undoPending
    ) {
      this.context.patch({ undoPending });
    }
  }

  /** Closes the notice with this id, unless a newer one replaced it. */
  dismiss = (id: number) => {
    if (this.context.snapshot().undoNotice?.id === id) {
      this.context.patch({ undoNotice: undefined });
    }
  };

  private async step(direction: Direction): Promise<boolean> {
    // A busy panel refuses actions, so the entry waits for another try.
    if (this.context.closed() || this.context.snapshot().busy) return false;

    const [from, to] =
      direction === "undo"
        ? [this.past, this.future]
        : [this.future, this.past];

    const entry = from.pop();
    if (!entry) return false;

    try {
      const result = await entry[direction]();
      to.push(entry);

      this.context.patch({
        undoRevision: this.context.snapshot().undoRevision + 1,
      });

      this.stepped(entry, direction, result?.warning);

      return !result;
    } catch (error) {
      this.forget(entry);
      this.streak = undefined;

      this.show({
        text: `Couldn't ${direction}: ${errorMessage(error)}`,
        failed: true,
      });

      return false;
    }
  }

  /** Shows the step, with the earlier ones its open toast listed. */
  private stepped(entry: UndoEntry, direction: Direction, warning?: string) {
    const state = this.context.snapshot();
    const { view } = entry;
    const name = view && !view.visible(state) ? view.name(state) : undefined;
    const line = name ? `${entry.label} · ${name}` : entry.label;
    const verb = direction === "undo" ? "Undid" : "Redid";
    const offer = direction === "undo" ? "redo" : "undo";

    if (warning) {
      this.streak = undefined;

      this.show({
        text: `${verb}: ${line}. ${warning}`,
        ...listed(entry.items, "more"),
        offer,
        failed: true,
      });

      return;
    }

    const streak = this.streak;

    // Only steps the same way while their toast is open collect.
    const lines =
      streak?.direction === direction && streak.notice === state.undoNotice?.id
        ? [line, ...streak.lines]
        : [line];

    // The button reverses every step the toast lists.
    const notice = this.show(
      lines.length === 1
        ? { text: `${verb}: ${line}`, ...listed(entry.items, "more"), offer }
        : {
            text: `${verb} ${lines.length} changes`,
            ...listed(lines, "earlier"),
            offer,
            steps: lines.length,
          },
    );

    this.streak = { direction, lines, notice };
  }

  private show(notice: Omit<UndoNotice, "id">) {
    const id = ++this.notices;
    this.announced = undefined;
    this.context.patch({ undoNotice: { id, ...notice } });

    return id;
  }
}
