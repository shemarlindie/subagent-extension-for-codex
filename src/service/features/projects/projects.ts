import { realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, relative } from "node:path";

import { type Database } from "../../platform/database/database.js";
import { git } from "../workspaces/git.js";
import { Workspaces } from "../workspaces/workspace.js";
import { projectRoots } from "./schema.js";

/** Only explicit user registration (UI/CLI) or configuration grants roots, never task arguments. */
export class Projects {
  constructor(
    private database: Database,
    private workspaces: Workspaces,
  ) {
    this.refresh();
  }

  refresh() {
    this.workspaces.allowedRoots = this.database.orm
      .select({ path: projectRoots.path })
      .from(projectRoots)
      .all()
      .map((r) => r.path);
  }

  async register(path: string, kind: "repository" | "parent" = "repository") {
    if (!isAbsolute(path))
      throw new Error("Registration requires an absolute path");
    const actual = await realpath(path);
    if (!(await stat(actual)).isDirectory())
      throw new Error("Project root must be a directory");
    if (
      kind === "repository" &&
      (await git(actual, ["rev-parse", "--show-toplevel"])).trim() !== actual
    )
      throw new Error("Use repository root");

    this.database.orm
      .insert(projectRoots)
      .values({ path: actual, kind })
      .onConflictDoUpdate({ target: projectRoots.path, set: { kind } })
      .run();

    this.refresh();

    return { repository: actual, kind };
  }

  list() {
    this.refresh();

    return this.database.orm
      .select()
      .from(projectRoots)
      .orderBy(projectRoots.path)
      .all()
      .map((r) => ({
        repository: r.path,
        name: basename(r.path),
        kind: r.kind,
      }));
  }

  async resolve(path: string) {
    this.refresh();
    if (path === "current")
      throw new Error(
        "Host project context is unavailable. Call list_agent_projects and pass an explicit repository path; add missing projects through the user interface or local projects CLI.",
      );
    if (!isAbsolute(path)) throw new Error("Use an absolute repository path");
    const actual = await realpath(path);

    const approved = this.list().some((root) => {
      if (root.kind === "repository") return root.repository === actual;
      const child = relative(root.repository, actual);

      return child === "" || (!child.startsWith("..") && !isAbsolute(child));
    });

    if (!approved)
      throw new Error(
        "Repository outside allowed roots (register this repository or approve its parent)",
      );

    // Keep the existing canonical-path containment and Git-root validation too.
    return this.workspaces.repository(actual);
  }
}
