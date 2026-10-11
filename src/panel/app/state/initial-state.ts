import { DEFAULT_PAGE } from "../navigation/pages";
import type { Snapshot } from "./types";

export function initialState(): Snapshot {
  return {
    page: DEFAULT_PAGE,
    tasks: [],
    workers: [],
    projects: [],
    events: [],
    revision: "HEAD",
    filter: null,
    search: "",
    tab: "chat",
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
