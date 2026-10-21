// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, test } from "vitest";

import { Button } from "./button";

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
