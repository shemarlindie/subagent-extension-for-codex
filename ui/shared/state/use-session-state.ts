import { useCallback, useSyncExternalStore } from "react";

import { useController } from "./controller-context";
import type { SessionScope, SessionState } from "./session-state";

/** Reads session state across remounts; select a stable field to limit renders. */
export function useSessionState<S extends SessionScope, T = SessionState<S>>(
  scope: S,
  id: string,
  select?: (state: SessionState<S>) => T,
) {
  const { session } = useController();

  const subscribe = useCallback(
    (listener: () => void) => session.subscribe(scope, id, listener),
    [session, scope, id],
  );

  const snapshot = useCallback(() => {
    const state = session.get(scope, id);

    return select ? select(state) : (state as T);
  }, [session, scope, id, select]);

  const update = useCallback(
    (patch: Partial<SessionState<S>>) => session.update(scope, id, patch),
    [session, scope, id],
  );

  const state = useSyncExternalStore(subscribe, snapshot, snapshot);

  return [state, update] as const;
}
