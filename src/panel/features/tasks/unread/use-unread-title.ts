import { useEffect, useState } from "react";

import {
  useController,
  useSnapshot,
} from "../../../app/state/controller-context";

/**
 * Leads the standalone console's tab title with its unread task count, as
 * in "(2) Delegated Work". A host names the embedded panel itself.
 */
export function useUnreadTitle() {
  const controller = useController(),
    state = useSnapshot(),
    [base] = useState(() => document.title),
    unread = state.tasks.filter((task) => task.unread).length;

  useEffect(() => {
    if (controller.transport.embedded) return;
    document.title = unread ? `(${unread}) ${base}` : base;
  }, [controller, base, unread]);

  useEffect(
    () => () => {
      document.title = base;
    },
    [base],
  );
}
