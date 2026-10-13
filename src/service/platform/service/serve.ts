import { chmodSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { Projects } from "../../features/projects/projects.js";
import { configuredProviders } from "../../features/providers/config.js";
import type { Provider } from "../../features/providers/types.js";
import { Control } from "../../features/tasks/runtime/control.js";
import { Store } from "../../features/tasks/storage/store.js";
import { Workspaces } from "../../features/workspaces/workspace.js";
import { application } from "../server/app.js";
import { Auth } from "../server/auth.js";
import { lease } from "./lease.js";
import { networkOrigins } from "./network.js";
import { inspectProcessIdentity } from "./process-info.js";
import { dataDirectory, packagePath } from "./runtime.js";
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

/** Starts the HTTP service and runs it until SIGINT or SIGTERM. */
export async function serve({
  providers: makeProviders = configuredProviders,
  network = false,
}: ServeOptions = {}) {
  const port = Number(process.env.PORT ?? 4317);

  const origin =
    process.env.CODEX_SUBAGENT_EXTENSION_ORIGIN ?? `http://127.0.0.1:${port}`;

  const lanOrigins = network ? networkOrigins(port) : [];

  const data = dataDirectory();
  mkdirSync(data, { recursive: true, mode: 0o700 });
  // mkdirSync's mode applies only on creation; tighten an existing directory too.
  chmodSync(data, 0o700);
  const release = lease(data);
  process.once("exit", release);
  const processIdentity = inspectProcessIdentity(process.pid);
  if (
    !processIdentity &&
    (process.platform === "linux" || process.platform === "darwin")
  )
    console.error(
      "Could not record this service's process identity; a later launcher may require manual cleanup.",
    );

  const serviceFile = join(data, "service.json");
  const temporaryServiceFile = `${serviceFile}.${process.pid}.tmp`;

  writeFileSync(
    temporaryServiceFile,
    JSON.stringify({
      origin,
      pid: process.pid,
      version: "0.1.0",
      ...processIdentity,
    }),
    { mode: 0o600 },
  );

  renameSync(temporaryServiceFile, serviceFile);

  const token = adminToken(data);
  const store = new Store(join(data, "console.sqlite"));
  const providers = makeProviders(store, data);

  const concurrency = Number(
    process.env.CODEX_SUBAGENT_EXTENSION_CONCURRENCY ?? 3,
  );

  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 20)
    throw new Error("Concurrency must be between 1 and 20");

  const c = new Control(
    store,
    new Workspaces(join(data, "worktrees"), []),
    providers,
    concurrency,
  );

  c.projects = new Projects(store.database, c.workspaces);
  for (const root of JSON.parse(
    process.env.CODEX_SUBAGENT_EXTENSION_ALLOWED_ROOTS ?? "[]",
  ))
    await c.projects.register(resolve(root), "parent");

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
    throw error;
  }

  try {
    await c.recover();
    app.locals.ready = true;
  } catch (error) {
    server.close();
    await c.close();
    throw error;
  }

  const tokenSource =
    process.env.CODEX_SUBAGENT_EXTENSION_TOKEN === undefined
      ? `file: ${join(data, "admin-token")}`
      : "from CODEX_SUBAGENT_EXTENSION_TOKEN";

  console.error(
    `Codex subagent extension service: ${origin}\nLogin token ${tokenSource}`,
  );

  if (network)
    console.error(
      `Network listener: 0.0.0.0:${port}\n${lanOrigins.join("\n")}`,
    );

  const prune = setInterval(() => auth.prune(), 60000);
  let closing: Promise<void> | undefined;

  function close() {
    return (closing ??= (async () => {
      app.locals.ready = false;
      clearInterval(prune);
      server.close();
      await app.locals.closeMcp();
      await c.close();
      process.exit(0);
    })());
  }

  process.on("SIGINT", () => void close());
  process.on("SIGTERM", () => void close());
}
