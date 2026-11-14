import type { SettingsValues } from "../../../../shared/settings/settings-schema.js";
import type { Task } from "../../../../shared/tasks/model.js";
import { now } from "../../../../shared/time.js";
import type { Changes } from "../../changes/changes.js";
import type { Projects } from "../../projects/projects.js";
import type { Provider } from "../../providers/types.js";
import { gitState } from "../../workspaces/git.js";
import type { Workspaces } from "../../workspaces/workspace.js";
import type { SessionPrompts } from "../conversation/session-prompts.js";
import type { Store } from "../storage/store.js";
import { worktreeClaimed } from "../storage/task-rows.js";
import { logStartLimited } from "./execution-logging.js";
import { limitTurnModel } from "./policy-check.js";
import { measureTaskWait } from "./timing.js";

/** What readying a turn reads and writes. */
export interface TurnStartupContext {
  store: Store;
  workspaces: Workspaces;
  changes: Changes;
  prompts: SessionPrompts;
  projects?: Projects;
  ownerWorker: string;
  settings(owner: string): SettingsValues;
  branchPrefix(owner: string): string;
}

/**
 * Readies a turn up to the provider run and records each step's timing:
 * repository validation, workspace preparation and session selection, which
 * marks the turn running. Resolves with why a new session started, if one did.
 */
export async function startTurn(
  c: TurnStartupContext,
  t: Task,
  provider: Provider,
  begin: number,
  signal: AbortSignal,
) {
  const timing = { task_id: t.id, turn: t.turn };
  const { projects } = c;
  const limited = await limitTurnModel(provider, t, c.settings(t.owner));

  if (limited) {
    c.store.event(t, "agent.limited", limited);
    logStartLimited(t, limited);
  }

  if (projects) {
    await measureTaskWait(
      "repository_validation",
      timing,
      () => projects.resolve(t.repository),
      { signal },
    );
  }

  await measureTaskWait(
    "workspace_preparation",
    { ...timing, workspace_strategy: t.workspace_strategy },
    () => prepareWorkspace(c, t),
    { signal, detail: (action) => ({ workspace_action: action }) },
  );

  c.store.save(t);
  if (signal.aborted) throw signal.reason;

  return measureTaskWait(
    "session_selection",
    timing,
    () => beginTurn(c, t, provider, begin),
    {
      signal,
      detail: (reason) => ({
        session: reason ? "new" : "resumed",
        new_session_reason: reason,
      }),
    },
  );
}

/** The turn's prompt: a new session's whole context, or only what's unsent. */
export function turnPrompt(
  c: TurnStartupContext,
  t: Task,
  newSession: string | undefined,
  signal: AbortSignal,
) {
  return measureTaskWait(
    "prompt_assembly",
    { task_id: t.id, turn: t.turn, session: newSession ? "new" : "resumed" },
    async () =>
      newSession ? c.prompts.sessionPrompt(t) : c.prompts.resumedPrompt(t),
    { signal },
  );
}

/**
 * Readies the task's workspace for a turn: creates it on the first turn,
 * recreates a removed worktree, and clears the latest-turn edits.
 */
async function prepareWorkspace(c: TurnStartupContext, t: Task) {
  let action: "created" | "recreated" | "reused" = "reused";

  if (!t.workspace) {
    await c.workspaces.create(t, c.branchPrefix(t.owner), (branch, path) =>
      worktreeClaimed(c.store.database.orm, branch, path),
    );

    c.store.save(t);
    action = "created";
  } else if (await c.workspaces.worktreeMissing(t)) {
    // Remove worktree only frees disk space; the next turn brings it back.
    const from = await c.workspaces.recreateWorktree(t);
    delete t.workspace_removed;
    delete t.branch_deleted;

    c.store.transaction(() => {
      c.store.save(t);
      c.store.event(t, "task.worktree_recreated", { from });
    });

    action = "recreated";
  }

  // Read each turn, so a later `git init` or a removed `.git` takes effect.
  if (t.workspace_strategy === "current_repo") {
    if ((await gitState(t.workspace!)) === "none") t.no_git = true;
    else delete t.no_git;
  }

  // Only a new control-plane turn resets the latest-turn edits.
  c.changes.clearTurn(t);

  return action;
}

/**
 * Marks the turn running, starting a new provider session when the saved
 * one can't continue. Resolves with why a new session started, if one did.
 */
async function beginTurn(
  c: TurnStartupContext,
  t: Task,
  provider: Provider,
  begin: number,
) {
  const newSession = await c.prompts.newSessionReason(
    t,
    provider,
    c.ownerWorker,
  );

  if (newSession) {
    // The session can't continue, so this turn starts another.
    delete t.session_id;
    delete t.session_state_ref;
    delete t.session_cost_usd;
  }

  t.status = "running";
  t.started_at ??= now();
  t.run_started_at = new Date(begin).toISOString();
  t.session_owner = c.ownerWorker;

  c.store.transaction(() => {
    if (newSession && t.turn > 1) {
      c.store.event(t, "task.session_started", { reason: newSession });
    }

    c.store.save(t);
    c.store.event(t, "task.started", { turn: t.turn });
  });

  return newSession;
}
