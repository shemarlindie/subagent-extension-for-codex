import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  realpath,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
import {
  executorEnvironment,
  macExecutorProfile,
  managedProcess,
} from "../src/providers/mac-executor.js";
const exec = promisify(execFile);

test("executor environment contains only the restricted key and runtime settings", () => {
  const env = executorEnvironment("/worker/runtime", "executor-placeholder");
  assert.equal(env.CODEX_API_KEY, "executor-placeholder");
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.SSH_AUTH_SOCK, undefined);
  assert.equal(env.TMPDIR, "/worker/runtime/tmp");
  assert.throws(() => executorEnvironment("/worker", ""));
  assert.throws(() =>
    macExecutorProfile({
      workspace: "/worker",
      runtime: "/runtime",
      executable: "/bin/sh",
      gitDirectory: "/repo/.git",
      readOnly: false,
      proxyPort: 0,
    }),
  );
});

test(
  "macOS executor sandbox enforces workspace, read-only and Git metadata boundaries",
  { skip: process.platform !== "darwin" },
  async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "ac-executor-")));
    const workspace = join(dir, "worktree"),
      runtime = join(dir, "runtime"),
      metadata = join(dir, "git"),
      outside = join(dir, "other-worker");
    await Promise.all(
      [workspace, runtime, metadata, outside].map((path) => mkdir(path)),
    );
    await writeFile(join(workspace, "README.md"), "task data");
    await writeFile(join(workspace, ".git"), "gitdir: protected metadata");
    await writeFile(join(outside, "secret"), "other task data");
    await writeFile(join(metadata, "config"), "metadata");
    await symlink(outside, join(workspace, "escape"));
    const profile = (readOnly: boolean) =>
      macExecutorProfile({
        workspace,
        runtime,
        executable: "/bin/cat",
        gitDirectory: metadata,
        readOnly,
      });
    const run = (readOnly: boolean, binary: string, args: string[]) =>
      exec(
        "/usr/bin/sandbox-exec",
        ["-p", profile(readOnly), binary, ...args],
        {
          cwd: workspace,
          env: executorEnvironment(runtime, "test-placeholder"),
        },
      );
    assert.equal(
      (await run(true, "/bin/cat", [join(workspace, "README.md")])).stdout,
      "task data",
    );
    await assert.rejects(run(true, "/bin/cat", [join(outside, "secret")]));
    await assert.rejects(
      run(true, "/usr/bin/touch", [join(workspace, "forbidden")]),
    );
    await run(false, "/usr/bin/touch", [join(workspace, "allowed")]);
    await assert.rejects(
      run(false, "/usr/bin/touch", [join(outside, "forbidden")]),
    );
    await assert.rejects(
      run(false, "/usr/bin/touch", [join(workspace, "escape", "forbidden")]),
    );
    await assert.rejects(
      run(false, "/usr/bin/touch", [join(workspace, ".git")]),
    );
    await assert.rejects(
      run(false, "/usr/bin/touch", [join(metadata, "config")]),
    );
    assert.equal(await readFile(join(metadata, "config"), "utf8"), "metadata");
    await run(true, "/usr/bin/touch", [join(runtime, "scratch")]);
  },
);

test(
  "executor sandbox denies direct network access",
  { skip: process.platform !== "darwin" },
  async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "ac-network-")));
    const executable = await realpath(process.execPath);
    const profile = macExecutorProfile({
      workspace: dir,
      runtime: dir,
      gitDirectory: join(dir, "git"),
      executable,
      readOnly: true,
    });
    const server = createServer((socket) => socket.end());
    server.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    try {
      const port = (server.address() as { port: number }).port;
      const code = `require('node:net').connect(${port}, '127.0.0.1').on('error', error => { console.log(error.code); process.exit(0); }).on('connect', () => { console.log('CONNECTED'); process.exit(0); });`;
      const output = await exec(
        "/usr/bin/sandbox-exec",
        ["-p", profile, executable, "-e", code],
        { timeout: 5000, env: executorEnvironment(dir, "test-placeholder") },
      );
      assert.ok(
        ["EPERM", "EACCES"].includes(output.stdout.trim()),
        output.stdout,
      );
      const proxyProfile = macExecutorProfile({
        workspace: dir,
        runtime: dir,
        gitDirectory: join(dir, "git"),
        executable,
        readOnly: true,
        proxyPort: port,
      });
      const allowed = await exec(
        "/usr/bin/sandbox-exec",
        ["-p", proxyProfile, executable, "-e", code],
        { timeout: 5000, env: executorEnvironment(dir, "test-placeholder") },
      );
      assert.equal(allowed.stdout.trim(), "CONNECTED");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

test(
  "installed native Codex CLI starts under the executor profile",
  { skip: process.platform !== "darwin" },
  async (t) => {
    let executable: string;
    try {
      const configuredExecutable =
        process.env.CODEX_SUBAGENT_EXTENSION_CODEX_EXECUTABLE ??
        (await exec("which", ["codex"])).stdout.trim();
      executable = await realpath(configuredExecutable);
    } catch {
      t.skip(
        "Set CODEX_SUBAGENT_EXTENSION_CODEX_EXECUTABLE or put codex on PATH",
      );
      return;
    }
    const dir = await realpath(await mkdtemp(join(tmpdir(), "ac-native-")));
    const profile = macExecutorProfile({
      workspace: dir,
      runtime: dir,
      gitDirectory: join(dir, "git"),
      executable,
      readOnly: true,
      addresses: [],
    });
    const output = await exec(
      "/usr/bin/sandbox-exec",
      ["-p", profile, executable, "exec-server", "--help"],
      { timeout: 5000, env: executorEnvironment(dir, "test-placeholder") },
    );
    assert.ok(output.stdout.includes("--environment-id"));
    assert.ok(output.stdout.includes("--exit-on-stdin-close"));
  },
);

test("managed executor shutdown is idempotent and terminates its process group", async () => {
  const child = spawn("/bin/sleep", ["20"], {
    detached: true,
    stdio: ["pipe", "ignore", "ignore"],
  });
  const process = managedProcess(child);
  await Promise.all([process.stop(), process.stop()]);
  const result = await process.exited;
  assert.ok(result.signal === "SIGTERM" || result.signal === "SIGKILL");
  await process.stop();
});
