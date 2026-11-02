import { chmodSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { Projects } from "../../features/projects/projects.js";
import { configuredProviders } from "../../features/providers/config.js";
import type { Provider } from "../../features/providers/types.js";
import { Control } from "../../features/tasks/runtime/control.js";
import {
  configureTimingLog,
  flushTimingLog,
} from "../../features/tasks/runtime/timing.js";
import { Store } from "../../features/tasks/storage/store.js";
import { Workspaces } from "../../features/workspaces/workspace.js";
import { useIncrementalVacuum } from "../database/database.js";
import {
  configureLogging,
  flushLogs,
  logEvent,
  setLogSecrets,
} from "../logging/logger.js";
import { startRuntimeMetrics } from "../logging/runtime-metrics.js";
import { application } from "../server/app.js";
import { Auth } from "../server/auth.js";
import { serviceIdentity } from "./identity.js";
import { lease } from "./lease.js";
import { networkOrigins } from "./network.js";
import { PortInUseError } from "./port.js";
import { inspectProcessIdentity } from "./process-info.js";
import {
  databasePath,
  dataDirectory,
  defaultPort,
  packagePath,
} from "./runtime.js";
import { adminToken } from "./token.js";

export type ServeOptions = {
  /** Opt in to an IPv4 listener reachable from other computers. */
  network?: boolean;
  /**
   * The workers to run. Defaults to the configured providers (Claude); the
   * development demo passes its fixture worker.
   */
  providers?: (store: Store, data: string) => Map<string, Provider>;
};

/** How long a draining service waits for running turns before interrupting them. */
const drainLimit = 10 * 60 * 1000;

/** How long a stopping service waits to answer calls it already received. */
const callDrainLimit = 10000;

/** Starts the HTTP service and runs it until SIGINT or SIGTERM. */
export async function serve({
  providers: makeProviders,
  network = false,
}: ServeOptions = {}) {
  const port = Number(process.env.PORT ?? defaultPort);

  const origin =
    process.env.SUBAGENT_EXTENSION_FOR_CODEX_ORIGIN ??
    `http://127.0.0.1:${port}`;

  const lanOrigins = network ? networkOrigins(port) : [];

  const data = dataDirectory();
  mkdirSync(data, { recursive: true, mode: 0o700 });
  // mkdirSync's mode applies only on creation; tighten an existing directory too.
  chmodSync(data, 0o700);
  const release = lease(data);
  process.once("exit", release);

  configureLogging(
    join(data, "service.jsonl"),
    process.env.SUBAGENT_EXTENSION_FOR_CODEX_LOG_LEVEL,
  );

  configureTimingLog(join(data, "timing.jsonl"));

  logEvent("info", "service.starting", {
    node_version: process.version,
    version: serviceIdentity().version,
    api_version: serviceIdentity().apiVersion,
    launcher: serviceIdentity().launcher,
    network,
  });

  const processIdentity = inspectProcessIdentity(process.pid);

  if (
    !processIdentity &&
    (process.platform === "linux" || process.platform === "darwin")
  ) {
    logEvent("warn", "service.process_identity_unavailable");
  }

  const serviceFile = join(data, "service.json");
  const temporaryServiceFile = `${serviceFile}.${process.pid}.tmp`;

  writeFileSync(
    temporaryServiceFile,
    JSON.stringify({
      origin,
      pid: process.pid,
      ...serviceIdentity(),
      ...processIdentity,
    }),
    { mode: 0o600 },
  );

  renameSync(temporaryServiceFile, serviceFile);

  const token = adminToken(data);

  setLogSecrets([
    token,
    process.env.ANTHROPIC_API_KEY,
    process.env.CLAUDE_CODE_OAUTH_TOKEN,
  ]);

  const store = new Store(databasePath(data));
  useIncrementalVacuum(store.database);

  const providers = makeProviders
    ? makeProviders(store, data)
    : configuredProviders(
        process.env.SUBAGENT_EXTENSION_FOR_CODEX_FULL_EVENTS === "1",
      );

  const concurrency = Number(
    process.env.SUBAGENT_EXTENSION_FOR_CODEX_CONCURRENCY ?? 3,
  );

  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 20) {
    throw new Error("Concurrency must be between 1 and 20");
  }

  const c = new Control(
    store,
    new Workspaces(join(data, "worktrees"), []),
    providers,
    concurrency,
  );

  c.projects = new Projects(store.database, c.workspaces, () =>
    store.projectsChanged(),
  );

  for (const root of JSON.parse(
    process.env.SUBAGENT_EXTENSION_FOR_CODEX_ALLOWED_ROOTS ?? "[]",
  )) {
    await c.projects.register(resolve(root), "parent");
  }

  const auth = new Auth(token);

  const app = application(
    c,
    auth,
    origin,
    packagePath("dist/app.html"),
    packagePath("dist/app.html"),
    lanOrigins,
  );

  // Reserve the listener before recovery can change durable tasks or launch workers.
  app.locals.ready = false;
  const server = app.listen(port, network ? "0.0.0.0" : "127.0.0.1");

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
  } catch (error) {
    c.store.close();

    if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
      throw new PortInUseError(port, { cause: error });
    }

    throw error;
  }

  try {
    const recoveryStarted = performance.now();
    await c.recover();

    logEvent("info", "service.recovered", {
      duration_ms: performance.now() - recoveryStarted,
    });

    app.locals.ready = true;
  } catch (error) {
    server.close();
    await c.close();
    throw error;
  }

  const tokenSource =
    process.env.SUBAGENT_EXTENSION_FOR_CODEX_TOKEN === undefined
      ? `file: ${join(data, "admin-token")}`
      : "from SUBAGENT_EXTENSION_FOR_CODEX_TOKEN";

  console.error(
    `Subagent Extension for Codex service: ${origin}\nLogin token ${tokenSource}`,
  );

  if (network) {
    console.error(
      `Network listener: 0.0.0.0:${port}\n${lanOrigins.join("\n")}`,
    );
  }

  logEvent("info", "service.ready", {
    port,
    concurrency,
    provider_count: providers.size,
  });

  const stopMetrics = startRuntimeMetrics(() => c.active.size);

  const prune = setInterval(() => auth.prune(), 60000);
  // Calls are POSTs. GETs include event streams that never end on their own.
  let calls = 0;

  server.on("request", (req, res) => {
    if (req.method === "GET") return;
    calls++;
    res.once("close", () => calls--);
  });

  let closing: Promise<void> | undefined;

  function close(signal = "drain") {
    return (closing ??= (async () => {
      logEvent("info", "service.stopping", { signal });
      stopMetrics();
      clearInterval(prune);
      server.close();
      server.closeIdleConnections();
      // Answer calls already received, so a proxy sees a reset only for
      // calls the service never read.
      const deadline = Date.now() + callDrainLimit;

      while (calls && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      logEvent("info", "service.calls_drained", { open_calls: calls });
      app.locals.stopping = true;
      await app.locals.closeMcp();
      await c.close();
      logEvent("info", "service.stopped");
      await Promise.all([flushTimingLog(), flushLogs()]);
      process.exit(0);
    })());
  }

  let draining: Promise<void> | undefined;

  // A newer stdio launcher asks this service to hand over: finish running
  // turns (for at most drainLimit), then exit so it can start its own.
  app.locals.drain = () => {
    draining ??= (async () => {
      app.locals.draining = true;
      logEvent("info", "service.draining", { active_tasks: c.active.size });
      const started = performance.now();
      await c.drain(drainLimit);

      logEvent("info", "service.drained", {
        duration_ms: performance.now() - started,
        active_tasks: c.active.size,
      });

      await close();
    })();

    return c.active.size;
  };

  process.on("SIGINT", () => void close("SIGINT"));
  process.on("SIGTERM", () => void close("SIGTERM"));
}
