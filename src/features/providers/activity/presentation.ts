import type { Event } from "../../../shared/contracts.js";
import type { ActivityPresentation } from "./types.js";

/** Rendering reads only the presentation supplied by the provider. */
export function activityPresentation(event: Event): ActivityPresentation {
  const activity = event.data.activity;
  if (activity && typeof activity === "object" && !Array.isArray(activity))
    return activity as ActivityPresentation;

  return {};
}
