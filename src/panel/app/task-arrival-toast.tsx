import { Toast } from "@base-ui/react/toast";

import { useSnapshot } from "./state/controller-context";
import { taskArrivalTarget } from "./state/task-arrivals";
import { TaskArrivalNotification } from "./task-arrival-notification";

export function TaskArrivalToast() {
  const arrival = useSnapshot(taskArrivalTarget);

  return arrival ? (
    <Toast.Provider timeout={0} limit={1}>
      <TaskArrivalNotification taskId={arrival.id} title={arrival.title} />
    </Toast.Provider>
  ) : null;
}
