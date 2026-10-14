import { expect, test } from "vitest";

import { renamedProject, withoutProject } from "./project-list";
import type { Project } from "./types";

const projects: Project[] = [
  { repository: "/repos/a", name: "A", kind: "repository" },
  { repository: "/repos/b", kind: "repository" },
];

test("removing a project keeps the others in order", () => {
  expect(withoutProject(projects, "/repos/a")).toEqual([projects[1]]);
  expect(withoutProject(projects, "/repos/missing")).toEqual(projects);
});

test("renaming a project changes only its name", () => {
  expect(renamedProject(projects, "/repos/b", "B")).toEqual([
    projects[0],
    { repository: "/repos/b", name: "B", kind: "repository" },
  ]);

  expect(renamedProject(projects, "/repos/a", "A")[0]).not.toBe(projects[0]);
  expect(renamedProject(projects, "/repos/a", "A")[1]).toBe(projects[1]);
});
