import { basename, isAbsolute, relative } from "node:path";
import { realpath, stat } from "node:fs/promises";
import { type Store } from "./store.js";
import { Workspaces, git } from "./workspace.js";

/** Only the local registration CLI/configuration grants roots, never tool arguments. */
export class Projects {
  constructor(
    private store: Store,
    private workspaces: Workspaces,
  ) {
    store.db.exec(
      "CREATE TABLE IF NOT EXISTS project_roots(path TEXT PRIMARY KEY, kind TEXT NOT NULL)",
    );
    this.refresh();
  }
  refresh() {
    this.workspaces.allowedRoots = this.store.db
      .prepare("SELECT path FROM project_roots")
      .all()
      .map((r) => String(r.path));
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
    this.store.db
      .prepare(
        "INSERT INTO project_roots VALUES(?,?) ON CONFLICT(path) DO UPDATE SET kind=excluded.kind",
      )
      .run(actual, kind);
    this.refresh();
    return { repository: actual, kind };
  }
  list() {
    this.refresh();
    return this.store.db
      .prepare("SELECT path,kind FROM project_roots ORDER BY path")
      .all()
      .map((r) => ({
        repository: String(r.path),
        name: basename(String(r.path)),
        kind: String(r.kind),
      }));
  }
  async resolve(path: string) {
    this.refresh();
    if (path === "current")
      throw new Error(
        "Host project context is unavailable. Call list_agent_projects and pass an explicit repository path; register missing projects with the local projects CLI.",
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
