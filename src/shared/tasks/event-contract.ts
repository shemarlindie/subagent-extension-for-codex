type EmptyEventPayload = Record<string, never>;

interface TaskStartedPayload {
  turn: number;
}

interface TaskTurnEndedPayload {
  turn: number;
  outcome: "completed" | "failed" | "interrupted";
  runtime_ms: number;
  cost_usd: number;
}

interface TaskInstructionPayload {
  message_id: string;
  message: string;
  from: "user" | "parent";
  delivery: "steer" | "queue" | "interrupt";
}

interface TaskQueueChangedPayload {
  queue: Array<{
    message_id: string;
    message: string;
    from: "user" | "parent";
  }>;
  paused: boolean;
}

interface TaskSessionStartedPayload {
  reason: "no_session" | "session_unavailable";
}

interface TaskWorktreeRecreatedPayload {
  from: "branch" | "base";
}

interface TaskInterruptedPayload {
  reason?: "service_restart";
  error?: string;
}

interface TaskFailedPayload {
  error?: string;
  error_code?: string;
}

interface TaskWorktreeRemovedPayload {
  path?: string;
  branch?: string;
  forced?: boolean;
}

interface TaskBranchDeletedPayload {
  branch?: string;
}

interface TaskControlRequestedPayload {
  status: "interrupted";
}

interface TaskSteerTakenPayload {
  message_id: string;
}

interface TaskMessageRemovedPayload {
  message_id: string;
}

interface TaskStatusPayload {
  error?: string;
}

/** Lifecycle and conversation payloads owned by the shared task feature. */
export interface TaskEventPayloadMap {
  "task.started": TaskStartedPayload;
  "task.turn_ended": TaskTurnEndedPayload;
  "task.instruction": TaskInstructionPayload;
  "task.queue_changed": TaskQueueChangedPayload;
  "task.session_started": TaskSessionStartedPayload;
  "task.worktree_recreated": TaskWorktreeRecreatedPayload;
  "task.interrupted": TaskInterruptedPayload;
  "task.failed": TaskFailedPayload;
  "task.worktree_removed": TaskWorktreeRemovedPayload;
  "task.branch_deleted": TaskBranchDeletedPayload;
  "task.control_requested": TaskControlRequestedPayload;
  "task.steer_taken": TaskSteerTakenPayload;
  "task.message_removed": TaskMessageRemovedPayload;
  "task.queued": EmptyEventPayload;
  "task.completed": TaskStatusPayload;
}
