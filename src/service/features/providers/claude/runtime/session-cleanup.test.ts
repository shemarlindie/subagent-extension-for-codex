import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { beforeEach, expect, onTestFinished, test, vi } from "vitest";

import {
  claudeSessionDeletionStatus,
  deleteClaudeSession,
} from "./session-cleanup.js";

const id = "e834795b-43d0-43b3-9c1e-7174c397c53b";
let config: string;
let project: string;
let task: { session_id: string; session_state_ref: string };

beforeEach(async () => {
  config = await realpath(
    await mkdtemp(join(tmpdir(), "claude-cleanup-caf\u00e9-")),
  );

  vi.stubEnv("CLAUDE_CONFIG_DIR", config.normalize("NFD"));
  project = join(config, "projects", "first");
  await mkdir(project, { recursive: true });
  task = { session_id: id, session_state_ref: join(project, `${id}.jsonl`) };
  onTestFinished(() => rm(config, { recursive: true, force: true }));
});

test("recorded absent sessions succeed without offering nonexistent resources", async () => {
  await rm(join(config, "projects"), { recursive: true });
  const status = await claudeSessionDeletionStatus(task);
  expect(status).toMatchObject({ available: true, resources: [] });
  expect(status.version).toEqual(expect.any(String));
  await deleteClaudeSession(task, status.version);
});

test("reviewed cleanup rejects replacements and only deletes the recorded session", async () => {
  const artifacts: string[] = [];

  for (const name of ["first", "second"]) {
    const path = join(config, "projects", name, id);
    await mkdir(join(path, "subagents"), { recursive: true });
    await writeFile(join(path, "subagents", "agent.jsonl"), "subagent");
    await writeFile(`${path}.jsonl`, "main transcript");
    artifacts.push(path, `${path}.jsonl`);
  }

  const unrelated = join(project, "keep.jsonl");
  await writeFile(unrelated, "unrelated session");
  const reviewed = await claudeSessionDeletionStatus(task);

  expect(reviewed).toMatchObject({
    available: true,
    resources: [
      { path: task.session_state_ref, kind: "file" },
      { path: join(project, id), kind: "directory" },
    ],
  });

  expect(reviewed.version).toEqual(expect.any(String));

  // Keep the original inode allocated so replacement cannot reuse its identity.
  const previous = join(project, "previous-transcript.jsonl");
  await rename(task.session_state_ref, previous);
  await writeFile(task.session_state_ref, "replacement transcript");

  await expect(deleteClaudeSession(task, reviewed.version)).rejects.toThrow(
    "Session files changed",
  );

  expect(artifacts.map(existsSync)).toEqual([true, true, true, true]);

  expect(await readFile(task.session_state_ref, "utf8")).toBe(
    "replacement transcript",
  );

  const current = await claudeSessionDeletionStatus(task);
  await deleteClaudeSession(task, current.version);
  expect(artifacts.map(existsSync)).toEqual([false, false, true, true]);
  expect(await readFile(unrelated, "utf8")).toBe("unrelated session");
  expect(existsSync(previous)).toBe(true);
});

test("unreadable project stores block cleanup", async () => {
  await rm(join(config, "projects"), { recursive: true });
  await writeFile(join(config, "projects"), "not a directory");

  expect(await claudeSessionDeletionStatus(task)).toMatchObject({
    available: false,
  });

  await expect(deleteClaudeSession(task)).rejects.toThrow();
});

test("unverified recorded locations block cleanup", async () => {
  await writeFile(task.session_state_ref, "keep transcript");

  for (const invalid of [
    { ...task, session_id: "../first" },
    { session_id: id },
    { ...task, session_state_ref: `projects/first/${id}.jsonl` },
    { ...task, session_state_ref: join(config, `${id}.jsonl`) },
    { ...task, session_state_ref: join(project, "other.jsonl") },
    {
      ...task,
      session_state_ref: join(
        config,
        "old-config",
        "projects",
        "first",
        `${id}.jsonl`,
      ),
    },
  ]) {
    expect(await claudeSessionDeletionStatus(invalid)).toMatchObject({
      available: false,
    });

    await expect(deleteClaudeSession(invalid)).rejects.toThrow();
  }

  expect(await readFile(task.session_state_ref, "utf8")).toBe(
    "keep transcript",
  );
});

test("links in the recorded project, transcript and session tree block cleanup", async () => {
  const outside = join(config, "outside");
  const saved = join(outside, "saved.txt");
  await mkdir(outside);
  await writeFile(saved, "saved output");
  await writeFile(task.session_state_ref, "keep transcript");
  const linkedProject = join(config, "projects", "linked");

  for (const [path, type] of [
    [linkedProject, "dir"],
    [task.session_state_ref, "file"],
    [join(project, id), "dir"],
    [join(project, id, "subagents"), "dir"],
  ] as const) {
    await mkdir(dirname(path), { recursive: true });
    if (path === task.session_state_ref) await rm(path);
    await symlink(type === "file" ? saved : outside, path, type);

    const target =
      path === linkedProject
        ? { ...task, session_state_ref: join(linkedProject, `${id}.jsonl`) }
        : task;

    expect(await claudeSessionDeletionStatus(target)).toMatchObject({
      available: false,
    });

    await expect(deleteClaudeSession(target)).rejects.toThrow();
    expect(await readFile(saved, "utf8")).toBe("saved output");
    expect(existsSync(task.session_state_ref)).toBe(true);
    await rm(path);

    if (path === task.session_state_ref) {
      await writeFile(path, "keep transcript");
    }
  }
});

test("configured parent links are disclosed and changed disclosure invalidates review", async () => {
  const directory = join(project, id);
  await mkdir(directory);
  await writeFile(task.session_state_ref, "main transcript");
  const firstAlias = join(config, "first-alias");
  const secondAlias = join(config, "second-alias");
  await symlink(config, firstAlias, "dir");
  await symlink(config, secondAlias, "dir");
  vi.stubEnv("CLAUDE_CONFIG_DIR", firstAlias);

  const reviewed = await claudeSessionDeletionStatus(task);

  expect(reviewed).toMatchObject({
    available: true,
    resources: [
      {
        path: task.session_state_ref,
        kind: "file",
        symlinks: [{ path: firstAlias, target: config }],
      },
      {
        path: directory,
        kind: "directory",
        symlinks: [{ path: firstAlias, target: config }],
      },
    ],
  });

  expect(reviewed.version).toEqual(expect.any(String));

  vi.stubEnv("CLAUDE_CONFIG_DIR", secondAlias);

  await expect(deleteClaudeSession(task, reviewed.version)).rejects.toThrow(
    "Session files changed",
  );

  expect(await readFile(task.session_state_ref, "utf8")).toBe(
    "main transcript",
  );

  expect(existsSync(directory)).toBe(true);
});
