import { expect, test as base } from "./fixtures";
import { startProcessService } from "./process-service";
import { CONSOLE_TOKEN } from "./server";

type RecoveryFixtures = {
  processService: Awaited<ReturnType<typeof startProcessService>>;
};

const test = base.extend<RecoveryFixtures>({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires destructured fixture dependencies.
  processService: async ({}, use) => {
    const service = await startProcessService();

    try {
      await use(service);
    } finally {
      await service.close();
    }
  },
  consoleService: async ({ processService }, use) => {
    await use(processService);
  },
});

test("recover running and queued tasks and preserve follow-up order after a service crash", async ({
  consolePage: page,
  processService,
}) => {
  await page.getByRole("button", { name: "New task", exact: true }).click();

  await page
    .getByRole("textbox", { name: "Task message" })
    .fill("Recover this active task [fixture:wait ms=60000]");

  await page.getByRole("button", { name: "Start task", exact: true }).click();
  const history = page.getByRole("region", { name: "Chat history" });
  await expect(history).toContainText("Fixture worker running turn 1");
  const composer = page.getByRole("textbox", { name: "Message", exact: true });
  // A fresh fixture session sees the earlier conversation. Override its hold
  // marker so replaying that context does not delay the recovered turn.
  const first = "First recovered follow-up [fixture:wait ms=0]";
  await composer.fill(first);
  await composer.press("Enter");

  await expect(page.getByText(first, { exact: true })).toBeVisible();

  await expect(composer).toHaveValue("");
  await composer.fill("Second recovered follow-up");
  await composer.press("Enter");
  await expect(page.getByText("Queued · 2", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "New task", exact: true }).click();

  await page
    .getByRole("textbox", { name: "Task message" })
    .fill("Recover the queued task");

  await page.getByRole("button", { name: "Start task", exact: true }).click();
  const tasks = page.getByRole("complementary", { name: "Delegated tasks" });

  await expect(
    tasks.getByRole("button", { name: /Recover the queued task/ }),
  ).toContainText("Queued");

  await processService.restart();
  await page.reload();
  await page.getByLabel("Console token").fill(CONSOLE_TOKEN);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(history).toContainText("Fixture session turn: 1.");
  await page.getByRole("radio", { name: /^All,/ }).click();
  await tasks.getByRole("button", { name: /Recover this active task/ }).click();

  await expect(
    page
      .getByRole("complementary", { name: "Delegated tasks" })
      .getByRole("button", { name: /Recover this active task/ }),
  ).toContainText("Interrupted");

  await expect(
    page.getByText("Queue paused · 2", { exact: true }),
  ).toBeVisible();

  await expect(
    page.getByRole("button", { name: "Stop the turn", exact: true }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(history).toContainText("First recovered follow-up");
  await expect(history).toContainText("Second recovered follow-up");
  await expect(history.getByText(/Fixture session turn: 2\./)).toBeVisible();
  await expect(page.getByText(/Queue paused ·|Queued ·/)).toHaveCount(0);

  const instructions = history.getByRole("article", {
    name: "You",
    exact: true,
  });

  await expect(instructions).toHaveCount(3);
  await expect(instructions.nth(1)).toContainText("First recovered follow-up");
  await expect(instructions.nth(2)).toContainText("Second recovered follow-up");
});
