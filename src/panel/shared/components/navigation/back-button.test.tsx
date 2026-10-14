// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { BackButton } from "./back-button";

afterEach(cleanup);

test("uses the supplied accessible label for the caret icon button", () => {
  render(<BackButton label="Tasks" className="custom-back" />);
  const button = screen.getByRole("button", { name: /^Tasks$/ });

  expect(button.getAttribute("type")).toBe("button");
  expect(button.classList.contains("custom-back")).toBe(true);
  expect(button.textContent).toBe("");
  expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  expect(button.classList.contains("toolbar-icon-button")).toBe(true);
});

test("invokes the supplied handler and blocks it when disabled", async () => {
  const onClick = vi.fn();
  const user = userEvent.setup();
  const view = render(<BackButton label="Tasks" onClick={onClick} />);
  const button = screen.getByRole("button", { name: "Tasks" });

  await user.click(button);
  expect(onClick).toHaveBeenCalledTimes(1);

  view.rerender(<BackButton label="Tasks" onClick={onClick} disabled />);
  expect((button as HTMLButtonElement).disabled).toBe(true);
  await user.click(button);
  expect(onClick).toHaveBeenCalledTimes(1);
});
