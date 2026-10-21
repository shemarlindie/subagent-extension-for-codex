import { startTask } from "./console-actions";
import { expect, test } from "./fixtures";

test("a send with a lost response keeps its draft and a retry delivers it once", async ({
  consolePage: page,
}) => {
  await startTask(page, "Confirm delivery");
  const history = page.getByRole("region", { name: "Chat history" });
  await expect(history).toContainText("Fixture session turn: 1.");
  const composer = page.getByRole("textbox", { name: "Message", exact: true });
  const followUp = "Deliver this follow-up once";

  // The service accepts the send, but the panel never sees its answer.
  await page.route(
    "**/api/tools/app_send_message",
    async (route) => {
      await route.fetch();
      await route.abort("connectionreset");
    },
    { times: 1 },
  );

  await composer.fill(followUp);
  await composer.press("Enter");

  await expect(page.getByRole("alert")).toContainText(
    "Delivery could not be confirmed. Your draft is kept.",
  );

  await expect(history).toContainText("Fixture session turn: 2.");
  await expect(composer).toHaveValue(followUp);

  // Retrying the same draft reuses its request, so the service recognizes it.
  await composer.press("Enter");
  await expect(composer).toHaveValue("");

  const messages = history.getByRole("article", { name: "You", exact: true });
  await expect(messages).toHaveText(["Confirm delivery", followUp]);
  await expect(history).not.toContainText("Fixture session turn: 3.");
  await page.reload();
  await expect(history).toContainText("Fixture session turn: 2.");
  await expect(messages).toHaveText(["Confirm delivery", followUp]);
});

test("the console reconnects after losing its event stream and shows missed work", async ({
  consolePage: page,
  inProcessService,
}) => {
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await startTask(page, "Finish while disconnected [fixture:wait ms=1500]");
  const history = page.getByRole("region", { name: "Chat history" });
  await expect(history).toContainText("Fixture worker running turn 1");

  // Hold the stream down until the turn ends, so its reply arrives while away.
  await page.route("**/api/events", (route) => route.abort());
  inProcessService.dropConnections();
  await expect(page.getByText("Reconnecting…", { exact: true })).toBeVisible();

  // API requests bypass the page's routes, so they see the turn finish.
  await expect
    .poll(async () => {
      const response = await page.request.post("/api/tools/list_tasks", {
        data: {},
        headers: {
          Origin: inProcessService.origin,
          "X-Codex-Subagent-Extension": "1",
        },
      });

      return JSON.stringify(await response.json());
    })
    .toContain('"status":"completed"');

  await expect(history).not.toContainText("Fixture session turn: 1.");
  await page.unroute("**/api/events");
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await expect(history).toContainText("Fixture session turn: 1.");

  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Continue after reconnecting");

  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .press("Enter");

  await expect(history).toContainText("Fixture session turn: 2.");
});
