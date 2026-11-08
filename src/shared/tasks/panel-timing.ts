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
const panelCallTimingRecordSchema = z.strictObject({
  operation: z.enum(timedOperations),
  duration_ms: z.number().nonnegative().max(3_600_000),
  task_id: z.string().regex(taskIdPattern).optional(),
  request_id: z.string().regex(panelRequestIdPattern).optional(),
  /** How the call itself settled. */
  outcome: z.enum(["success", "error"]).optional(),
  /** Whether the panel stopped waiting before the call settled. */
  ui_timed_out: z.boolean().optional(),
});

export const PANEL_TIMING_MAX_COUNT = 1_000_000_000;
export const PANEL_TIMING_MAX_DURATION_MS = 1_000_000_000_000;
const workCount = z.number().int().nonnegative().max(PANEL_TIMING_MAX_COUNT);
const elapsed = z.number().nonnegative().max(PANEL_TIMING_MAX_DURATION_MS);

const panelLoadTimingRecordSchema = z.strictObject({
  operation: z.enum(["view", "task_list", "activity_latest", "activity_turn"]),
  phase: z.enum(["fetch", "deliver", "decode", "merge", "group"]),
  count: workCount.positive(),
  total_ms: elapsed,
  max_ms: elapsed,
  rows: workCount,
  groups: workCount,
  stale_count: workCount,
  error_count: workCount,
});

const panelTimingRecordSchema = z.union([
  panelCallTimingRecordSchema,
  panelLoadTimingRecordSchema,
]);

export const panelTimingBatchSchema = z.strictObject({
  records: z.array(panelTimingRecordSchema).min(1).max(50),
  dropped_count: workCount.optional(),
});

export type PanelCallTimingRecord = z.infer<typeof panelCallTimingRecordSchema>;
export type PanelLoadTimingRecord = z.infer<typeof panelLoadTimingRecordSchema>;
export type PanelLoadOperation = PanelLoadTimingRecord["operation"];
export type PanelLoadPhase = PanelLoadTimingRecord["phase"];

export interface PanelTimingWork {
  rows?: number;
  groups?: number;
  stale_count?: number;
  outcome?: "success" | "error";
}

export type ObservePanelTiming = (
  operation: PanelLoadOperation,
  phase: PanelLoadPhase,
  duration: number,
  work?: PanelTimingWork,
) => void;

export function panelLoadOperation(
  name: string,
): PanelLoadOperation | undefined {
  switch (name) {
    case "app_list_tasks":
      return "task_list";
    case "app_get_activity":
      return "activity_latest";
    case "app_get_turn_activity":
      return "activity_turn";
    default:
      return undefined;
  }
}

export function isTimedPanelOperation(
  name: string,
): name is PanelCallTimingRecord["operation"] {
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
