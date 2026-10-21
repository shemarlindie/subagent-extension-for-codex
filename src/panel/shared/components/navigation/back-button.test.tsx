// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { BackButton } from "./back-button";

afterEach(cleanup);

test("uses the supplied accessible label for the caret icon button", () => {
  render(<BackButton label="Tasks" />);
  const button = screen.getByRole("button", { name: /^Tasks$/ });

  expect(button.getAttribute("type")).toBe("button");
  expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
});
