// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, test } from "vitest";

import { Button, buttonClass } from "../ui/components/button";

afterEach(cleanup);

test("buttons default to type button so forms submit only on purpose", () => {
  render(
    createElement(
      "form",
      null,
      createElement(Button, null, "Back"),
      createElement(Button, { type: "submit", variant: "primary" }, "Send"),
    ),
  );

  assert.equal(
    screen.getByRole("button", { name: "Back" }).getAttribute("type"),
    "button",
  );

  assert.equal(
    screen.getByRole("button", { name: "Send" }).getAttribute("type"),
    "submit",
  );
});

test("variants map onto the theme classes and keep extra classes", () => {
  assert.equal(buttonClass(), undefined);
  assert.equal(buttonClass("primary"), "primary");
  assert.equal(buttonClass("ghost", { className: "back" }), "ghost back");

  assert.equal(
    buttonClass("text", { underline: true }),
    "text-button underline",
  );

  // Only text buttons underline.
  assert.equal(buttonClass("ghost", { underline: true }), "ghost");
  render(createElement(Button, { variant: "text", underline: true }, "Undo"));

  assert.equal(
    screen.getByRole("button", { name: "Undo" }).className,
    "text-button underline",
  );
});

test("underline is rejected on variants other than text", () => {
  // @ts-expect-error underline is only valid on text buttons.
  createElement(Button, { variant: "ghost", underline: true });
  // @ts-expect-error a button cannot be a reset button.
  createElement(Button, { type: "reset" });
});
