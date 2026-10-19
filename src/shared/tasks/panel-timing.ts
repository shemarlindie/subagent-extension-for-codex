import { z } from "zod";

/** The panel calls whose durations the service timing log accepts. */
const timedOperations = ["app_send_message", "interrupt_task"] as const;

const taskIdPattern =
  /^task_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The panel generates its send request IDs as 32 hexadecimal digits. */
const panelRequestIdPattern = /^[0-9a-f]{32}$/;

/**
 * One measured panel call. Every field is bounded, so the log never holds
 * message text or other arbitrary input. The service stores only a hash of
 * the request ID.
 */
export const panelTimingRecordSchema = z.strictObject({
  operation: z.enum(timedOperations),
  duration_ms: z.number().nonnegative().max(3_600_000),
  task_id: z.string().regex(taskIdPattern).optional(),
  request_id: z.string().regex(panelRequestIdPattern).optional(),
  /** How the call itself settled. */
  outcome: z.enum(["success", "error"]).optional(),
  /** Whether the panel stopped waiting before the call settled. */
  ui_timed_out: z.boolean().optional(),
});

export type PanelTimingRecord = z.infer<typeof panelTimingRecordSchema>;

export function isTimedPanelOperation(
  name: string,
): name is PanelTimingRecord["operation"] {
  return (timedOperations as readonly string[]).includes(name);
}

/**
 * The call arguments that correlate its timing with service records. Values
 * outside the accepted formats are left out so they can't reject a batch.
 */
export function panelTimingCorrelation(args: Record<string, unknown>) {
  const { task_id: taskId, request_id: requestId } = args;

  return {
    ...(typeof taskId === "string" && taskIdPattern.test(taskId)
      ? { task_id: taskId }
      : {}),
    ...(typeof requestId === "string" && panelRequestIdPattern.test(requestId)
      ? { request_id: requestId }
      : {}),
  };
}
