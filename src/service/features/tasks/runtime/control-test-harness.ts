import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { structuredPatch } from "diff";
import { onTestFinished } from "vitest";

import { FixtureProvider } from "../../../../../dev/service/fixture-provider.js";
import type { Provider, RunContext } from "../../providers/types.js";
import { Workspaces } from "../../workspaces/workspace.js";
import { Store } from "../storage/store.js";
import { Control } from "./control.js";

export const pause = (ms = 10) => new Promise((r) => setTimeout(r, ms));

export async function until(fn: () => boolean) {
  for (let i = 0; i < 300; i++) {
    if (fn()) return;
    await pause();
  }

  throw new Error("Timed out");
}

export async function setup(
  provider: Provider = new FixtureProvider(),
  concurrency = 2,
) {
  const dir = await mkdtemp(join(tmpdir(), "codex-subagent-extension-test-"));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  const repo = join(dir, "repo");
  await mkdir(repo);
  execFileSync("git", ["init", "-q", repo]);

  execFileSync("git", [
    "-C",
    repo,
    "config",
    "user.email",
    "test@example.invalid",
  ]);

  execFileSync("git", ["-C", repo, "config", "user.name", "Test"]);
  await writeFile(join(repo, "README.md"), "hello\n");
  execFileSync("git", ["-C", repo, "add", "."]);
  execFileSync("git", ["-C", repo, "commit", "-qm", "initial"]);
  const db = join(dir, "tasks.sqlite");
  const store = new Store(db);

  const c = new Control(
    store,
    new Workspaces(join(dir, "worktrees"), [repo]),
    new Map([[provider.id, provider]]),
    concurrency,
  );

  onTestFinished(async () => {
    if (store.database.client.isOpen) await c.close();
  });

  return { dir, repo, db, store, c };
}

export const input = (repository: string, description = "Investigate") => ({
  provider: "fixture",
  repository,
  title: "Investigate task",
  description,
  workspace_strategy: "worktree",
});

/** The prompt each turn of a task started with. */
export class PromptRecorder extends FixtureProvider {
  prompts: string[] = [];
  override async run(c: RunContext, p: string) {
    this.prompts.push(p);

    return super.run(c, p);
  }
}

/** A task's events of one type. */
export function eventData(store: Store, id: string, type: string) {
  return store
    .events(id, "alice")
    .filter((e) => e.type === type)
    .map((e) => e.data);
}

/** Records dependency prompts and the file written by the prerequisite task. */
export class DependencyWriter extends FixtureProvider {
  readonly prompts = new Map<string, string>();

  constructor(
    private readonly path: string,
    private readonly content: string,
  ) {
    super();
  }

  override async run(c: RunContext, p: string) {
    this.prompts.set(c.task.id, p);

    if (c.task.description === "Write") {
      const path = join(c.task.workspace!, this.path);
      await writeFile(path, this.content);

      c.fileChanged({
        path,
        hunks: structuredPatch("", "", "", this.content).hunks,
        created: true,
        source: "tool",
      });
    }

    return super.run(c, p);
  }
}
