import { expect, test } from "vitest";

import { Controller } from "../../app/state/controller";
import type { Transport } from "../../app/state/types";
import { delegationDialog } from "../delegation/delegation";
import { projectApproved } from "./selectors";

test("remaining parent grants cover children but never siblings", () => {
  const projects = [{ repository: "/repos", kind: "parent" }];
  expect(projectApproved(projects, "/repos/a")).toBe(true);
  expect(projectApproved(projects, "/repos-other/a")).toBe(false);

  expect(
    projectApproved([{ repository: "/repos", kind: "repository" }], "/repos/a"),
  ).toBe(false);
});

test("New task does not reuse a revoked scoped repository", () => {
  const controller = new Controller({
    embedded: true,
    dispose() {},
  } as Transport);

  try {
    const state = {
      ...controller.getSnapshot(),
      repository: "/removed",
      workers: [
        { provider: "claude", profiles: ["reviewer"], capabilities: {} },
      ],
    };

    const dialog = delegationDialog(
      state,
      [{ repository: "/remaining", kind: "repository" }],
      {
        default_provider: "claude",
        default_worker_profile: "reviewer",
        max_runtime_minutes: 20,
        max_cost_usd: null,
      },
      false,
    );

    expect(dialog.repository).toBe("/remaining");
    expect(dialog.revision).toBe("HEAD");
  } finally {
    controller.dispose();
  }
});
