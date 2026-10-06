import type { Snapshot } from "./types";

export function initialState(): Snapshot {
  return {
    tasks: [],
    workers: [],
    projects: [],
    events: [],
    revision: "HEAD",
    filter: null,
    search: "",
    tab: "result",
    connected: false,
    scopeKnown: false,
    busy: false,
    connection: "Connecting…",
    error: "",
    loginRequired: false,
    formError: "",
    scopeVersion: 0,
    host: {
      canSend: false,
      canShare: false,
      canExpand: false,
      displayMode: "inline",
    },
  };
}
