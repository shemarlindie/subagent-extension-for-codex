import { settingsDefaults } from "../../../shared/settings/settings-schema";
import type {
  Defaults,
  DialogReadStatus,
  DialogState,
  PersistedDialogDraft,
  Snapshot,
  Worker,
} from "../../app/state/types";
import type { DelegateValues } from "./delegate-values";
import { workerChoice } from "./delegation";
import { providerOptionDefaults } from "./provider-defaults";

export type DelegateFormDialog =
  | Extract<DialogState, { kind: "delegate" }>
  | Extract<DialogState, { kind: "delegate-loading" }>;

type DelegateScope = Pick<
  Snapshot,
  "workers" | "scopeKnown" | "repository" | "revision"
>;

// Fields wait for the settings read, so these only fill the form's shape.
const FALLBACK_DEFAULTS: Defaults = settingsDefaults("");

const READY = {
  context: "ready",
  settings: "ready",
  projects: "ready",
  workers: "ready",
} satisfies Record<
  "context" | "settings" | "projects" | "workers",
  DialogReadStatus
>;

/** The dialog's read statuses, errors and defaults; a loaded dialog has every read. */
export function delegateReads(dialog: DelegateFormDialog) {
  const loading = dialog.kind === "delegate-loading";

  return {
    loading,
    statuses: loading ? dialog.statuses : READY,
    errors: loading ? dialog.errors : undefined,
    message: loading ? dialog.message : undefined,
    defaults:
      dialog.kind === "delegate"
        ? dialog.defaults
        : (dialog.defaults ?? FALLBACK_DEFAULTS),
  };
}

/** Every `provider:profile` worker choice. */
export function workerChoices(workers: Worker[]) {
  return workers.flatMap((worker) =>
    worker.profiles.map((profile) => `${worker.provider}:${profile}`),
  );
}

/** The project and revision a new task targets: the dialog's, then the panel scope's. */
export function delegateTarget(
  dialog: DelegateFormDialog,
  scope: DelegateScope,
) {
  if (dialog.kind === "delegate") {
    return { repository: dialog.repository, revision: dialog.revision };
  }

  return {
    repository:
      dialog.repository ?? (scope.scopeKnown ? scope.repository : undefined),
    revision: dialog.revision ?? (scope.scopeKnown ? scope.revision : "HEAD"),
  };
}

/** A new task's revision: blank until settings and context load, HEAD for the current repo. */
function startingRevision(ready: boolean, strategy: string, revision: string) {
  if (!ready) return "";

  return strategy === "current_repo" ? "HEAD" : revision;
}

/** A new task's worker: the dialog's choice, then the default, then the first available. */
function startingWorker(
  choices: string[],
  preferredWorker: string | undefined,
  preferred: string,
  settingsReady: boolean,
) {
  if (preferredWorker && choices.includes(preferredWorker)) {
    return preferredWorker;
  }

  if (!settingsReady) return "";

  return choices.includes(preferred) ? preferred : (choices[0] ?? "");
}

/** A budget's starting mode: blank until settings load, then limited unless turned off. */
function startingBudgetMode(settingsReady: boolean, unlimited: boolean) {
  if (!settingsReady) return "";

  return unlimited ? "none" : "limited";
}

/** A saved draft's budget amount, while settings have not supplied one yet. */
function draftAmount(draft: PersistedDialogDraft, key: "runtime" | "cost") {
  const value = draft[key];

  return typeof value === "number" && Number.isFinite(value) ? value : "";
}

interface DelegateInitialValuesInput {
  dialog: DelegateFormDialog;
  scope: DelegateScope;
  draft: PersistedDialogDraft;
}

/**
 * The form's starting values. Fields that depend on settings or context stay
 * blank until those reads finish, so the form can fill them in later.
 */
export function delegateInitialValues({
  dialog,
  scope,
  draft,
}: DelegateInitialValuesInput): DelegateValues {
  const { statuses, defaults } = delegateReads(dialog),
    settingsReady = statuses.settings === "ready",
    contextReady = statuses.context === "ready",
    target = delegateTarget(dialog, scope),
    { budget } = defaults.task;

  const preferred =
    dialog.preferredWorker ??
    `${defaults.task.provider}:${defaults.task.worker_profile}`;

  const { provider: preferredProvider } = workerChoice(preferred),
    preferredWorker = scope.workers.find(
      (worker) => worker.provider === preferredProvider,
    );

  const strategy = settingsReady ? defaults.task.workspace_strategy : "";

  return {
    ...providerOptionDefaults(
      preferredProvider,
      preferredWorker?.metadata,
      defaults,
    ),
    repository: target.repository ?? "",
    revision: startingRevision(
      settingsReady && contextReady,
      strategy,
      target.revision,
    ),
    workspace_strategy: strategy,
    description: "",
    model: "",
    worker: startingWorker(
      workerChoices(scope.workers),
      dialog.preferredWorker,
      preferred,
      settingsReady,
    ),
    runtimeMode: startingBudgetMode(
      settingsReady,
      !budget.max_runtime_minutes.enabled,
    ),
    runtime: settingsReady
      ? budget.max_runtime_minutes.amount
      : draftAmount(draft, "runtime"),
    costMode: startingBudgetMode(settingsReady, !budget.max_cost_usd.enabled),
    cost: settingsReady
      ? budget.max_cost_usd.amount
      : draftAmount(draft, "cost"),
    reasoning_effort: settingsReady ? "default" : "",
    context: "",
    deps: [],
  };
}
