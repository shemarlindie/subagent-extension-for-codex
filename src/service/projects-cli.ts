import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { Projects } from "./features/projects/projects.js";
import { Store } from "./features/tasks/storage/store.js";
import { Workspaces } from "./features/workspaces/workspace.js";
import { dataDirectory } from "./platform/service/runtime.js";

const data = dataDirectory();
mkdirSync(data, { recursive: true, mode: 0o700 });
const store = new Store(join(data, "console.sqlite"));

try {
  const projects = new Projects(
    store.database,
    new Workspaces(join(data, "worktrees"), []),
  );

  const [command, path] = process.argv.slice(2);
  if (command === "list") console.log(JSON.stringify(projects.list(), null, 2));
  else if (["register", "approve-parent"].includes(command) && path)
    console.log(
      JSON.stringify(
        await projects.register(
          resolve(path),
          command === "approve-parent" ? "parent" : "repository",
        ),
      ),
    );
  else
    throw new Error(
      "Usage: projects-cli.js list | register <repository> | approve-parent <directory>",
    );
} finally {
  store.close();
}
