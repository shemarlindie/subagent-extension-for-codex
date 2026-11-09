import { randomUUID } from "node:crypto";

import { assertSelectedProviderOptions } from "../../../../shared/providers/options.js";
import {
  assertNoLegacyContext,
  type InputAuthority,
  startSchema,
  type Task,
} from "../../../../shared/tasks/model.js";
import { now } from "../../../../shared/time.js";
import type { Control } from "./control.js";
import { logStartLimited } from "./execution-logging.js";
import { effortRequested } from "./policy-check.js";
import type { ProjectGuard } from "./project-guard.js";
import { resolveProjectWorkspace, resolveStart } from "./start-request.js";

type StartContext = Pick<
  Control,
  "store" | "settings" | "providers" | "projects" | "workspaces" | "attachments"
>;

/**
 * Saves a queued task for a start request, with its attachments. The guard
 * keeps a project removal that overlaps the start from missing the task.
 */
export async function startTask(
  c: StartContext,
  guard: ProjectGuard,
  owner: string,
  input: unknown,
  authority: InputAuthority,
) {
  assertNoLegacyContext(input);
  const parsed = startSchema.parse(c.settings.taskInput(owner, input));

  assertSelectedProviderOptions(parsed.provider, parsed.provider_options);
  const provider = c.providers.get(parsed.provider);
  if (!provider) throw new Error("Provider is not enabled");

  const {
    req: { attachments, ...req },
    limited,
  } = await resolveStart(
    provider,
    parsed,
    c.settings.values(owner),
    authority,
    !!(input as { model?: unknown }).model,
    effortRequested(input),
  );

  const repository = c.projects
    ? await c.projects.resolve(req.repository)
    : await c.workspaces.repository(req.repository);

  // Repository resolution can yield while the project is being deleted.
  return guard.start(repository, c.projects, async (check) => {
    const workspace = await resolveProjectWorkspace(
      repository,
      req,
      c.settings.values(owner),
      (input as { workspace_strategy?: unknown }).workspace_strategy ===
        "worktree",
    );

    const t: Task = {
      ...req,
      ...workspace,
      repository,
      id: `task_${randomUUID()}`,
      owner,
      created_by: authority,
      status: "queued",
      instructions_sent: 0,
      pending_steers: [],
      queue: [],
      created_at: now(),
      updated_at: now(),
      turn: 0,
      runtime_ms: 0,
    };

    const snapshots = await c.attachments.prepare(
      t.id,
      repository,
      attachments ?? [],
    );

    try {
      c.store.transaction(() => {
        // In the transaction, so a CLI revocation can't land before the save.
        check();
        c.store.save(t);
        c.attachments.save(t.id, snapshots);
        c.store.event(t, "task.queued");
        if (limited) c.store.event(t, "agent.limited", limited);
      });
    } catch (error) {
      if (snapshots.length) await c.attachments.discard(t.id);
      throw error;
    }

    if (limited) logStartLimited(t, limited);

    return t;
  });
}
