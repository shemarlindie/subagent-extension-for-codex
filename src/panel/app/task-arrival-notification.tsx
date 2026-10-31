import { Toast } from "@base-ui/react/toast";
import { useEffect } from "react";

import { buttonClass } from "../shared/components/button/button";
import { Icon } from "../shared/components/icons/icons";
import { useController } from "./state/controller-context";

type TaskArrivalNotificationProps = {
  taskId: string;
  title: string;
};

export function TaskArrivalNotification({
  taskId,
  title,
}: TaskArrivalNotificationProps) {
  const controller = useController();
  const { add, toasts } = Toast.useToastManager();

  useEffect(() => {
    // Update one toast so a later arrival preserves focus on its controls.
    add({
      id: "task-arrival",
      title: "New task",
      description: title,
      onClose: controller.dismissTaskArrival,
    });
  }, [add, controller, taskId, title]);

  return (
    <Toast.Viewport className="toast-viewport">
      {toasts.map((toast) => (
        <Toast.Root
          key={toast.id}
          toast={toast}
          className="toast-card task-arrival-toast"
          swipeDirection={[]}
        >
          <div className="task-arrival-copy">
            <Toast.Title className="task-arrival-label" />
            <Toast.Description className="task-arrival-title" title={title} />
          </div>
          <Toast.Action onClick={() => void controller.viewTaskArrival()}>
            View
          </Toast.Action>
          <Toast.Close
            aria-label="Dismiss new task notification"
            className={buttonClass("ghost", { className: "toast-close" })}
          >
            <Icon name="close" size={8} />
          </Toast.Close>
        </Toast.Root>
      ))}
    </Toast.Viewport>
  );
}
