import { decodeEventEnvelope } from "../../shared/events/decode.js";
import {
  type ObservePanelTiming,
  panelLoadOperation,
} from "../../shared/tasks/panel-timing.js";

const eventPageTools = new Set(["app_get_activity", "app_get_turn_activity"]);

/** Revalidates event pages at the browser boundary and leaves other tool data alone. */
export function decodePanelToolResult<T>(
  name: string,
  result: unknown,
  observe?: ObservePanelTiming,
): T {
  if (!eventPageTools.has(name)) return result as T;

  const started = performance.now();
  let rows = 0;
  let outcome: "success" | "error" = "error";

  try {
    if (!isRecord(result) || !Array.isArray(result.events)) {
      throw new Error("The service returned an invalid activity page");
    }

    const events = result.events.map(decodeEventEnvelope);
    rows = events.length;
    outcome = "success";

    return { ...result, events } as T;
  } finally {
    observe?.(
      panelLoadOperation(name)!,
      "decode",
      performance.now() - started,
      { rows, outcome },
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
