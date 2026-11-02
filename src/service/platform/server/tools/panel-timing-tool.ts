import { panelTimingBatchSchema } from "../../../../shared/tasks/panel-timing.js";
import {
  recordTaskTiming,
  sendRef,
} from "../../../features/tasks/runtime/timing.js";
import { tool } from "./definition.js";

/** App-only diagnostic receiver. This request is never the measured request. */
export function panelTimingTool() {
  return tool({
    description:
      "User interface only: append bounded panel call and processing timings to the service timing log.",
    schema: panelTimingBatchSchema,
    run: ({ records, dropped_count }) => {
      if (dropped_count) {
        recordTaskTiming({
          phase: "panel_reporting",
          dropped_count,
          request_id: undefined,
        });
      }

      for (const entry of records) {
        if ("phase" in entry) {
          recordTaskTiming({ ...entry, request_id: undefined });
        } else {
          const { request_id: requestId, ...record } = entry;

          recordTaskTiming({
            phase: "transport",
            ...record,
            send_ref: sendRef(requestId),
            request_id: undefined,
          });
        }
      }

      return { recorded: records.length };
    },
  });
}
