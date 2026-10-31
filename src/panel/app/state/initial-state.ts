import { DEFAULT_PAGE } from "../navigation/pages";
import { CONNECTION } from "./connection";
import type { Snapshot } from "./types";

export function initialState(): Snapshot {
  return {
    page: DEFAULT_PAGE,
    tasks: [],
    workers: [],
    workersLoaded: false,
    projects: [],
    projectsLoaded: false,
    events: [],
    taskListLoading: true,
    revision: "HEAD",
    filter: null,
    search: "",
    tab: "chat",
    connected: false,
    scopeKnown: false,
    busy: false,
    connection: CONNECTION.connecting,
    error: "",
    loginRequired: false,
    formError: "",
    scopeVersion: 0,
    undoRevision: 0,
    host: {
      canSend: false,
      canShare: false,
      canExpand: false,
      displayMode: "inline",
    },
  };
}
