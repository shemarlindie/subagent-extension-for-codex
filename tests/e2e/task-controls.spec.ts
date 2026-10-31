import { openAdvancedTask, startTask } from "./console-actions";
import { expect, test } from "./fixtures";

/** Holds the first turn before it takes steers, until the test releases it. */
const heldTest = test.extend<{ firstTurn: PromiseWithResolvers<void> }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires destructured dependencies.
  firstTurn: async ({}, use) => {
    await use(Promise.withResolvers<void>());
  },
  fixtureProvider: async ({ firstTurn }, use) => {
    await use({
      turnDelayMs: 0,
      replyPaceMs: 0,
      beforeReply: async ({ task }) => {
        if (task.turn === 1) await firstTurn.promise;
      },
    });
  },
});

test("edit, reorder and remove queued messages, then stop and resume after reload", async ({
  consolePage: page,
}) => {
  const initial = "Hold the queue [fixture:question]";
  await startTask(page, initial);

  await expect(
    page.getByRole("button", { name: "Respond", exact: true }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: "Show composer", exact: true })
    .click();

  const composer = page.getByRole("textbox", { name: "Message", exact: true });
  const queue = page.getByRole("region", { name: "Messages not sent yet" });

  for (const message of [
    "First queued turn",
    "Second queued turn",
    "Remove this turn",
  ]) {
    await composer.fill(message);
    await composer.press("Enter");
    await expect(queue.getByText(message, { exact: true })).toBeVisible();
  }

  const row = (text: string) =>
    queue.getByRole("listitem").filter({ hasText: text });

  await row("First queued turn")
    .getByRole("button", { name: "Edit", exact: true })
    .click();

  await queue
    .getByRole("textbox", { name: "Queued message" })
    .fill("Edited first turn");

  await queue.getByRole("button", { name: "Save", exact: true }).click();

  await expect(
    queue.getByText("Edited first turn", { exact: true }),
  ).toBeVisible();

  // Edits and moves show in place. The shortcuts undo and redo them, and the
  // composer keeps its own undo.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(queue.getByText("First queued turn")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(queue.getByText("Edited first turn")).toBeVisible();

  const moving = row("Second queued turn").locator("[aria-keyshortcuts]");
  await expect(moving).toHaveAttribute("draggable", "true");
  await moving.press("Alt+ArrowUp");

  const reordered = [
    "Second queued turn",
    "Edited first turn",
    "Remove this turn",
  ];

  await expect(queue.getByRole("listitem")).toHaveText(reordered);
  await composer.press("ControlOrMeta+z");
  await expect(queue.getByRole("listitem")).toHaveText(reordered);
  await moving.press("ControlOrMeta+z");

  await expect(queue.getByRole("listitem")).toHaveText([
    "Edited first turn",
    "Second queued turn",
    "Remove this turn",
  ]);

  await moving.press("ControlOrMeta+Shift+z");
  await expect(queue.getByRole("listitem")).toHaveText(reordered);

  // A removal offers Undo, which puts the message back in its place.
  await row("Remove this turn")
    .getByRole("button", { name: "Remove", exact: true })
    .click();

  await expect(queue.getByRole("listitem")).toHaveText(reordered.slice(0, 2));

  await page
    .getByRole("dialog", { name: "Removed “Remove this turn” from the queue" })
    .getByRole("button", { name: "Undo", exact: true })
    .click();

  await expect(queue.getByRole("listitem")).toHaveText(reordered);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(queue.getByRole("listitem")).toHaveText(reordered.slice(0, 2));

  await page
    .getByRole("button", { name: "Stop the turn", exact: true })
    .click();

  await expect(queue).toContainText("Queue paused · 2");
  await page.reload();
  await expect(queue).toContainText("Queue paused · 2");

  await expect(queue.getByRole("listitem")).toHaveText([
    "Second queued turn",
    "Edited first turn",
  ]);

  await expect(
    page.getByRole("button", { name: "Respond", exact: true }),
  ).toHaveCount(0);

  await queue.getByRole("button", { name: "Resume", exact: true }).click();

  const history = page.getByRole("region", { name: "Chat history" });
  await expect(history).toContainText("Fixture session turn: 3.");
  await expect(queue).toHaveCount(0);

  // User messages enter durable history in delivery order, between worker replies.
  await expect(
    history.getByRole("article", { name: "You", exact: true }),
  ).toHaveText([initial, "Second queued turn", "Edited first turn"]);

  await expect(
    history
      .getByRole("article")
      .filter({ hasText: /Fixture session turn: [23]\./ }),
  ).toHaveText([/Fixture session turn: 2\./, /Fixture session turn: 3\./]);

  await page.reload();
  await expect(history).toContainText("Fixture session turn: 3.");
  await expect(history).not.toContainText("Remove this turn");
});

test("exhaust the runtime budget, apply a higher limit and continue after reload", async ({
  consolePage: page,
}) => {
  await openAdvancedTask(
    page,
    "Exercise the runtime limit [fixture:wait ms=60000]",
  );

  await page
    .getByRole("switch", { name: "Runtime limit", exact: true })
    .check();

  await page
    .getByRole("spinbutton", { name: "Runtime limit (mins)", exact: true })
    .fill("0.01");

  await page.getByRole("button", { name: "Start task", exact: true }).click();

  const history = page.getByRole("region", { name: "Chat history" });
  await expect(history).toContainText("Runtime budget exhausted");

  await expect(history.getByRole("status")).toContainText(
    "Runtime limit reached",
  );

  await page.reload();
  await expect(history).toContainText("Runtime budget exhausted");

  const budget = page.getByRole("group", {
    name: "Raise runtime limit",
    exact: true,
  });

  await budget
    .getByRole("spinbutton", { name: "Runtime limit (minutes)" })
    .fill("1");

  await budget.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(budget).toHaveCount(0);
  await page.reload();

  await expect(
    page.getByRole("group", { name: "Raise runtime limit", exact: true }),
  ).toHaveCount(0);

  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Continue within the raised limit");

  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .press("Enter");

  await expect(history).toContainText("Fixture session turn: 2.");
  await expect(history).toContainText("Runtime budget exhausted");
});

test("a dependent task waits across reload and runs after its prerequisite completes", async ({
  consolePage: page,
}) => {
  const prerequisite = "Prepare dependency [fixture:question]";
  await startTask(page, prerequisite);

  await expect(
    page.getByRole("button", { name: "Respond", exact: true }),
  ).toBeVisible();

  await openAdvancedTask(page, "Run after the prerequisite");

  await page
    .getByRole("combobox", { name: "Wait for tasks (optional)" })
    .click();

  await page.getByRole("option", { name: prerequisite, exact: true }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Start task", exact: true }).click();
  const history = page.getByRole("region", { name: "Chat history" });
  await expect(history).toContainText("Waiting on dependency");
  await expect(history).not.toContainText("Fixture session turn:");
  await page.reload();
  await expect(history).toContainText("Waiting on dependency");
  const tasks = page.getByRole("complementary", { name: "Delegated tasks" });

  await tasks.getByRole("button", { name: /Prepare dependency/ }).click();

  await page
    .getByRole("textbox", { name: "Which fixture path should be used? (1/1)" })
    .fill("Release the dependent task");

  await page.getByRole("button", { name: "Respond", exact: true }).click();
  await expect(history).toContainText("Fixture session turn: 1.");

  await tasks
    .getByRole("button", { name: /Run after the prerequisite/ })
    .click();

  await expect(history).toContainText("Fixture session turn: 1.");
  await expect(history).not.toContainText("Waiting on dependency");
});

heldTest(
  "steer a running turn, interrupt to send a steer now, and clear a paused queue",
  async ({ consolePage: page, firstTurn }) => {
    await startTask(page, "Steer the first turn");
    const history = page.getByRole("region", { name: "Chat history" });
    await expect(history).toContainText("Fixture worker running turn 1");

    const composer = page.getByRole("textbox", {
      name: "Message",
      exact: true,
    });

    const queue = page.getByRole("region", { name: "Messages not sent yet" });

    // Cmd/Ctrl+Enter steers the running turn at its next checkpoint.
    await composer.fill("Use the steered path");
    await composer.press("ControlOrMeta+Enter");

    await expect(
      queue.getByRole("button", {
        name: "Interrupt and send now",
        exact: true,
      }),
    ).toBeVisible();

    firstTurn.resolve();
    await expect(history).toContainText("Also took: Use the steered path");
    await expect(history).toContainText("Fixture session turn: 1.");

    // A queued message promoted to a steer waits while the turn holds steers.
    await composer.fill(
      "Hold the next turn [fixture:wait ms=60000] [fixture:late]",
    );

    await composer.press("Enter");
    await expect(history).toContainText("Fixture worker running turn 2");
    await composer.fill("Send this now");
    await composer.press("Enter");
    await expect(queue).toContainText("Queued · 1");

    await queue
      .getByRole("listitem")
      .filter({ hasText: "Send this now" })
      .getByRole("button", { name: "Steer", exact: true })
      .click();

    const sendNow = queue.getByRole("button", {
      name: "Interrupt and send now",
      exact: true,
    });

    await expect(sendNow).toBeVisible();
    await expect(queue).not.toContainText("Queued ·");

    // Interrupting delivers the pending steer as the next turn.
    await sendNow.click();
    await expect(history).toContainText("Fixture session turn: 3.");
    await expect(queue).toHaveCount(0);

    await expect(
      history.getByRole("article", { name: "You", exact: true }).last(),
    ).toHaveText("Send this now");

    // Clearing a paused queue discards its messages without sending them.
    await composer.fill("Hold again [fixture:wait ms=60000]");
    await composer.press("Enter");
    await expect(history).toContainText("Fixture worker running turn 4");
    await composer.fill("Drop this message");
    await composer.press("Enter");
    await expect(queue).toContainText("Queued · 1");

    await page
      .getByRole("button", { name: "Stop the turn", exact: true })
      .click();

    await expect(queue).toContainText("Queue paused · 1");
    await queue.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(queue).toHaveCount(0);
    await page.reload();
    await expect(history).toContainText("Fixture worker running turn 4");
    await expect(queue).toHaveCount(0);
    await expect(history).not.toContainText("Drop this message");
  },
);
