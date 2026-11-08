import { decodeEventEnvelope } from "../../shared/events/decode.js";
import type {
  ObservePanelTiming,
  PanelLoadOperation,
} from "../../shared/tasks/panel-timing.js";

/**
 * Revalidates event pages at the browser boundary, including a returned
 * view's Activity, and leaves other tool data alone.
 */
export function decodePanelToolResult<T>(
  name: string,
  result: unknown,
  observe?: ObservePanelTiming,
): T {
  if (name === "app_wait_for_updates") {
    const view = isRecord(result) ? result.view : undefined;
    if (!isRecord(view) || view.activity === undefined) return result as T;

    return {
      ...(result as Record<string, unknown>),
      view: { ...view, activity: decodePage(view.activity, "view", observe) },
    } as T;
  }

  if (name !== "app_get_turn_activity") return result as T;

  return decodePage(result, "activity_turn", observe) as T;
}

function decodePage(
  page: unknown,
  operation: PanelLoadOperation,
  observe?: ObservePanelTiming,
) {
  const started = performance.now();
  let rows = 0;
  let outcome: "success" | "error" = "error";

  try {
    if (!isRecord(page) || !Array.isArray(page.events)) {
      throw new Error("The service returned an invalid activity page");
    }

    const events = page.events.map(decodeEventEnvelope);
    rows = events.length;
    outcome = "success";

    return { ...page, events };
  } finally {
    observe?.(operation, "decode", performance.now() - started, {
      rows,
      outcome,
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
