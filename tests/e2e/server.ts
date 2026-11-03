// The built console and real HTTP/task/storage layers, with no model calls.
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  FixtureProvider,
  type FixtureProviderOptions,
} from "../../dev/service/fixture-provider.js";
import { Projects } from "../../src/service/features/projects/projects.js";
import { Control } from "../../src/service/features/tasks/runtime/control.js";
import { Store } from "../../src/service/features/tasks/storage/store.js";
import { Workspaces } from "../../src/service/features/workspaces/workspace.js";
import { application } from "../../src/service/platform/server/app.js";
import { Auth } from "../../src/service/platform/server/auth.js";
import { waitForListening } from "../support/helpers.js";

export const CONSOLE_TOKEN = "e2e-disposable-console-token-000000";

/** Each test owns its database, settings, worker sessions and loopback port. */
export async function startConsoleService(
  provider: FixtureProviderOptions = {},
) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "panel-e2e-")));

  const control = new Control(
    new Store(join(directory, "service.sqlite")),
    new Workspaces(join(directory, "worktrees"), []),
    new Map([["fixture", new FixtureProvider(provider)]]),
  );

  control.projects = new Projects(control.store.database, control.workspaces);
  const server = createServer();
  let app: ReturnType<typeof application> | undefined;

  async function close() {
    try {
      await app?.locals.closeMcp();
    } finally {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));

      try {
        await control.close();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  }

  try {
    await waitForListening(server.listen(0, "127.0.0.1"));
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("The browser fixture needs a loopback TCP port");
    }

    const origin = `http://127.0.0.1:${address.port}`;

    app = application(
      control,
      new Auth(CONSOLE_TOKEN),
      origin,
      resolve("dist/app.html"),
    );

    server.on("request", app);

    // Ends open requests and the event stream, as a network drop would.
    const dropConnections = () => server.closeAllConnections();

    // Announces a new revision, as a service write would, so the panel refreshes.
    const announceChange = () => control.store.projectsChanged();

    return { origin, directory, close, dropConnections, announceChange };
  } catch (error) {
    await close();
    throw error;
  }
}
