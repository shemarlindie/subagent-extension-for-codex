import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { expect, type Page, test as base } from "@playwright/test";

import { CONSOLE_TOKEN, startConsoleService } from "./server";

type ConsoleFixtures = {
  /** The in-process service, which a test can disconnect. */
  inProcessService: Awaited<ReturnType<typeof startConsoleService>>;
  /** The service the console uses, in process unless a suite overrides it. */
  consoleService: { origin: string; directory: string };
  repository: string;
  consolePage: Page;
};

export const test = base.extend<ConsoleFixtures>({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires destructured fixture dependencies.
  inProcessService: async ({}, use) => {
    const service = await startConsoleService();

    try {
      await use(service);
    } finally {
      await service.close();
    }
  },
  consoleService: async ({ inProcessService }, use) => {
    await use(inProcessService);
  },
  baseURL: async ({ consoleService }, use) => {
    await use(consoleService.origin);
  },
  repository: async ({ consoleService }, use) => {
    const repository = join(consoleService.directory, "repository");
    await mkdir(repository);
    execFileSync("git", ["init", "-q", repository]);

    execFileSync("git", [
      "-C",
      repository,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "--allow-empty",
      "-qm",
      "initial",
    ]);

    await use(repository);
  },
  consolePage: async ({ page, repository, consoleService }, use) => {
    // Login and registration have their own browser test. Other flows prepare
    // them through the same public endpoints, without bypassing service policy.
    const login = await page.request.post("/api/login", {
      data: { token: CONSOLE_TOKEN },
      headers: { Origin: consoleService.origin },
    });

    await expect(login).toBeOK();

    const registration = await page.request.post(
      "/api/tools/app_register_project",
      {
        data: { repository },
        headers: {
          Origin: consoleService.origin,
          "X-Codex-Subagent-Extension": "1",
        },
      },
    );

    await expect(registration).toBeOK();
    await page.goto("/");

    await page
      .getByRole("combobox", { name: "Project scope", exact: true })
      .click();

    await page.getByRole("option").filter({ hasText: repository }).click();
    await use(page);
  },
});

export { expect } from "@playwright/test";
