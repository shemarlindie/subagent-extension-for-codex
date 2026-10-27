import type { SettingsValues } from "../../../../shared/settings/settings-schema.js";
import type { InputAuthority, Start } from "../../../../shared/tasks/model.js";
import type { Provider } from "../../providers/types.js";
import { validateBudgets } from "./budget.js";
import { assertModelEffort } from "./model-effort.js";
import { generateTaskTitle } from "./task-title.js";

/**
 * A start request resolved for its provider and the owner's settings: the
 * provider's options, a generated title and a copy of the profile's
 * instructions. Rejects requests that can't start.
 */
export async function resolveStart(
  provider: Provider,
  input: Start,
  defaults: SettingsValues,
  authority: InputAuthority,
) {
  const readiness = await provider.readiness?.();
  if (readiness?.ready === false) throw new Error(readiness.message);

  const options = provider.taskPolicy.prepareStart({
    input,
    defaults,
    authority,
  });

  // Later edits to the profile apply to new tasks only.
  const instructions =
    defaults.profiles[input.worker_profile].instructions.trim();

  const req = {
    ...input,
    ...options,
    title: generateTaskTitle(input.description),
    description: input.description.trim(),
    ...(instructions ? { profile_instructions: instructions } : {}),
  };

  if (!req.title) throw new Error("Task title is required");
  if (!req.description) throw new Error("Task description is required");

  await assertModelEffort(provider, req, defaults);
  validateBudgets(provider, req);

  if (req.workspace_strategy === "current_repo" && req.revision !== "HEAD") {
    throw new Error("Current repository workspace requires revision HEAD");
  }

  return req;
}
