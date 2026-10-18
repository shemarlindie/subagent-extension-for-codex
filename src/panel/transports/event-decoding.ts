import { decodeEventEnvelope } from "../../shared/events/decode.js";

const eventPageTools = new Set(["app_get_activity", "app_get_turn_activity"]);

/** Revalidates event pages at the browser boundary and leaves other tool data alone. */
export function decodePanelToolResult<T>(name: string, result: unknown): T {
  if (!eventPageTools.has(name)) return result as T;

  if (!isRecord(result) || !Array.isArray(result.events)) {
    throw new Error("The service returned an invalid activity page");
  }

  return {
    ...result,
    events: result.events.map(decodeEventEnvelope),
  } as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
