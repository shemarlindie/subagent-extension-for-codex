import assert from "node:assert/strict";
import {
  type ChildProcess,
  execFile,
  type ExecFileOptions,
  execFileSync,
} from "node:child_process";
import { once } from "node:events";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, test, vi } from "vitest";

import { gitRepositoryRoot, gitState, gitWorkTreeRoot } from "./git.js";
import { Workspaces } from "./workspace.js";

const deadline = vi.hoisted(() => ({
  expireWhenReady: false,
  child: undefined as ChildProcess | undefined,
}));

vi.mock("node:util", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:util")>();

  return {
    ...actual,
    promisify: (fn: Parameters<typeof actual.promisify>[0]) => {
      if (fn !== execFile) return actual.promisify(fn);

      const exec = actual.promisify(execFile);

      return (
        file: string,
        args: readonly string[],
        options: ExecFileOptions,
      ) => {
        if (!deadline.expireWhenReady) return exec(file, args, options);

        assert.equal(options.timeout, 5000);
        assert.equal(options.killSignal, "SIGKILL");

        // Simulate expiration only after the stub installs its SIGTERM handler
        // and announces readiness. Node still runs and kills the real child,
        // while scheduler contention cannot consume the fixture's startup time.
        const run = exec(file, args, { ...options, timeout: 0 });
        deadline.child = run.child;

        run.child.stdout!.once("data", () =>
          run.child.kill(options.killSignal),
        );

        return run;
      };
    },
  };
});

let directory: string;

beforeEach(async () => {
  deadline.child = undefined;
  directory = await realpath(await mkdtemp(join(tmpdir(), "git-validation-")));
});

afterEach(async () => {
  deadline.expireWhenReady = false;
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

async function stalledGit() {
  const bin = join(directory, "bin");
  const pidFile = join(directory, "git.pid");
  await mkdir(bin);

  await writeFile(
    join(bin, "git"),
    `#!${process.execPath}\nrequire("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nprocess.on("SIGTERM", () => {});\nprocess.stdout.write("ready\\n");\nsetInterval(() => {}, 1000);\n`,
    { mode: 0o700 },
  );

  vi.stubEnv("PATH", bin);

  return pidFile;
}

test("repository validation configures a deadline and force-kills ready Git on simulated expiration", async (t) => {
  const pidFile = await stalledGit();

  t.onTestFinished(async () => {
    const child = deadline.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;

    child.kill("SIGKILL");
    await once(child, "close");
  });

  deadline.expireWhenReady = true;
  const workspaces = new Workspaces(join(directory, "workspaces"), [directory]);

  await assert.rejects(
    workspaces.repository(directory),
    /Git repository validation did not finish within 5 seconds/,
  );

  const pid = Number(await readFile(pidFile, "utf8"));
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
});

test("an unapproved root is rejected before running Git", async () => {
  const pidFile = await stalledGit();
  const workspaces = new Workspaces(join(directory, "workspaces"), []);

  await assert.rejects(
    workspaces.repository(directory),
    /outside allowed roots/,
  );

  await assert.rejects(readFile(pidFile), { code: "ENOENT" });
});

test("bounded validation preserves Git errors and canonical-root approval", async () => {
  await assert.rejects(gitRepositoryRoot(directory), /not a git repository/);
  execFileSync("git", ["init", "-q", directory]);
  const workspaces = new Workspaces(join(directory, "workspaces"), [directory]);
  assert.equal(await workspaces.repository(directory), directory);

  const child = join(directory, "child");
  await mkdir(child);
  await assert.rejects(workspaces.repository(child), /Use repository root/);
});

test("the repository root is a real path even when Git prints another spelling", async () => {
  // Git for Windows prints `C:/...`. Here a stub prints a path with `..` instead.
  const bin = join(directory, "bin");
  await mkdir(bin);
  await mkdir(join(directory, "child"));

  await writeFile(
    join(bin, "git"),
    `#!${process.execPath}\nconsole.log(${JSON.stringify(join(directory, "child", ".."))} + "/");\n`,
    { mode: 0o700 },
  );

  vi.stubEnv("PATH", bin);

  assert.equal(await gitRepositoryRoot(directory), directory);
});

test("only Git's own answer classifies a folder as having no work tree", async (t) => {
  assert.equal(await gitWorkTreeRoot(directory), undefined);
  assert.equal(await gitState(directory), "none");

  execFileSync("git", ["init", "-q", directory]);
  assert.equal(await gitWorkTreeRoot(directory), directory);
  assert.equal(await gitState(directory), "no_commits");

  await assert.rejects(gitWorkTreeRoot(join(directory, "missing")));

  // A `.git` file with a missing target marks a broken repository.
  const broken = join(directory, "broken");
  await mkdir(broken);
  await writeFile(join(broken, ".git"), "gitdir: /missing/worktrees/task\n");
  await assert.rejects(gitWorkTreeRoot(broken), /not a git repository/);

  t.onTestFinished(async () => {
    const child = deadline.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;

    child.kill("SIGKILL");
    await once(child, "close");
  });

  await stalledGit();
  deadline.expireWhenReady = true;

  await assert.rejects(
    gitWorkTreeRoot(directory),
    /Git repository validation did not finish within 5 seconds/,
  );
});

test.skipIf(process.getuid?.() === 0 || process.platform === "win32")(
  "a permission failure never classifies a folder as plain",
  async () => {
    await chmod(directory, 0o000);

    try {
      await assert.rejects(
        gitState(directory),
        /(Permission denied|cannot change)/,
      );
    } finally {
      await chmod(directory, 0o755);
    }
  },
);
