import { useEffect } from "react";

import { useController } from "../../../app/state/controller-context";

/**
 * Leads the standalone console's tab title with its unread task count, as
 * in "(2) Delegated Work". A host names the embedded panel itself. The count
 * is read through a store subscription, so a change renders nothing.
 */
export function useUnreadTitle() {
  const controller = useController();

  useEffect(() => {
    if (controller.transport.embedded) return;
    const base = document.title;

    const update = () => {
      const unread = controller
        .getSnapshot()
        .tasks.filter((task) => task.unread).length;

      document.title = unread ? `(${unread}) ${base}` : base;
    };

    update();
    const unsubscribe = controller.subscribe(update);

    return () => {
      unsubscribe();
      document.title = base;
    };
  }, [controller]);
}
