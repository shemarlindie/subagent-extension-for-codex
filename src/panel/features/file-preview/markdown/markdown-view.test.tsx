// @vitest-environment jsdom
import assert from "node:assert/strict";

import { afterEach, expect, test, vi } from "vitest";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  writable: true,
  value: true,
});

import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { Controller } from "../../../app/state/controller";
import { ControllerContext } from "../../../app/state/controller-context";
import { linkKind, loadableImage } from "./markdown-urls";
import { MarkdownView } from "./markdown-view";

afterEach(cleanup);

test("URL policy supports mail and inline images while empty targets stay text", () => {
  assert.equal(linkKind("mailto:a@example.com"), "external");
  assert.equal(linkKind("#"), "text");
  assert.equal(linkKind(""), "text");
  assert.equal(loadableImage("data:image/png;base64,AA"), true);
});

test("relative and unsafe links render as text, not broken links", () => {
  const { container } = render(
    <MarkdownView content="[file](src/a.ts:42) [bad](javascript:alert(1)) [web](https://x.dev)" />,
  );

  expect(screen.getByText("file").tagName).toBe("SPAN");
  expect(screen.getByText("file").getAttribute("title")).toBe("src/a.ts:42");
  expect(screen.getByText("bad").tagName).toBe("SPAN");
  expect(container.querySelectorAll("a")).toHaveLength(1);
  expect(screen.getByText("web").getAttribute("target")).toBe("_blank");
});

test("fenced code highlights languages named with symbols or aliases", () => {
  const { container } = render(
    <MarkdownView content={"```c++\nint x;\n```\n\n```console\n$ ls\n```"} />,
  );

  const [cpp, shell] = container.querySelectorAll("pre code");
  assert.ok(cpp && shell);
  expect(cpp.querySelector(".hljs-type")).not.toBeNull();
  expect(shell.querySelector(".hljs-meta")).not.toBeNull();
});

test("footnotes stay unique across views and jump within their own", () => {
  const scrolled: string[] = [];

  HTMLElement.prototype.scrollIntoView = vi.fn(function (this: HTMLElement) {
    scrolled.push(this.id);
  });

  const content = "Claim[^1].\n\n[^1]: Source.";

  const { container } = render(
    <>
      <MarkdownView content={content} />
      <MarkdownView content={content} />
    </>,
  );

  const ids = [...container.querySelectorAll("li[id]")].map((li) => li.id);
  expect(new Set(ids).size).toBe(2);

  const [, reference] = container.querySelectorAll("sup a");
  assert.ok(reference);
  expect(reference.hasAttribute("target")).toBe(false);
  fireEvent.click(reference);
  expect(scrolled).toEqual([ids[1]]);
});

test("heading links jump to their heading in the same view", () => {
  const scrolled: HTMLElement[] = [];

  HTMLElement.prototype.scrollIntoView = vi.fn(function (this: HTMLElement) {
    scrolled.push(this);
  });

  const content =
    "[Go](#next-steps) [Caps](#Next-Steps)\n\n## Next steps\n\nDone.";

  const { container } = render(
    <>
      <MarkdownView content={content} />
      <MarkdownView content={content} />
    </>,
  );

  const headings = [...container.querySelectorAll("h2")];
  expect(new Set(headings.map((heading) => heading.id)).size).toBe(2);

  const [, , second, secondCaps] = screen.getAllByRole("link");
  assert.ok(second && secondCaps);
  fireEvent.click(second);
  fireEvent.click(secondCaps);

  // The second view's links, in either case, reach its own heading.
  expect(scrolled).toEqual([headings[1], headings[1]]);
});

test("a malformed fragment link is harmless", () => {
  const scrollIntoView = vi.fn();
  HTMLElement.prototype.scrollIntoView = scrollIntoView;
  render(<MarkdownView content="[bad](#100%)" />);

  expect(() => fireEvent.click(screen.getByText("bad"))).not.toThrow();
  expect(scrollIntoView).not.toHaveBeenCalled();
});

test("HTML shows as literal text, never as elements", () => {
  const { container } = render(
    <MarkdownView
      content={
        'Wrap it in <Foo>.\n\n<details><summary>More</summary>Body</details>\n\n<img src="x" onerror="alert(1)"><script>alert(1)</script>'
      }
    />,
  );

  expect(container.textContent).toContain("<Foo>");
  expect(container.textContent).toContain("<details>");
  expect(container.querySelector("details, script, img")).toBeNull();
});

test("images that cannot load show their alt text", () => {
  const { container } = render(
    <MarkdownView content="![Diagram](diagram.png) ![Logo](https://x.dev/a.png)" />,
  );

  expect(screen.getByText("Diagram")).toBeTruthy();
  const image = container.querySelector("img")!;

  fireEvent.error(image);
  expect(container.querySelector("img")).toBeNull();
  expect(screen.getByText("Logo")).toBeTruthy();
});

test("embedded hosts open external links themselves", () => {
  const openLink = vi.fn(async () => {});
  let action: Promise<unknown> | undefined;

  const controller = {
    transport: { openLink },
    run: (next: () => Promise<unknown>) => {
      action = next();
    },
  } as unknown as Controller;

  render(
    <ControllerContext.Provider value={controller}>
      <MarkdownView content="[web](https://x.dev/)" />
    </ControllerContext.Provider>,
  );

  const link = screen.getByText("web");
  const click = new MouseEvent("click", { bubbles: true, cancelable: true });
  link.dispatchEvent(click);

  expect(click.defaultPrevented).toBe(true);
  expect(action).toBeDefined();
  expect(openLink).toHaveBeenCalledWith("https://x.dev/");
});
