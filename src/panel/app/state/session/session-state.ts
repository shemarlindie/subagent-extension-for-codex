import type { ChangesReading } from "../../../features/changes/changes-reading";
import type { ReadingState } from "../../../features/tasks/evidence/reading-state";
import type { QuestionDraft, Tab } from "../types";

export type TaskSessionState = {
  tab: Tab;
  composerDraft: string;
  composerCollapsed: boolean;
  // Scroll hooks mutate these stable cells without rendering on every scroll event.
  reading: {
    chat: ReadingState;
    activity: ReadingState;
    changes: ChangesReading;
  };
  /** Changed files the reader marked viewed: each path's change signature. */
  viewedChanges: ReadonlyMap<string, string>;
};

export type QuestionSessionState = {
  draft?: QuestionDraft;
};

type SessionStates = {
  task: TaskSessionState;
  question: QuestionSessionState;
};

export type SessionScope = keyof SessionStates;
export type SessionState<S extends SessionScope> = SessionStates[S];

type SessionEntry<T> = { value: T; listeners: Set<() => void> };

type SessionEntries = {
  [S in SessionScope]: Map<string, SessionEntry<SessionState<S>>>;
};

const defaults = {
  task: (): TaskSessionState => ({
    tab: "chat",
    composerDraft: "",
    composerCollapsed: false,
    reading: { chat: {}, activity: {}, changes: { open: new Map() } },
    viewedChanges: new Map(),
  }),
  question: (): QuestionSessionState => ({}),
};

/** In-memory UI state. Its lifetime is the owning controller's session. */
export class SessionStateStore {
  private entries: SessionEntries = { task: new Map(), question: new Map() };

  private entry<S extends SessionScope>(scope: S, id: string) {
    const entries = this.entries[scope] as Map<
      string,
      SessionEntry<SessionState<S>>
    >;

    let entry = entries.get(id);

    if (!entry) {
      entry = {
        value: defaults[scope]() as SessionState<S>,
        listeners: new Set(),
      };

      entries.set(id, entry);
    }

    return entry;
  }

  get<S extends SessionScope>(scope: S, id: string): SessionState<S> {
    return this.entry(scope, id).value;
  }

  update<S extends SessionScope>(
    scope: S,
    id: string,
    patch: Partial<SessionState<S>>,
  ) {
    const entry = this.entry(scope, id);

    if (
      Object.keys(patch).every((key) => {
        const field = key as keyof SessionState<S>;

        return Object.is(entry.value[field], patch[field]);
      })
    ) {
      return;
    }

    entry.value = { ...entry.value, ...patch };
    entry.listeners.forEach((listener) => listener());
  }

  subscribe<S extends SessionScope>(
    scope: S,
    id: string,
    listener: () => void,
  ) {
    const entry = this.entry(scope, id);
    entry.listeners.add(listener);

    return () => entry.listeners.delete(listener);
  }

  remove<S extends SessionScope>(scope: S, id: string) {
    if (!this.entries[scope].has(id)) return;
    const entry = this.entry(scope, id);

    // Keep subscriptions attached when a request is cleared before unmounting.
    if (entry.listeners.size) {
      entry.value = defaults[scope]() as SessionState<S>;
      entry.listeners.forEach((listener) => listener());
    } else {
      this.entries[scope].delete(id);
    }
  }
}
