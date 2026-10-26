import type { ComposerDraftPersistence } from "../session/session-state";

const PREFIX = "codex-subagent-extension.composer.v1.";
const SAVE_DELAY_MS = 250;

/** Keeps message text private to this browser, with a flush before page teardown. */
export function browserComposerDrafts(
  storage?: Storage,
): ComposerDraftPersistence & {
  flush(): void;
} {
  const pending = new Map<string, string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const keyFor = (scope: string, id: string) => `${PREFIX}${scope}.${id}`;

  const read = (scope: "task" | "newTask", id: string) => {
    const key = keyFor(scope, id);
    if (pending.has(key)) return pending.get(key) ?? "";

    try {
      return storage?.getItem(key) ?? "";
    } catch {
      return "";
    }
  };

  const flush = () => {
    clearTimeout(timer);
    timer = undefined;

    for (const [key, text] of pending) {
      try {
        if (text) storage?.setItem(key, text);
        else storage?.removeItem(key);
      } catch {
        // Disabled or full storage must not prevent composing or sending.
      }
    }

    pending.clear();
  };

  return {
    read,
    write(scope, id, text) {
      if (read(scope, id) === text) return;
      pending.set(keyFor(scope, id), text);
      clearTimeout(timer);
      timer = setTimeout(flush, SAVE_DELAY_MS);
    },
    flush,
  };
}
