import { startTask } from "./console-actions";
import { expect, test } from "./fixtures";
import { CONSOLE_TOKEN } from "./server";

test("sign in and explicitly register a project through the console", async ({
  page,
  repository,
}) => {
  await page.goto("/");
  await page.getByLabel("Console token").fill(CONSOLE_TOKEN);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.getByRole("button", { name: "Manage", exact: true }).click();
  await page.getByRole("button", { name: "Add project", exact: true }).click();
  await page.getByLabel("Repository path").fill(repository);

  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add project", exact: true })
    .click();

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Tasks", exact: true }).click();

  await page
    .getByRole("combobox", { name: "Project scope", exact: true })
    .click();

  await page.getByRole("option").filter({ hasText: repository }).click();
  await page.reload();

  await expect(
    page.getByRole("combobox", { name: "Project scope", exact: true }),
  ).toContainText("repository");

  await expect(
    page.getByRole("button", { name: "New task", exact: true }),
  ).toBeEnabled();
});

test("reload keeps New task open until an existing task is selected", async ({
  consolePage: page,
}) => {
  const title = "Existing task before composing";
  await startTask(page, title);
  const history = page.getByRole("region", { name: "Chat history" });
  await expect(history).toContainText("Fixture session turn: 1.");

  await page.getByRole("button", { name: "New task", exact: true }).click();

  await expect(
    page.getByRole("textbox", { name: "Task message" }),
  ).toBeVisible();

  await page.reload();

  const taskList = page.getByRole("complementary", { name: "Delegated tasks" });

  const existingTask = taskList.getByRole("button", {
    name: new RegExp(title),
  });

  await expect(existingTask).toBeVisible();

  await expect(page.getByRole("textbox", { name: "Task message" })).toHaveValue(
    "",
  );

  await expect(history).toHaveCount(0);

  await existingTask.click();
  await expect(history).toContainText("Fixture session turn: 1.");
  await page.reload();
  await expect(history).toContainText("Fixture session turn: 1.");

  await expect(page.getByRole("textbox", { name: "Task message" })).toHaveCount(
    0,
  );
});

test("create a task, answer input, approve a tool, and continue after reload", async ({
  consolePage: page,
}) => {
  await page.getByRole("button", { name: "New task", exact: true }).click();

  await page
    .getByRole("textbox", { name: "Task message" })
    .fill(
      "Review input routing [fixture:question] [fixture:permission tool=Bash]",
    );

  await page.getByRole("button", { name: "Start task", exact: true }).click();

  await expect(
    page.getByText("Which fixture path should be used? (1/1)", { exact: true }),
  ).toBeVisible();

  await page
    .getByRole("textbox", { name: "Which fixture path should be used? (1/1)" })
    .fill("Use the integration path");

  await page.getByRole("button", { name: "Respond", exact: true }).click();

  await page
    .getByRole("button", {
      name: "Allow the fixture Bash request",
      exact: true,
    })
    .click();

  await expect(
    page
      .getByRole("region", { name: "Chat history" })
      .getByText(/Fixture session turn: 1\./),
  ).toBeVisible();

  await expect(
    page
      .getByRole("region", { name: "Chat history" })
      .getByText(/Fixture Bash request approved; no real tool ran\./),
  ).toBeVisible();

  await page.reload();

  await expect(
    page
      .getByRole("region", { name: "Chat history" })
      .getByText(/Fixture session turn: 1\./),
  ).toBeVisible();

  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Continue the review");

  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .press("Enter");

  await expect(
    page
      .getByRole("region", { name: "Chat history" })
      .getByText(/Fixture session turn: 2\./),
  ).toBeVisible();

  await expect(
    page
      .getByRole("region", { name: "Chat history" })
      .getByText(/In-memory session retained 1 earlier turn/),
  ).toBeVisible();
});

test("review recorded worktree edits and retain them after removing the worktree", async ({
  consolePage: page,
}) => {
  await page.getByRole("button", { name: "More ways to start a task" }).click();
  await page.getByRole("menuitem", { name: /Advanced task/ }).click();

  await page
    .getByLabel("Description", { exact: true })
    .fill("Review a recorded change [fixture:change]");

  await page.getByRole("combobox", { name: "Workspace", exact: true }).click();
  await page.getByRole("option", { name: /worktree/i }).click();
  await page.getByRole("button", { name: "Start task", exact: true }).click();

  await expect(
    page
      .getByRole("region", { name: "Chat history" })
      .getByText(/Fixture session turn: 1\./),
  ).toBeVisible();

  await page.getByRole("tab", { name: "Changes" }).click();

  await expect(
    page.getByText(/^fixture-scenario-.*-turn-1\.md$/),
  ).toBeVisible();

  await expect(page.getByRole("tabpanel", { name: "Changes" })).toContainText(
    "Generated for task",
  );

  await page
    .getByRole("button", { name: /^Preview fixture-scenario-/ })
    .click();

  const preview = page.getByRole("dialog");
  await expect(preview).toContainText("Generated for task");
  await preview.getByRole("button", { name: "Close", exact: true }).click();

  await page
    .getByRole("button", { name: "Remove worktree", exact: true })
    .click();

  const confirmation = page.getByRole("dialog");
  await expect(confirmation).toBeVisible();

  await confirmation
    .getByRole("button", { name: "Discard changes and remove" })
    .click();

  await expect(confirmation).toHaveCount(0);

  await expect(
    page.getByRole("button", { name: "Delete branch", exact: true }),
  ).toBeEnabled();

  await page
    .getByRole("button", { name: "Delete branch", exact: true })
    .click();

  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete branch", exact: true })
    .click();

  await expect(page.getByRole("dialog")).toHaveCount(0);

  await expect(
    page.getByRole("button", { name: "Delete branch", exact: true }),
  ).toHaveCount(0);

  await expect(
    page.getByText(/^fixture-scenario-.*-turn-1\.md$/),
  ).toBeVisible();

  await page.reload();

  await expect(
    page.getByText(/^fixture-scenario-.*-turn-1\.md$/),
  ).toBeVisible();

  await expect(page.getByRole("tabpanel", { name: "Changes" })).toContainText(
    "Generated for task",
  );
});

test("a failed turn keeps its history and accepts a successful follow-up", async ({
  consolePage: page,
}) => {
  await page.getByRole("button", { name: "New task", exact: true }).click();

  await page
    .getByRole("textbox", { name: "Task message" })
    .fill("Check failure recovery [fixture:fail stage=before-reply]");

  await page.getByRole("button", { name: "Start task", exact: true }).click();
  const history = page.getByRole("region", { name: "Chat history" });
  await expect(history).toContainText("Fixture failure at before-reply");
  await page.reload();
  await expect(history).toContainText("Fixture failure at before-reply");

  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Retry the review without the failure");

  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .press("Enter");

  await expect(history).toContainText("Fixture session turn: 2.");
  await expect(history).toContainText("Fixture failure at before-reply");
});

test("archive a completed task, restore it, and explicitly delete it", async ({
  consolePage: page,
  repository,
}) => {
  const title = "Review archive lifecycle";
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByRole("textbox", { name: "Task message" }).fill(title);

  // Once the composer's reads finish, Enter starts the task and typing focus
  // stays in Chat's composer.
  await expect(
    page.getByRole("button", { name: "Start task", exact: true }),
  ).toBeEnabled();

  await page.getByRole("textbox", { name: "Task message" }).press("Enter");

  await expect(
    page.getByRole("textbox", { name: "Message", exact: true }),
  ).toBeFocused();

  await expect(
    page.getByRole("region", { name: "Chat history" }),
  ).toContainText("Fixture session turn: 1.");

  await page.getByRole("button", { name: "Task actions" }).click();
  await page.getByRole("menuitem", { name: "Archive", exact: true }).click();
  const taskList = page.getByRole("complementary", { name: "Delegated tasks" });

  await expect(
    taskList.getByRole("button", { name: new RegExp(title) }),
  ).toHaveCount(0);

  await page.reload();

  await expect(
    taskList.getByRole("button", { name: new RegExp(title) }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Manage", exact: true }).click();
  const project = page.getByRole("listitem").filter({ hasText: repository });
  await project.getByRole("button", { name: /View archived tasks/ }).click();

  await expect(
    page.getByRole("list", { name: "Archived tasks" }),
  ).toContainText(title);

  await page
    .getByRole("button", { name: "Unarchive all", exact: true })
    .click();

  await expect(
    page.getByText("No archived tasks in this project.", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await taskList.getByRole("button", { name: new RegExp(title) }).click();
  await page.getByRole("button", { name: "Task actions" }).click();

  await page
    .getByRole("menuitem", { name: "Delete task", exact: true })
    .click();

  const confirmation = page.getByRole("dialog", {
    name: "Delete task?",
    exact: true,
  });

  await confirmation
    .getByRole("button", { name: "Cancel", exact: true })
    .click();

  await expect(
    taskList.getByRole("button", { name: new RegExp(title) }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Task actions" }).click();

  await page
    .getByRole("menuitem", { name: "Delete task", exact: true })
    .click();

  await confirmation
    .getByRole("button", { name: "Delete task", exact: true })
    .click();

  await expect(confirmation).toHaveCount(0);
  await page.reload();

  await expect(
    taskList.getByRole("button", { name: new RegExp(title) }),
  ).toHaveCount(0);
});

test("save task defaults and reload the settings from the service", async ({
  consolePage: page,
}) => {
  await page.getByRole("button", { name: "Settings", exact: true }).click();

  const prefix = page.getByRole("textbox", {
    name: "Worktree branch prefix",
    exact: true,
  });

  await expect(prefix).toHaveValue("agent/");
  await prefix.fill("browser/");

  await page
    .getByRole("button", { name: "Save 1 change", exact: true })
    .click();

  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();

  await page.reload();
  await expect(prefix).toHaveValue("browser/");
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await page.getByRole("button", { name: "New task", exact: true }).click();

  await page
    .getByRole("textbox", { name: "Task message" })
    .fill("Keep a task draft while changing settings");

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await prefix.fill("agent/");

  await page
    .getByRole("button", { name: "Save 1 change", exact: true })
    .click();

  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();

  await page.getByRole("button", { name: "Tasks", exact: true }).click();

  await expect(page.getByRole("textbox", { name: "Task message" })).toHaveValue(
    "Keep a task draft while changing settings",
  );
});
