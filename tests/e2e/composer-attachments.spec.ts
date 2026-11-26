import { expect, test } from "./fixtures";

test("choose and drop request files, then paste and preview a follow-up image", async ({
  consolePage: page,
}) => {
  await page.getByRole("button", { name: "New task", exact: true }).click();
  const request = page.getByRole("textbox", { name: "Task message" });
  await request.fill("Review these notes");

  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Attach files" }).press("Enter");

  await (
    await chooser
  ).setFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Selected from disk"),
  });

  await page.getByRole("button", { name: "Preview notes.txt" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Selected from disk");
  await page.keyboard.press("Escape");

  await request.evaluate((field) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File(["Dropped from disk"], "details.txt"));
    // An empty zip archive, a type the panel can't preview.
    const zip = Uint8Array.from([80, 75, 5, 6, ...Array<number>(18).fill(0)]);
    dataTransfer.items.add(new File([zip], "archive.zip"));
    dataTransfer.items.add(new File(["Exclude from request"], "extra.txt"));
    field.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer }));
  });

  await page.getByRole("button", { name: "Remove extra.txt" }).click();
  await page.getByRole("button", { name: "Start task", exact: true }).click();
  const history = page.getByRole("region", { name: "Chat history" });
  await expect(history).toContainText("Fixture session turn: 1.");
  const attachments = history.getByRole("group", { name: "Attachments" });

  await expect(attachments.getByRole("button")).toHaveText([
    /notes\.txt/,
    /details\.txt/,
    /archive\.zip/,
  ]);

  const followUp = page.getByRole("textbox", { name: "Message", exact: true });
  await followUp.fill("Check the screenshot");

  await followUp.evaluate(async (field) => {
    const canvas = document.createElement("canvas");
    canvas.width = 12;
    canvas.height = 8;

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve),
    );

    if (!blob) throw new Error("Unable to create the PNG fixture");

    const clipboardData = new DataTransfer();

    clipboardData.items.add(
      new File([blob], "screenshot.png", { type: blob.type }),
    );

    field.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, clipboardData }),
    );
  });

  await page.getByRole("button", { name: "Preview screenshot.png" }).click();

  await expect(
    dialog.getByRole("img", { name: "screenshot.png" }),
  ).toHaveJSProperty("naturalWidth", 12);

  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await history.getByRole("button", { name: /^screenshot\.png/ }).click();

  const image = page
    .getByRole("dialog")
    .getByRole("img", { name: "screenshot.png" });

  await expect(image).toHaveJSProperty("naturalWidth", 12);
  await expect(image).toHaveJSProperty("naturalHeight", 8);
});
