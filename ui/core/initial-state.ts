import type { Mode, Snapshot } from "./types";

export function initialState(mode: Mode, path: string): Snapshot {
  return {
    mode,
    tasks: [],
    workers: [],
    projects: [],
    events: [],
    artifacts: [],
    revision: "HEAD",
    filter: null,
    search: "",
    tab: "result",
    connected: false,
    scopeKnown: mode === "console",
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
    ...(mode === "console"
      ? {
          selected: path.match(/\/tasks\/([^/]+)/)?.[1],
          workerRoute: path.match(/\/workers\/([^/]+)/)?.[1],
          selectedArtifact: path.match(/\/artifacts\/([^/]+)/)?.[1],
          tab: path.includes("/artifacts/") ? "changes" : "activity",
        }
      : {}),
  };
}
