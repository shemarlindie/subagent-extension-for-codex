import { expect, test } from "vitest";

import {
  gitInitCommand,
  projectApproved,
  projectDisplayName,
} from "./selectors";

test("the Git setup command names its folder and survives shell quoting", () => {
  expect(gitInitCommand("/work/Bob's notes")).toBe(
    `git init '/work/Bob'\\''s notes'`,
  );
});

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
