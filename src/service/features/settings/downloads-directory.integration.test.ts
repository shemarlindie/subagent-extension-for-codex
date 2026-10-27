import { isAbsolute } from "node:path";

import { expect, test } from "vitest";

import { downloadsDirectory } from "./downloads-directory.js";

// Exercises native scripts on macOS and Windows CI, beyond mocked path tests.
test("the service resolves this computer's Downloads location", async () => {
  const directory = await downloadsDirectory();
  expect(isAbsolute(directory)).toBe(true);
});
