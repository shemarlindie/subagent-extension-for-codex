// @vitest-environment jsdom
import assert from "node:assert/strict";

import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { EditableText } from "./editable-text";

afterEach(cleanup);

function mockWrappedTextMeasurement(lineHeight = 28) {
  const bounds = HTMLElement.prototype.getBoundingClientRect;
  const computedStyle = window.getComputedStyle;

  const height = (element: Element) =>
    Math.max(
      1,
      Math.ceil((element.getAttribute("data-value")?.length ?? 0) / 25),
    ) * lineHeight;

  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const rect = bounds.call(this);

      return this.classList.contains("editable-text-measure")
        ? { ...rect, height: height(this) }
        : rect;
    },
  );

  vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(
    function (this: Element) {
      return this.classList.contains("editable-text-measure")
        ? height(this)
        : 0;
    },
  );

  vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
    const style = computedStyle.call(window, element, pseudo);

    return element.classList.contains("editable-text-measure")
      ? {
          ...style,
          lineHeight: `${lineHeight}px`,
          paddingTop: "0px",
          paddingBottom: "0px",
        }
      : style;
  });
}

function setup(
  onSave = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(),
) {
  const view = render(
    <EditableText value="Original title" label="Title" onSave={onSave} />,
  );

  fireEvent.click(
    view.getByRole("button", { name: "Edit title: Original title" }),
  );

  const input = view.getByRole("textbox", {
    name: "Title",
  }) as HTMLTextAreaElement;

  return { view, input, onSave };
}

test("Escape discards changes and reopening starts from the saved value", () => {
  const { view, input, onSave } = setup();

  fireEvent.change(input, { target: { value: "Discard this title" } });
  fireEvent.keyDown(input, { key: "Escape" });

  assert.equal(view.queryByRole("textbox") === null, true);
  assert.equal(onSave.mock.calls.length, 0);
  assert.equal(document.activeElement === input, false);

  assert.equal(
    document.activeElement ===
      view.getByRole("button", { name: "Edit title: Original title" }),
    false,
  );

  fireEvent.click(
    view.getByRole("button", { name: "Edit title: Original title" }),
  );

  assert.equal(
    (view.getByRole("textbox") as HTMLTextAreaElement).value,
    "Original title",
  );
});

test("blank titles cannot save and unchanged titles finish without a request", () => {
  const { view, input, onSave } = setup();

  fireEvent.change(input, { target: { value: "   " } });

  fireEvent.keyDown(input, { key: "Enter" });
  assert.equal(onSave.mock.calls.length, 0);
  expect(view.getByRole("textbox")).toBe(input);
  fireEvent.change(input, { target: { value: "  Original title  " } });
  fireEvent.keyDown(input, { key: "Enter" });
  assert.equal(onSave.mock.calls.length, 0);
  assert.equal(view.queryByRole("textbox") === null, true);
});

test("failed saves retain the draft and allow retry", async () => {
  const onSave = vi
    .fn<(value: string) => Promise<void>>()
    .mockRejectedValueOnce(new Error("Rename failed"))
    .mockResolvedValueOnce();

  const { view, input } = setup(onSave);

  fireEvent.change(input, { target: { value: "Retry this title" } });
  fireEvent.keyDown(input, { key: "Enter" });

  await waitFor(() =>
    assert.equal(view.getByRole("alert").textContent, "Rename failed"),
  );

  assert.equal(input.value, "Retry this title");
  assert.equal(input.getAttribute("aria-invalid"), "true");
  fireEvent.keyDown(input, { key: "Enter" });

  await waitFor(() => assert.equal(view.queryByRole("textbox") === null, true));

  assert.deepEqual(onSave.mock.calls, [
    ["Retry this title"],
    ["Retry this title"],
  ]);

  expect(view.queryByRole("alert")).toBeNull();
});

test("a pending save suppresses duplicate submissions and cancellation", async () => {
  let resolveSave!: () => void;

  const onSave = vi.fn<(value: string) => Promise<void>>(
    () =>
      new Promise<void>((resolve) => {
        resolveSave = resolve;
      }),
  );

  const { view, input } = setup(onSave);

  fireEvent.change(input, { target: { value: "Pending title" } });
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.keyDown(input, { key: "Escape" });
  fireEvent.keyDown(input, { key: "Enter" });

  assert.equal(onSave.mock.calls.length, 1);
  assert.equal(input.disabled, true);

  expect(view.getByRole("textbox")).toBe(input);

  await act(async () => resolveSave());
  assert.equal(view.queryByRole("textbox") === null, true);
});

test("Enter while composing text does not submit", () => {
  const { view, input, onSave } = setup();

  fireEvent.change(input, { target: { value: "Composing title" } });

  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    isComposing: true,
    bubbles: true,
    cancelable: true,
  });

  fireEvent(input, event);

  assert.equal(event.defaultPrevented, false);
  fireEvent.keyDown(input, { key: "Escape", isComposing: true });

  assert.equal(onSave.mock.calls.length, 0);
  expect(view.getByRole("textbox")).toBe(input);
});

test("clicking outside saves the latest trimmed draft without stealing focus", async () => {
  const { view, input, onSave } = setup();
  const outside = document.createElement("button");
  document.body.append(outside);

  try {
    fireEvent.change(input, { target: { value: "Earlier draft" } });
    fireEvent.change(input, { target: { value: "  Save this draft  " } });
    fireEvent.pointerDown(outside);
    outside.focus();

    await waitFor(() =>
      assert.equal(view.queryByRole("textbox") === null, true),
    );

    assert.deepEqual(onSave.mock.calls, [["Save this draft"]]);
    assert.equal(document.activeElement === outside, true);
  } finally {
    outside.remove();
  }
});

test("pointer clicks within the editor keep it open and allow confirmation", async () => {
  const { view, input, onSave } = setup();
  fireEvent.change(input, { target: { value: "Keep this title" } });
  fireEvent.pointerDown(input);
  assert.equal(view.queryByRole("textbox") !== null, true);
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => assert.equal(view.queryByRole("textbox") === null, true));
  assert.deepEqual(onSave.mock.calls, [["Keep this title"]]);
});

test("wrapping switches native editors while preserving the draft and caret", () => {
  mockWrappedTextMeasurement();
  const { view, input, onSave } = setup();

  assert.equal(input.tagName, "INPUT");
  const wrappedDraft = "A title long enough to wrap onto the next line";

  fireEvent.change(input, {
    target: { value: wrappedDraft, selectionStart: 12, selectionEnd: 18 },
  });

  const textarea = view.getByRole("textbox", {
    name: "Title",
  }) as HTMLTextAreaElement;

  assert.equal(textarea.tagName, "TEXTAREA");
  assert.equal(textarea.value, wrappedDraft);
  assert.equal(document.activeElement === textarea, true);
  assert.equal(textarea.selectionStart, 12);
  assert.equal(textarea.selectionEnd, 18);

  fireEvent.change(textarea, {
    target: { value: "Short draft", selectionStart: 3, selectionEnd: 3 },
  });

  const shortenedInput = view.getByRole("textbox", {
    name: "Title",
  }) as HTMLInputElement;

  assert.equal(shortenedInput.tagName, "INPUT");
  assert.equal(shortenedInput.value, "Short draft");
  assert.equal(document.activeElement === shortenedInput, true);
  assert.equal(shortenedInput.selectionStart, 3);
  assert.equal(shortenedInput.selectionEnd, 3);
  assert.equal(onSave.mock.calls.length, 0);
});

test("Enter confirms a wrapped title without inserting a newline", async () => {
  mockWrappedTextMeasurement();
  const { view, input, onSave } = setup();
  const wrappedDraft = "A title long enough to wrap onto the next line";

  fireEvent.change(input, { target: { value: `  ${wrappedDraft}  ` } });

  const textarea = view.getByRole("textbox", { name: "Title" });

  assert.equal(textarea.tagName, "TEXTAREA");
  const allowedDefault = fireEvent.keyDown(textarea, { key: "Enter" });

  assert.equal(allowedDefault, false);
  await waitFor(() => assert.equal(view.queryByRole("textbox") === null, true));
  assert.deepEqual(onSave.mock.calls, [[wrappedDraft]]);
});

test("the readonly preview field is reused when editing begins", () => {
  const view = render(
    <EditableText value="Original title" label="Title" onSave={vi.fn()} />,
  );

  const preview = view.container.querySelector("input");

  assert.ok(preview);
  assert.equal(preview.readOnly, true);
  assert.equal(view.queryByRole("textbox") === null, true);

  fireEvent.click(
    view.getByRole("button", { name: "Edit title: Original title" }),
  );

  const editor = view.getByRole("textbox", { name: "Title" });

  assert.equal(editor === preview, true);
  assert.equal(preview.readOnly, false);
  assert.equal(document.activeElement === preview, true);
  fireEvent.keyDown(editor, { key: "Escape" });
  assert.equal(view.container.querySelector("input") === preview, true);
  assert.equal(preview.readOnly, true);
  assert.equal(view.queryByRole("textbox") === null, true);
});

test("growing wrapped text preserves the draft, caret and focus without ancestor animation", (t) => {
  mockWrappedTextMeasurement();

  const animateDescriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "animate",
  );

  const animate = vi.fn(() => ({ cancel() {} }));

  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value: animate,
  });

  t.onTestFinished(() => {
    if (animateDescriptor) {
      Object.defineProperty(
        HTMLElement.prototype,
        "animate",
        animateDescriptor,
      );
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "animate");
    }
  });

  // Expose changing root bounds so an ancestor height animation would run.
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      const editor = this.querySelector<HTMLElement>(".editable-text-editor");

      return editor ? parseFloat(editor.style.height) || 0 : 0;
    },
  );

  const focus = vi.spyOn(HTMLElement.prototype, "focus");
  const { view, input } = setup();

  assert.equal(focus.mock.contexts[0] === input, true);
  assert.deepEqual(focus.mock.calls[0], [{ preventScroll: true }]);

  const wrappedDraft = "A title long enough to wrap onto the next line";

  fireEvent.change(input, {
    target: { value: wrappedDraft, selectionStart: 12, selectionEnd: 12 },
  });

  const textarea = view.getByRole("textbox", {
    name: "Title",
  }) as HTMLTextAreaElement;

  assert.equal(textarea.tagName, "TEXTAREA");
  textarea.scrollTop = 22;
  textarea.scrollLeft = 7;
  const growingDraft = `${wrappedDraft} and more title text`;

  fireEvent.change(textarea, {
    target: { value: growingDraft, selectionStart: 53, selectionEnd: 53 },
  });

  assert.equal(view.getByRole("textbox") === textarea, true);
  assert.equal(textarea.value, growingDraft);
  assert.equal(animate.mock.calls.length, 0);

  assert.equal(textarea.scrollTop, 0);
  assert.equal(textarea.scrollLeft, 0);
  assert.equal(textarea.selectionStart, 53);
  assert.equal(textarea.selectionEnd, 53);
  assert.equal(document.activeElement === textarea, true);
});
