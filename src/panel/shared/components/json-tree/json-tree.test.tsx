// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import { expect, test } from "vitest";

import { JsonTree } from "./json-tree";
import { expandedJson } from "./json-tree-test-harness";

const value = {
  type: "result",
  usage: { input: 3, cache: { read: 1, write: 0 } },
  content: [{ text: "<b>literal</b>" }],
  empty: {},
  'quoted"key': [[], "line\nwith\ttabs", false],
  missing: null,
};

test("deep branches start folded with a count and render their children only when opened", (t) => {
  t.onTestFinished(cleanup);
  const view = render(createElement(JsonTree, { value }));

  const cache = view.getByRole("button", { name: "cache" });
  expect(cache.getAttribute("aria-expanded")).toBe("false");

  // Array items are named by position.
  expect(
    view.getByRole("button", { name: "item 0" }).getAttribute("aria-expanded"),
  ).toBe("false");

  expect(cache.closest(".json-line")?.textContent).toBe('"cache": {2 keys}');
  expect(view.container.textContent).not.toContain('"read"');

  fireEvent.click(cache);
  expect(cache.getAttribute("aria-expanded")).toBe("true");
  expect(view.container.textContent).toContain('"read": 1,');

  fireEvent.click(view.getByRole("button", { name: "value" }));
  expect(view.container.textContent).toBe("{6 keys}");
});

test("the expanded tree reads as the original JSON", (t) => {
  t.onTestFinished(cleanup);
  const view = render(createElement(JsonTree, { value }));

  expect(expandedJson(view.container)).toEqual(value);
  expect(view.container.textContent).toContain("<b>literal</b>");
  expect(view.container.querySelector("b")).toBeNull();
});
