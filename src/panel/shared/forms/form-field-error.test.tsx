// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { expect, test } from "vitest";

import { FormFieldError } from "./form-field-error";

test("FormFieldError exposes the message and removes it when cleared", (t) => {
  t.onTestFinished(cleanup);

  const fieldError = (message?: string) =>
    createElement(FormFieldError, {
      id: "limit-error",
      message,
      className: "setting-error",
    });

  const view = render(fieldError("Enter a valid limit."));
  const alert = view.getByRole("alert");

  expect(alert.id).toBe("limit-error");
  expect(alert.textContent).toBe("Enter a valid limit.");
  expect(alert.classList.contains("form-error")).toBe(true);
  expect(alert.classList.contains("form-field-error")).toBe(true);
  expect(alert.classList.contains("setting-error")).toBe(true);

  view.rerender(fieldError(undefined));
  expect(view.queryByRole("alert")).toBeNull();
});
