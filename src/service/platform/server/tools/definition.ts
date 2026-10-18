import { z } from "zod";

import {
  budgetRaiseSchema,
  deliveries,
  type InputAuthority,
} from "../../../../shared/tasks/model.js";
import { Control } from "../../../features/tasks/runtime/control.js";

export const taskId = z.object({ task_id: z.string() });

export const queuedMessage = taskId.extend({ message_id: z.string().max(200) });

export const messageInput = taskId.extend({
  request_id: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      "Reuse the same ID and payload when retrying an uncertain send. Accepted sends are deduplicated across service restarts.",
    ),
  message: z.string().min(1).max(20000),
  delivery: z
    .enum(deliveries)
    .default("steer")
    .describe(
      "steer (default): a running turn takes it at its next tool boundary, without stopping. queue: it waits and starts a turn of its own after the current one. interrupt: stop the running turn and start the next one with this message and any pending steers. On an idle task, each starts the next turn. A task waiting for input can't be steered; answer it with submit_agent_input, or queue the message.",
    ),
  budget: budgetRaiseSchema
    .optional()
    .describe(
      "Raise the task's budget first, so a turn stopped by its budget can carry on. Each limit can only go up: a higher amount, or null for no limit.",
    ),
});

/**
 * A tool whose handler receives its schema's parsed output. `run` uses method
 * syntax so any tool widens to `AnyTool` for name-based dispatch.
 */
type Tool<S extends z.ZodType, R> = {
  description: string;
  schema: S;
  outputSchema?: z.ZodType;
  /** Only reads state, so the proxy may safely send it twice. */
  readOnly?: boolean;
  destructive?: boolean;
  openWorld?: boolean;
  /** Returns a task and opens the panel inline beside the chat. */
  panel?: boolean;
  /**
   * Which host hints fill missing arguments: the chat for `chat`, and also
   * the host directory for `panel`. See withConversation.
   */
  conversation?: ConversationHints;
  run(args: z.output<S>): R;
};

export type ConversationHints = "chat" | "panel";

export type AnyTool = Tool<z.ZodType<Record<string, unknown>>, unknown>;

export const tool = <S extends z.ZodType, R>(definition: Tool<S, R>) =>
  definition;

/** What a group of tools runs against: the service, the caller and its authority. */
export interface ToolContext {
  c: Control;
  owner: string;
  authority: InputAuthority;
  hostMeta?: Record<string, unknown>;
}
