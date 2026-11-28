import { readOnlyProfile } from "../../../../../providers/claude/shared/permissions.js";
import type { SettingsValues } from "../../../../shared/settings/settings-schema.js";
import type {
  InputAuthority,
  Start,
  Task,
} from "../../../../shared/tasks/model.js";
import { logEvent } from "../../../platform/logging/logger.js";
import type { Provider } from "../../providers/types.js";
import { gitState, WORKTREE_NEEDS_GIT } from "../../workspaces/git.js";
import { validateBudgets } from "./budget.js";
import { assertModelEffort, modelRejectingEffort } from "./model-effort.js";
import { checkStartPolicy, type Requested } from "./policy-check.js";
import { generateTaskTitle } from "./task-title.js";

/**
 * A start request resolved for its provider and the owner's settings: the
 * provider's options, a generated title and a copy of the profile's
 * instructions, with what policy changed. `repository` is the resolved project
 * folder, whose settings the checks follow. Rejects requests that can't start,
 * once the provider is ready.
 */
export async function resolveStart(
  provider: Provider,
  input: Start,
  defaults: SettingsValues,
  authority: InputAuthority,
  requested: Requested,
  repository: string,
) {
  const {
    model,
    reasoning_effort: fitted,
    limited,
  } = await checkStartPolicy(provider, input, defaults, requested, repository);

  // A saved effort the model can't run gives way, since nobody asked for it
  // just now. One the request names fails below.
  const rejecting =
    !requested.effort &&
    (await modelRejectingEffort(
      provider,
      { model, reasoning_effort: fitted },
      defaults,
      repository,
    ));

  if (rejecting) {
    logEvent("info", "task.saved_effort_skipped", {
      provider: provider.id,
      model: rejecting,
      effort: fitted,
    });
  }

  const effort = rejecting ? undefined : fitted;

  // Policy may have replaced the saved effort, so check the one that runs.
  const options = provider.taskPolicy.prepareStart({
    input: { ...input, model, reasoning_effort: effort },
    defaults,
    authority,
  });

  // Later edits to the profile apply to new tasks only.
  const instructions =
    defaults.profiles[input.worker_profile].instructions.trim();

  const req = {
    ...input,
    model,
    reasoning_effort: effort,
    ...options,
    title: generateTaskTitle(input.description),
    description: input.description.trim(),
    ...(instructions ? { profile_instructions: instructions } : {}),
  };

  if (!req.title) throw new Error("Task title is required");
  if (!req.description) throw new Error("Task description is required");

  await assertModelEffort(provider, req, defaults, repository);
  validateBudgets(provider, req);

  if (req.workspace_strategy === "current_repo" && req.revision !== "HEAD") {
    throw new Error("Project folder workspace requires revision HEAD");
  }

  return { req, limited };
}

/**
 * Fits a start request to its project's Git state. An explicit worktree or
 * revision fails at once. A saved worktree default falls back to the project
 * folder, and a writing task records that it lost the isolation.
 */
export async function resolveProjectWorkspace(
  repository: string,
  req: Pick<Start, "revision" | "workspace_strategy" | "worker_profile">,
  defaults: SettingsValues,
  worktreeRequested: boolean,
): Promise<Pick<Task, "workspace_strategy" | "workspace_fallback">> {
  const savedWorktree = defaults.task.workspace_strategy === "worktree";

  if (req.workspace_strategy === "current_repo" && !savedWorktree) {
    return { workspace_strategy: req.workspace_strategy };
  }

  const state = await gitState(repository);
  if (state === "ready") return { workspace_strategy: req.workspace_strategy };

  if (worktreeRequested || req.revision !== "HEAD") {
    throw new Error(WORKTREE_NEEDS_GIT);
  }

  return {
    workspace_strategy: "current_repo",
    ...(!readOnlyProfile(req.worker_profile)
      ? { workspace_fallback: state === "none" ? "no_git" : "no_commits" }
      : {}),
  };
}
