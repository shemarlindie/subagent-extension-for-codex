import type { TestContext } from "vitest";

import { Changes } from "./changes.js";
import { createChangesFixture } from "./store-test-harness.js";

export { edit } from "./store-test-harness.js";

export const changesFixture = (context: TestContext) =>
  createChangesFixture(context, (store) => new Changes(store));
