import { readFile } from "node:fs/promises";

import { expect, test } from "vitest";

// Users install whatever main's marketplace lists, so it must name this package
// at an exact version, which may be a prerelease.
test("main's marketplace installs this package from npm at an exact version", async () => {
  const read = async (path: string) => JSON.parse(await readFile(path, "utf8"));
  const { name } = await read("package.json");
  const marketplace = await read(".agents/plugins/marketplace.json");

  expect(marketplace.plugins).toEqual([
    expect.objectContaining({
      name,
      source: {
        source: "npm",
        package: name,
        version: expect.stringMatching(/^\d+\.\d+\.\d+(-[\w.-]+)?$/),
      },
    }),
  ]);
});
