import type {
  Defaults,
  DelegateDialogRead,
  DialogReadStatus,
  Project,
  Snapshot,
  Worker,
} from "../../app/state/types";
import { errorMessage } from "../../shared/utils/error-message";

/** What one finished read supplies: settings defaults or snapshot fields. */
export interface DelegateReadResult {
  defaults?: Defaults;
  snapshot?: Partial<Snapshot>;
}

export type DelegateReadStatuses = Record<DelegateDialogRead, DialogReadStatus>;

/** The read progress a new-task form shows, with any failures by resource. */
export interface DelegateReadState {
  statuses: DelegateReadStatuses;
  errors?: Partial<Record<DelegateDialogRead, string>>;
  defaults?: Defaults;
}

export interface DelegateReadContext {
  tool<T>(name: string): Promise<T>;
  readProjects(): Promise<Project[]>;
  /** Reads workers and records when they were read. */
  readWorkers(): Promise<Worker[]>;
}

type DelegateReadUpdate = (
  resource: DelegateDialogRead,
  status: DialogReadStatus,
  result?: DelegateReadResult,
  error?: unknown,
) => void;

/** Starting statuses: reads the snapshot already holds are ready. */
export function initialDelegateStatuses(
  state: Pick<Snapshot, "scopeKnown" | "projectsLoaded" | "workersLoaded">,
): DelegateReadStatuses {
  return {
    context: state.scopeKnown ? "ready" : "loading",
    settings: "loading",
    projects: state.projectsLoaded ? "ready" : "loading",
    workers: state.workersLoaded ? "ready" : "loading",
  };
}

/** Starts the reads still loading; the panel's own refresh supplies context. */
export function startDelegateReads(
  context: DelegateReadContext,
  statuses: DelegateReadStatuses,
  update: DelegateReadUpdate,
) {
  const failed = (resource: DelegateDialogRead) => (error: unknown) =>
    update(resource, "error", undefined, error);

  if (statuses.settings === "loading") {
    void context
      .tool<{ values: Defaults }>("get_settings")
      .then(
        ({ values }) => update("settings", "ready", { defaults: values }),
        failed("settings"),
      );
  }

  if (statuses.projects === "loading") {
    void context.readProjects().then(
      (projects) =>
        update("projects", "ready", {
          snapshot: { projects, projectsLoaded: true },
        }),
      failed("projects"),
    );
  }

  if (statuses.workers === "loading") {
    void context.readWorkers().then(
      (workers) =>
        update("workers", "ready", {
          snapshot: { workers, workersLoaded: true },
        }),
      failed("workers"),
    );
  }
}

/** Records one read's outcome on a form's read state. */
export function applyDelegateRead<T extends DelegateReadState>(
  current: T,
  resource: DelegateDialogRead,
  status: DialogReadStatus,
  result?: DelegateReadResult,
  error?: unknown,
): T {
  const errors = { ...current.errors };

  if (status === "error") errors[resource] = errorMessage(error);
  else delete errors[resource];

  return {
    ...current,
    statuses: { ...current.statuses, [resource]: status },
    errors,
    ...(result && "defaults" in result ? { defaults: result.defaults } : {}),
  };
}

/** True once every read is ready and settings supplied defaults. */
export function delegateReadsReady<T extends DelegateReadState>(
  state: T,
): state is T & { defaults: Defaults } {
  return (
    Object.values(state.statuses).every((item) => item === "ready") &&
    Boolean(state.defaults)
  );
}

/** Marks failed reads loading again, for a retry. */
export function retryDelegateStatuses<T extends DelegateReadState>(state: T) {
  const statuses = { ...state.statuses };
  const errors = { ...state.errors };

  for (const resource of Object.keys(statuses) as DelegateDialogRead[]) {
    if (statuses[resource] !== "error") continue;
    statuses[resource] = "loading";
    delete errors[resource];
  }

  return { ...state, statuses, errors };
}
