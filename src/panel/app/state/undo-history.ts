import { errorMessage } from "../../shared/utils/error-message";
import type { Snapshot, Tab } from "./types";

/** Where a change shows, so a step taken elsewhere can name it. */
export type UndoView = {
  visible(state: Snapshot): boolean;
  /** Names what changed, such as its task's title. */
  name(state: Snapshot): string | undefined;
};

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
  undo(): Promise<void>;
  /** Applies the change again. */
  redo(): Promise<void>;
};

/** What actions use to remember their changes. */
export type UndoRecorder = Pick<UndoHistory, "record" | "track">;

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
  /** Set when a step failed, so the toast warns and stays longer. */
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
 * Undo and redo always show what they did, since a shortcut gives no other
 * feedback. Steps taken while their toast is open collect in it. A change
 * itself stays quiet unless it takes something off the screen, and a quiet
 * change closes any older toast, whose button would step through it unseen.
 * Failures always show.
 */
export class UndoHistory {
  // Changed in place, since a step in progress holds these arrays.
  private readonly past: UndoEntry[] = [];
  private readonly future: UndoEntry[] = [];
  /** Steps run one at a time, so quick presses all count, in order. */
  private queue: Promise<unknown> = Promise.resolve();
  private notices = 0;
  /** The steps the open toast lists. */
  private streak?: Streak;
  /** Changes still saving, and whether each one happened. */
  private saving = new WeakMap<UndoEntry, Promise<boolean>>();
  /** The change whose own toast is open. */
  private announced?: { entry: UndoEntry; notice: number };

  constructor(private context: UndoContext) {}

  /** Remembers a change the service has made. */
  record(entry: UndoEntry) {
    this.past.push(entry);
    this.past.splice(0, this.past.length - LIMIT);
    this.future.length = 0;
    this.streak = undefined;

    if (!entry.toast) {
      this.context.patch({ undoNotice: undefined });

      return;
    }

    const notice = this.show({
      text: entry.label,
      ...listed(entry.items, "more"),
      offer: "undo",
    });

    this.announced = { entry, notice };
  }

  /**
   * Remembers a change as soon as it shows, while `action` saves it, so the
   * shortcut never skips past it to an older change. Undo waits for the save.
   * A failed save, or one `happened` rejects, drops the change.
   */
  track<T>(
    action: Promise<T>,
    entry: UndoEntry,
    happened: (value: T) => boolean = () => true,
  ) {
    const saved = action.then(happened, () => false);

    this.saving.set(entry, saved);
    this.record(entry);

    void saved.then((ok) => {
      if (!ok) this.forget(entry);
    });
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
    return this.repeat(count, () => this.step(this.past, this.future, "undo"));
  }

  /** Redoes `count` changes, stopping at a failure. */
  redo(count = 1) {
    return this.repeat(count, () => this.step(this.future, this.past, "redo"));
  }

  /** Runs `step` up to `count` times after any steps already asked for. */
  private repeat(count: number, step: () => Promise<boolean>) {
    const run = this.queue.then(async () => {
      for (let done = 0; done < count; done++) {
        if (!(await step())) return;
      }
    });

    this.queue = run.catch(() => undefined);

    return run;
  }

  /** Closes the notice with this id, unless a newer one replaced it. */
  dismiss = (id: number) => {
    if (this.context.snapshot().undoNotice?.id === id) {
      this.context.patch({ undoNotice: undefined });
    }
  };

  private async step(
    from: UndoEntry[],
    to: UndoEntry[],
    direction: Direction,
  ): Promise<boolean> {
    // A change still saving finishes first, and drops itself if it failed.
    const next = from.at(-1);
    if (next) await this.saving.get(next);

    // A busy panel refuses actions, so the entry waits for another try.
    if (this.context.closed() || this.context.snapshot().busy) return false;

    const entry = from.pop();
    if (!entry) return false;

    try {
      await entry[direction]();
      to.push(entry);

      this.context.patch({
        undoRevision: this.context.snapshot().undoRevision + 1,
      });

      this.stepped(entry, direction);

      return true;
    } catch (error) {
      this.streak = undefined;

      this.show({
        text: `Couldn't ${direction}: ${errorMessage(error)}`,
        failed: true,
      });

      return false;
    }
  }

  /** Shows the step, with the earlier ones its open toast listed. */
  private stepped(entry: UndoEntry, direction: Direction) {
    const state = this.context.snapshot(),
      { view } = entry,
      name = view && !view.visible(state) ? view.name(state) : undefined,
      line = name ? `${entry.label} · ${name}` : entry.label,
      verb = direction === "undo" ? "Undid" : "Redid",
      offer = direction === "undo" ? "redo" : "undo",
      streak = this.streak;

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
