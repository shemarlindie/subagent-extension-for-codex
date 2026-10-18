import { spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

import {
  handoff,
  launcherEnv,
  type RunningService,
  serviceIdentity,
} from "./identity.js";
import { isProcessRunning } from "./process-info.js";
import { dataDirectory, defaultPort, packagePath } from "./runtime.js";

/** A service that is starting or stopping, which the launcher waits for. */
class ServiceTransitionError extends Error {}

/** How long to wait for a replaced service that can't serve this launcher to exit. */
const replacementTimeout = 11 * 60 * 1000;

/** How many services one connection attempt may start, when earlier ones exit. */
const maxLaunches = 3;

function refused(error: unknown) {
  return (
    (error as { cause?: { code?: string } }).cause?.code === "ECONNREFUSED"
  );
}

export async function connectService() {
  const data = dataDirectory();
  const explicit = process.env.CODEX_SUBAGENT_EXTENSION_URL;
  let origin =
    explicit ??
    process.env.CODEX_SUBAGENT_EXTENSION_ORIGIN ??
    `http://127.0.0.1:${process.env.PORT ?? defaultPort}`;

  if (
    !explicit &&
    !process.env.PORT &&
    !process.env.CODEX_SUBAGENT_EXTENSION_ORIGIN
  ) {
    try {
      origin = JSON.parse(
        readFileSync(join(data, "service.json"), "utf8"),
      ).origin;
    } catch {}
  }

  const url = new URL(origin);

  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Local stdio proxy requires a plain loopback HTTP service origin",
    );
  }

  origin = url.origin;

  const token = () =>
    process.env.CODEX_SUBAGENT_EXTENSION_TOKEN ??
    readFileSync(join(data, "admin-token"), "utf8").trim();

  const probe = async () => {
    const response = await fetch(`${origin}/health`, {
      signal: AbortSignal.timeout(1000),
      redirect: "error",
    });

    const health = await response.json();

    if (
      health.service === "codex-subagent-extension" &&
      ["starting", "stopping"].includes(health.status) &&
      response.status === 503
    ) {
      throw new ServiceTransitionError(`The service is ${health.status}`);
    }

    if (!response.ok || health.service !== "codex-subagent-extension") {
      throw new Error(
        "Port is occupied by an incompatible service; stop or upgrade it explicitly",
      );
    }

    const auth = await fetch(`${origin}/api/tools/list_agent_projects`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token()}`,
        "Content-Type": "application/json",
        "X-Codex-Subagent-Extension": "1",
      },
      body: "{}",
      signal: AbortSignal.timeout(1000),
      redirect: "error",
    });

    if (!auth.ok) {
      throw new Error(
        "Service token or protocol mismatch; inspect data/URL overrides",
      );
    }

    return { origin, token: token(), health };
  };

  /** The running service as its health and, when it describes this origin, service.json report it. */
  const running = (health: RunningService): RunningService => {
    let root: string | undefined;

    try {
      const metadata = JSON.parse(
        readFileSync(join(data, "service.json"), "utf8"),
      );

      if (new URL(metadata.origin).origin === origin) {
        root = metadata.installRoot;
      }
    } catch {}

    return {
      version: health.version,
      apiVersion: health.apiVersion,
      // An explicit URL names a service to use, never one to replace.
      launcher: explicit ? "foreground" : health.launcher,
      installed: !root || existsSync(root),
    };
  };

  const waitForExit = async () => {
    const deadline = Date.now() + replacementTimeout;

    while (Date.now() < deadline) {
      try {
        await fetch(`${origin}/health`, {
          signal: AbortSignal.timeout(1000),
          redirect: "error",
        });
      } catch (error) {
        if (refused(error)) return;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw new Error(
      `The previous extension service at ${origin} did not exit after finishing its turns. Inspect ${join(data, "service.log")}.`,
    );
  };

  let needsLaunch = false;

  try {
    const found = await probe();
    const decision = handoff(running(found.health), serviceIdentity(), origin);

    if (decision.action === "refuse") throw new Error(decision.message);

    if (decision.action === "use") {
      return { origin: found.origin, token: found.token };
    }

    // An older or uninstalled plugin service hands over once its turns end.
    const drain = await fetch(`${origin}/api/service/drain`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${found.token}`,
        "Content-Type": "application/json",
        "X-Codex-Subagent-Extension": "1",
      },
      body: "{}",
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    });

    if (!drain.ok) {
      throw new Error(
        `The previous extension service at ${origin} refused to hand over (${drain.status}); stop it and try again.`,
      );
    }

    // A compatible service keeps serving until it exits. The proxy then reconnects and starts this version.
    if (decision.forward) return { origin: found.origin, token: found.token };
    await waitForExit();
    needsLaunch = true;
  } catch (error) {
    // Only a refused connection authorizes starting a process. Never replace
    // a live service. The loop below waits for one starting or stopping.
    if (!(error instanceof ServiceTransitionError)) {
      if (explicit || !refused(error)) {
        throw error;
      }

      needsLaunch = true;
    }
  }

  /** Whether no live process holds the service lease on the data directory. */
  const leaseReleased = () => {
    try {
      return !isProcessRunning(
        Number(readFileSync(join(data, "service.pid"), "utf8")),
      );
    } catch {
      return true;
    }
  };

  let spawnError: Error | undefined;
  let launches = 0;
  /** Whether the last service this launcher started has exited. */
  const lastLaunch = { exited: false };

  const launch = () => {
    launches++;
    lastLaunch.exited = false;
    mkdirSync(data, { recursive: true, mode: 0o700 });
    const log = openSync(join(data, "service.log"), "a", 0o600);

    const child = spawn(
      process.execPath,
      ["--enable-source-maps", packagePath("dist/main.js")],
      {
        // Windows cannot delete a running process's working directory, so the
        // service runs in its data directory and updates can remove the package.
        cwd: data,
        detached: true,
        stdio: ["ignore", log, log],
        env: {
          ...process.env,
          CODEX_SUBAGENT_EXTENSION_DATA: data,
          ...(process.env.CODEX_SUBAGENT_EXTENSION_ALLOWED_ROOTS
            ? {
                CODEX_SUBAGENT_EXTENSION_ALLOWED_ROOTS: JSON.stringify(
                  JSON.parse(
                    process.env.CODEX_SUBAGENT_EXTENSION_ALLOWED_ROOTS,
                  ).map((root: string) => resolve(root)),
                ),
              }
            : {}),
          PORT: url.port || "80",
          CODEX_SUBAGENT_EXTENSION_ORIGIN: origin,
          [launcherEnv]: "stdio",
        },
      },
    );

    child.on("error", (e) => {
      spawnError = e;
    });

    child.on("exit", () => {
      lastLaunch.exited = true;
    });

    child.unref();
    closeSync(log);
  };

  if (needsLaunch) launch();

  // Concurrent launchers may spawn losers: the service lease alone owns recovery and workers.
  const deadline = Date.now() + 15000;
  let last: unknown;

  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    await new Promise((resolve) => setTimeout(resolve, 100));

    try {
      const { health: _, ...connection } = await probe();

      return connection;
    } catch (e) {
      last = e;

      // Nothing listens and no service this launcher started is coming up:
      // a stopping service held the lease (a handover or shutdown), so the
      // last launch exited. Start again once that service has let go.
      if (
        !explicit &&
        refused(e) &&
        (launches === 0 || lastLaunch.exited) &&
        launches < maxLaunches &&
        leaseReleased()
      ) {
        launch();
      }
    }
  }

  throw new Error(
    `Service startup failed. Inspect ${join(data, "service.log")}: ${String(last)}`,
  );
}
