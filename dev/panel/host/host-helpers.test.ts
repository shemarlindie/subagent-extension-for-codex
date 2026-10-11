import { expect, test } from "vitest";

import { hasProjectEdits, removeFixtureProject } from "./host-helpers";

test("fixture reset is available for edits to built-in projects", () => {
  expect(hasProjectEdits({ addedProjects: [] })).toBe(false);

  expect(
    hasProjectEdits({ addedProjects: [], removedProjects: ["/repo"] }),
  ).toBe(true);

  expect(
    hasProjectEdits({
      addedProjects: [],
      projectNames: { "/repo": "Renamed" },
    }),
  ).toBe(true);
});

test("fixture removal drops the old name so re-registration uses its default", () => {
  const edits = {
    removed: ["/repo"],
    names: { "/repo": "Old name", "/other": "Other" },
  };

  expect(removeFixtureProject(edits, "/repo")).toEqual({
    removed: ["/repo"],
    names: { "/other": "Other" },
  });

  expect(edits.names["/repo"]).toBe("Old name");
});
