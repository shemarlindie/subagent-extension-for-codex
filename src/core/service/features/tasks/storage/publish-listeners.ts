import type { EventEmitter } from "node:events";

import { logError } from "../../../platform/logging/logger.js";

/** Isolate listener failures after commit so consumers can still catch up. */
export function publishListeners(
  bus: EventEmitter,
  name: string,
  args: unknown[],
) {
  for (const listener of bus.listeners(name)) {
    try {
      listener(...args);
    } catch (error) {
      logError("store.listener_failed", error, { listener: name });
    }
  }
}
