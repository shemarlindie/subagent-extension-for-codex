import type { Event } from "../../events/types.js";
import { claudeRateLimitWindows } from "../claude/rate-limit-windows.js";
import type { ActivityPresentation } from "./types.js";

/** Rendering reads only the presentation supplied by the provider. */
export function activityPresentation(event: Event): ActivityPresentation {
  const activity = event.data.activity;

  if (activity && typeof activity === "object" && !Array.isArray(activity)) {
    const presentation = activity as ActivityPresentation;

    // Older saved Claude events have presentation metadata but no normalized windows.
    if (
      presentation.kind === "rate_limit_event" &&
      presentation.rateLimitWindows === undefined
    ) {
      return {
        ...presentation,
        rateLimitWindows: claudeRateLimitWindows(event.data.rate_limit_info),
      };
    }

    return presentation;
  }

  return {};
}
