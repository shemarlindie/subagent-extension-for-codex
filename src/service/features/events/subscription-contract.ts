export type EventName =
  "agent_task.completed" | "agent_task.failed" | "agent_task.input_required";

/** @strict */
export interface Filters {
  task_id?: string;
  conversation_id?: string;
  provider?: string;
}

/** @strict */
export interface WebhookDelivery {
  mode: "webhook";
  /** @format url */
  url: string;
}

/** @strict */
export interface Identity {
  name: EventName;
  /** @default {} */
  arguments: Filters;
  delivery: WebhookDelivery;
}
