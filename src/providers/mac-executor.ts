import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, realpath } from "node:fs/promises";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { executorProxy } from "./executor-proxy.js";
import { type Task, UnconfirmedTerminationError } from "../core/model.js";
import { type CodexSessionRef } from "./codex-session.js";
import { git } from "../core/workspace.js";
import { ExecutorJournal } from "./executor-journal.js";
import {
  identifyLaunch,
  stopRecordedGroup,
  waitForGroupExit,
} from "./process-groups.js";

const quote = (value: string) => JSON.stringify(value);

export function macExecutorProfile(options: {
  workspace: string;
  runtime: string;
  executable: string;
  gitDirectory: string;
  readOnly: boolean;
  proxyPort?: number;
}) {
  if (
    options.proxyPort !== undefined &&
    (!Number.isInteger(options.proxyPort) ||
      options.proxyPort < 1 ||
      options.proxyPort > 65535)
  )
    throw new Error("Invalid executor proxy port");

  const reads = [
    "/usr",
    "/bin",
    "/sbin",
    "/System",
    "/Library",
    "/private/etc",
    "/dev",
    dirname(options.executable),
    options.workspace,
    options.runtime,
    options.gitDirectory,
  ];

  return `(version 1)
(deny default)
(allow process-exec)
(allow process-fork)
(allow signal (target same-sandbox))
(allow sysctl-read)
(allow file-read-metadata)
(allow file-read* (literal "/") ${reads.map((path) => `(subpath ${quote(path)})`).join(" ")} (literal ${quote(options.executable)}))
(allow file-write* (subpath ${quote(options.runtime)}) (literal "/dev/null"))
${options.readOnly ? "" : `(allow file-write* (subpath ${quote(options.workspace)}))`}
(deny file-write* (literal ${quote(join(options.workspace, ".git"))}) (subpath ${quote(join(options.workspace, ".git"))}) (subpath ${quote(options.gitDirectory)}))
${options.proxyPort ? `(allow network-outbound (remote tcp ${quote(`localhost:${options.proxyPort}`)}))` : ""}
`;
}

export function executorEnvironment(
  runtime: string,
  key: string,
  proxy?: string,
  executableDirectory?: string,
): NodeJS.ProcessEnv {
  if (!key) throw new Error("A restricted executor key is required");

  return {
    PATH: [executableDirectory, "/usr/bin", "/bin", "/usr/sbin", "/sbin"]
      .filter(Boolean)
      .join(":"),
    LANG: "en_US.UTF-8",
    TMPDIR: join(runtime, "tmp"),
    CODEX_API_KEY: key,
    ...(proxy
      ? {
          HTTP_PROXY: proxy,
          HTTPS_PROXY: proxy,
          ALL_PROXY: proxy,
          NO_PROXY: "",
        }
      : {}),
  };
}

export interface ExecutorHandle {
  stop(): Promise<void>;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

/** macOS OS sandbox applies to the native executor and all descendants. */
export class MacExecutor {
  constructor(
    private executable: string,
    private runtimeRoot: string,
    private key: string,
    private journal: ExecutorJournal,
  ) {
    if (!key) throw new Error("A restricted executor key is required");
  }

  async recover(task: Task) {
    const record = this.journal.read(task);
    if (!record || record.phase === "stopped") return;
    if (process.platform !== "darwin")
      throw new Error("Native executor recovery requires macOS");

    if (record.phase === "starting" && !record.pid) {
      const identified = await identifyLaunch(record.launch_id);
      const { pid, ...identity } = identified;
      this.journal.running(task, record.launch_id, pid, identity);
    }

    await stopRecordedGroup(this.journal.read(task)!);
    this.journal.stopped(task, record.launch_id);
  }

  async start(task: Task, ref: CodexSessionRef): Promise<ExecutorHandle> {
    if (process.platform !== "darwin")
      throw new Error("This executor requires macOS sandbox-exec");
    if (!task.workspace) throw new Error("Task workspace unavailable");
    if (!/^task_[A-Za-z0-9_-]+$/.test(task.id))
      throw new Error("Invalid executor task identity");
    const remote = new URL(ref.remote_url);
    if (
      remote.protocol !== "https:" ||
      remote.hostname !== "api.openai.com" ||
      remote.port ||
      remote.username ||
      remote.password
    )
      throw new Error("Unexpected executor registration origin");
    const workspace = await realpath(task.workspace);
    const executable = await realpath(this.executable);
    await mkdir(this.runtimeRoot, { recursive: true, mode: 0o700 });
    const runtimeBase = await realpath(this.runtimeRoot);

    const gitDirectory = await realpath(
      resolve(
        workspace,
        (await git(workspace, ["rev-parse", "--git-common-dir"])).trim(),
      ),
    );

    for (const protectedRoot of [workspace, gitDirectory]) {
      const delta = relative(protectedRoot, join(runtimeBase, task.id));
      if (
        !delta ||
        (!delta.startsWith(".." + "/") && delta !== ".." && !isAbsolute(delta))
      )
        throw new Error(
          "Executor runtime must be outside the worktree and Git metadata",
        );
    }

    const reservation = this.journal.reserve(task, ref);
    let cleanup: ExecutorHandle | undefined;
    let cleanupProxy: Awaited<ReturnType<typeof executorProxy>> | undefined;
    let launchedPID: number | undefined;

    try {
      const runtime = join(runtimeBase, task.id, reservation.launch_id);
      await mkdir(join(runtime, "tmp"), { recursive: true, mode: 0o700 });
      await mkdir(join(runtime, "logs"), { recursive: true, mode: 0o700 });
      const proxy = await executorProxy();
      cleanupProxy = proxy;

      const profile = macExecutorProfile({
        workspace,
        runtime,
        executable,
        gitDirectory,
        readOnly: ["researcher", "reviewer", "security_reviewer"].includes(
          task.worker_profile,
        ),
        proxyPort: proxy.port,
      });

      const child = spawn(
        "/usr/bin/sandbox-exec",
        [
          "-p",
          profile,
          executable,
          "exec-server",
          "-c",
          `log_dir=${quote(join(runtime, "logs"))}`,
          "--remote",
          ref.remote_url,
          "--environment-id",
          ref.environment_id,
          "--exit-on-stdin-close",
        ],
        {
          cwd: workspace,
          env: executorEnvironment(
            runtime,
            this.key,
            proxy.url,
            dirname(executable),
          ),
          detached: true,
          stdio: ["pipe", "ignore", "ignore"],
        },
      );

      const handle = managedProcess(child);
      cleanup = handle;
      launchedPID = child.pid;

      if (child.pid) {
        const identified = await identifyLaunch(
          reservation.launch_id,
          undefined,
          child.pid,
        );

        const { pid: _pid, ...identity } = identified;
        this.journal.running(task, reservation.launch_id, child.pid, identity);
      }

      void handle.exited
        .finally(() => {
          try {
            this.journal.uncertain(task, reservation.launch_id);
          } finally {
            void proxy.stop();
          }
        })
        .catch(() => {});

      return {
        exited: handle.exited,
        stop: async () => {
          try {
            await handle.stop();

            if (child.pid && !(await waitForGroupExit(child.pid))) {
              throw new Error(
                "Executor process group remains alive after shutdown",
              );
            }

            this.journal.stopped(task, reservation.launch_id);
          } finally {
            await proxy.stop();
          }
        },
      };
    } catch (error) {
      try {
        if (cleanup) await cleanup.stop();
        if (launchedPID && !(await waitForGroupExit(launchedPID)))
          throw new Error("Executor process group remains alive", {
            cause: error,
          });
        this.journal.stopped(task, reservation.launch_id);
      } catch (termination) {
        throw new UnconfirmedTerminationError(
          [error, termination],
          "Executor startup cleanup is unconfirmed",
        );
      } finally {
        await cleanupProxy?.stop();
      }

      throw error;
    }
  }
}

export function managedProcess(child: ChildProcess): ExecutorHandle {
  let finished = false;

  const exited = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve, reject) => {
    child.once("error", (error) => {
      finished = true;
      reject(error);
    });

    child.once("close", (code, signal) => {
      finished = true;
      resolve({ code, signal });
    });
  });

  // Start errors must remain observable even if the caller is still awaiting API events.
  void exited.catch(() => {});
  let stopping: Promise<void> | undefined;

  return {
    exited,
    stop() {
      return (stopping ??= (async () => {
        if (finished) {
          await exited;

          return;
        }

        child.stdin?.end();

        const signal = (value: NodeJS.Signals) => {
          if (finished || !child.pid) return;

          try {
            process.kill(-child.pid, value);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
          }
        };

        signal("SIGTERM");
        const timer = setTimeout(() => signal("SIGKILL"), 2000);

        try {
          await exited;
        } finally {
          clearTimeout(timer);
        }
      })());
    },
  };
}
