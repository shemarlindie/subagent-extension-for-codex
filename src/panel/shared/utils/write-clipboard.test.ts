// @vitest-environment jsdom
import assert from "node:assert/strict";

import { onTestFinished, test, vi } from "vitest";

import { writeClipboardText } from "./write-clipboard";

function replace(object: object, key: string, value: unknown) {
  const previous = Object.getOwnPropertyDescriptor(object, key);

  Object.defineProperty(object, key, { configurable: true, value });

  onTestFinished(() => {
    if (previous) Object.defineProperty(object, key, previous);
    else Reflect.deleteProperty(object, key);
  });
}

function selection() {
  const input = document.createElement("input");
  const paragraph = document.createElement("p");

  paragraph.textContent = "Keep this selected";
  document.body.append(input, paragraph);
  input.focus();
  const range = document.createRange();

  range.selectNodeContents(paragraph);
  document.getSelection()?.removeAllRanges();
  document.getSelection()?.addRange(range);

  onTestFinished(() => {
    input.remove();
    paragraph.remove();
    document.getSelection()?.removeAllRanges();
  });

  return () => {
    assert.equal(document.activeElement, input);
    assert.equal(document.getSelection()?.toString(), "Keep this selected");
    assert.equal(document.querySelector("textarea"), null);
  };
}

test("native clipboard writes the complete value without a fallback", async () => {
  const text = `git push -u origin agent/${"long-branch".repeat(40)}`;
  const writeText = vi.fn(async () => {});
  const execCommand = vi.fn(() => true);

  replace(navigator, "clipboard", { writeText });
  replace(document, "execCommand", execCommand);
  await writeClipboardText(text);
  assert.deepEqual(writeText.mock.calls, [[text]]);
  assert.equal(execCommand.mock.calls.length, 0);
  assert.equal(document.querySelector("textarea"), null);
});

test.each(["missing", "rejected"])(
  "a %s clipboard API falls back to selecting the full value, then restores focus and selection",
  async (api) => {
    const text = "cd /worktrees/a directory/with a very long path";
    const verifyRestored = selection();

    const writeText = vi.fn(async () => {
      throw new Error("Host clipboard access denied");
    });

    const execCommand = vi.fn((command: string) => {
      const temporary = document.querySelector("textarea");

      assert.equal(command, "copy");
      assert.ok(temporary);
      assert.equal(temporary.value, text);
      assert.equal(temporary.selectionStart, 0);
      assert.equal(temporary.selectionEnd, text.length);

      return true;
    });

    replace(
      navigator,
      "clipboard",
      api === "missing" ? undefined : { writeText },
    );

    replace(document, "execCommand", execCommand);
    await writeClipboardText(text);
    assert.equal(execCommand.mock.calls.length, 1);
    assert.equal(writeText.mock.calls.length, api === "missing" ? 0 : 1);
    verifyRestored();
  },
);

test.each(["false", "throws", "missing"])(
  "a fallback that %s reports manual-copy guidance and cleans up",
  async (outcome) => {
    const verifyRestored = selection();

    replace(navigator, "clipboard", undefined);

    replace(
      document,
      "execCommand",
      outcome === "missing"
        ? undefined
        : () => {
            if (outcome === "throws") throw new Error("Host denied copy");

            return false;
          },
    );

    await assert.rejects(
      writeClipboardText("git checkout agent/review"),
      /select.*copy|copy.*manually/i,
    );

    verifyRestored();
  },
);
