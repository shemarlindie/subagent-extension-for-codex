import { askForApproval } from "./console-actions";
import { expect, test } from "./fixtures";

test("answer stacked choices with a skip, then deny a tool with a message", async ({
  consolePage: page,
}) => {
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await askForApproval(page);

  await page
    .getByRole("textbox", { name: "Task message" })
    .fill(
      "Decide the review [fixture:question-form] [fixture:permission tool=Edit]",
    );

  await page.getByRole("button", { name: "Start task", exact: true }).click();

  await expect(
    page.getByText("Question 1 of 3", { exact: true }),
  ).toBeVisible();

  const card = (question: string) =>
    page.getByRole("group", { name: question, exact: true });

  // Sending early returns to the first unanswered card instead of answering.
  await page.getByRole("button", { name: "Path", exact: true }).click();
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page.getByRole("button", { name: "Respond", exact: true }).click();

  await expect(page.getByRole("alert")).toHaveText(
    "Answer each question before sending.",
  );

  await expect(
    page.getByText("Question 1 of 3", { exact: true }),
  ).toBeVisible();

  // A skip drops the card's partial answer, and a new choice takes it back.
  const path = card("Which fixture path should be used?");
  await path.getByRole("radio", { name: /^Integration/ }).check();

  await page
    .getByRole("button", { name: "Skip this question", exact: true })
    .click();

  await expect(
    page.getByText("Question 2 of 3", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Path", exact: true }).click();

  await expect(
    path.getByRole("radio", { name: /^Integration/ }),
  ).not.toBeChecked();

  await path.getByRole("radio", { name: /^Unit/ }).check();
  const skipped = page.getByRole("status").filter({ hasText: "Skipped" });
  await expect(skipped).toHaveCount(0);
  await page.getByRole("button", { name: "Next", exact: true }).click();

  // A typed answer joins the multiple choices.
  const checks = card("Which fixture checks should run?");
  await checks.getByRole("checkbox", { name: "Lint", exact: true }).check();
  await checks.getByRole("checkbox", { name: "Tests", exact: true }).check();

  await checks
    .getByRole("textbox", { name: "Write your own answer" })
    .fill("Docs");

  await page.getByRole("button", { name: "Next", exact: true }).click();

  await page
    .getByRole("button", { name: "Skip this question", exact: true })
    .click();

  await expect(skipped).toBeVisible();

  await page.getByRole("button", { name: "Respond", exact: true }).click();

  await page
    .getByRole("button", { name: "Add a message", exact: true })
    .click();

  await page
    .getByRole("textbox", { name: "Optional message to worker" })
    .fill("Leave the file unchanged");

  await page.getByRole("button", { name: "Deny", exact: true }).click();
  const history = page.getByRole("region", { name: "Chat history" });
  await expect(history).toContainText("Fixture session turn: 1.");

  await expect(history).toContainText(
    "Fixture Edit request denied: Leave the file unchanged",
  );

  // The worker receives each answer under its question, in question order.
  await expect(history).toContainText(
    '"Which fixture path should be used?":"Unit"',
  );

  await expect(history).toContainText(
    '"Which fixture checks should run?":"Lint, Tests, Docs"',
  );

  await expect(history).toContainText(
    '"Any notes for the fixture worker?":"(Skipped: the user has no preference; use your best judgment.)"',
  );
});
