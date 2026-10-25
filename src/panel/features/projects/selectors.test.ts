import { expect, test } from "vitest";

import { projectApproved, projectDisplayName } from "./selectors";

test("project names fall back to path basenames across path styles", () => {
  expect(projectDisplayName({ repository: "/workspaces/example/" })).toBe(
    "example",
  );

  expect(projectDisplayName({ repository: "C:\\workspaces\\example\\" })).toBe(
    "example",
  );
});

test("remaining parent grants cover children but never siblings", () => {
  const projects = [{ repository: "/repos", kind: "parent" }];
  expect(projectApproved(projects, "/repos/a")).toBe(true);
  expect(projectApproved(projects, "/repos-other/a")).toBe(false);

  expect(
    projectApproved([{ repository: "/repos", kind: "repository" }], "/repos/a"),
  ).toBe(false);
});
