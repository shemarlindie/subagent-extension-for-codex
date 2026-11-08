import { openAdvancedTask, send } from "./console-actions";
import { expect, test } from "./fixtures";

test("a spent cost budget blocks continuation until a higher limit is applied", async ({
  consolePage: page,
}) => {
  await openAdvancedTask(page, "Spend the cost budget [fixture:cost usd=0.25]");
  await page.getByRole("switch", { name: "Cost limit", exact: true }).check();

  await page
    .getByRole("spinbutton", { name: "Cost limit (USD)", exact: true })
    .fill("0.1");

  await page.getByRole("button", { name: "Start task", exact: true }).click();
  const history = page.getByRole("region", { name: "Chat history" });
  await expect(history).toContainText("Fixture session turn: 1.");

  const budget = page.getByRole("group", {
    name: "Raise cost limit",
    exact: true,
  });

  await expect(budget).toBeVisible();

  // A limit below the current one cannot be applied.
  const limit = budget.getByRole("spinbutton", { name: "Cost limit" });
  await limit.fill("0.05");
  const apply = budget.getByRole("button", { name: "Apply", exact: true });
  await expect(apply).toBeDisabled();
  await limit.fill("1");
  await apply.click();
  await expect(budget).toHaveCount(0);
  await page.reload();
  await expect(history).toContainText("Fixture session turn: 1.");
  await expect(budget).toHaveCount(0);
  await send(page, "Continue within the raised cost limit");
  await expect(history).toContainText("Fixture session turn: 2.");
});
