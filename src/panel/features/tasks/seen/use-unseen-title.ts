import { useEffect, useState } from "react";

import {
  useController,
  useSnapshot,
} from "../../../app/state/controller-context";

/**
 * Leads the standalone console's tab title with its unseen task count, as
 * in "(2) Delegated Work". A host names the embedded panel itself.
 */
export function useUnseenTitle() {
  const controller = useController(),
    state = useSnapshot(),
    [base] = useState(() => document.title),
    unseen = state.tasks.filter((task) => task.unseen).length;

  useEffect(() => {
    if (controller.transport.embedded) return;
    document.title = unseen ? `(${unseen}) ${base}` : base;
  }, [controller, base, unseen]);

  useEffect(
    () => () => {
      document.title = base;
    },
    [base],
  );
}
