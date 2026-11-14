import type { ChatItem } from "../../src/shared/tasks/conversation/chat";
import { send, startTask } from "./console-actions";
import { firstReplyTest as test } from "./first-reply-fixtures";
import { expect, requiredAttribute } from "./fixtures";

test("sent messages copy literal text and show their sent times", async ({
  consolePage: page,
  consoleService,
  firstReply,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const request = "Keep **this** `a<b>` literal\n\n- first line";
  const followUp = "Follow **this** `c<d>` literally\n\n- next line";
  const history = page.getByRole("region", { name: "Chat history" });
  const messages = history.getByRole("article", { name: "You", exact: true });
  const initial = messages.first();

  await startTask(page, request);
  await firstReply.held;
  await expect(initial.locator(".chat-bubble")).toHaveText(request);

  const copy = initial.getByRole("button", {
    name: "Copy message",
    exact: true,
  });

  await copy.focus();
  await copy.press("Enter");

  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(request);

  const initialTime = initial.locator(".chat-message-actions button").filter({
    has: page.locator("time"),
  });

  await page.keyboard.press("Tab");
  await expect(initialTime).toBeFocused();
  await initialTime.press("Enter");
  const timestampNote = page.getByRole("dialog");

  await expect(timestampNote).toHaveText(
    await requiredAttribute(initialTime, "aria-label"),
  );

  await expect(initialTime).toBeFocused();
  await initialTime.press("Escape");
  await expect(timestampNote).toHaveCount(0);

  firstReply.release();

  await expect(
    history.getByRole("button", { name: "Copy response", exact: true }),
  ).toHaveCount(1);

  await send(page, followUp);

  await expect(
    history.getByRole("button", { name: "Copy response", exact: true }),
  ).toHaveCount(2);

  const followup = messages.last();
  await expect(followup.locator(".chat-bubble")).toHaveText(followUp);

  await followup
    .getByRole("button", { name: "Copy message", exact: true })
    .click();

  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(followUp);

  const task = page
    .getByRole("complementary", { name: "Delegated tasks" })
    .locator("[data-task]");

  const response = await page.request.post("/api/tools/app_wait_for_updates", {
    data: {
      view: {
        list: {},
        chat: { task_id: await task.getAttribute("data-task"), after: 0 },
      },
    },
    headers: {
      Origin: consoleService.origin,
      "X-Subagent-Extension-For-Codex": "1",
    },
  });

  await expect(response).toBeOK();

  const { result } = (await response.json()) as {
    result: { view: { chat: { items: ChatItem[] } } };
  };

  const sent = result.view.chat.items.flatMap((item) =>
    item.kind === "message" && item.message.from === "user"
      ? [item.message]
      : [],
  );

  expect(sent).toHaveLength(2);

  for (const [index, message] of sent.entries()) {
    await expect(messages.nth(index).locator("time")).toHaveAttribute(
      "datetime",
      message.timestamp,
    );
  }

  const outcomes = result.view.chat.items.filter(
    (item) => item.kind === "outcome",
  );

  expect(outcomes).toHaveLength(2);
  expect(sent[0]?.timestamp).not.toBe(outcomes[0]?.timestamp);

  const followupTime = followup.locator(".chat-message-actions button").filter({
    has: page.locator("time"),
  });

  await followupTime.click();

  await expect(timestampNote).toHaveText(
    await requiredAttribute(followupTime, "aria-label"),
  );
});
