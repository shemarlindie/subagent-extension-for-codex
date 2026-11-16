// @vitest-environment jsdom
// The recorder must load before React DOM. Import sorting keeps a side-effect
// import in place.
import "./render-recorder";

import {
  act,
  createElement,
  Fragment,
  memo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";

import {
  equal,
  recordRenders,
  registerComponent,
  type Render,
} from "./render-recorder";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  writable: true,
  value: true,
});

let setState: Dispatch<SetStateAction<number>> = () => {};

function Label({ text }: { text: string }) {
  return createElement("span", null, text);
}

function Badge({ tone }: { tone: { color: string } }) {
  return createElement("b", { className: tone.color }, "badge");
}

const Button = memo(function Button({ onPress }: { onPress: () => void }) {
  return createElement("button", { onClick: onPress }, "go");
});

function Nothing() {
  return null;
}

function Hidden({ count }: { count: number }) {
  return createElement("i", null, count > 100 ? "many" : "few");
}

function Item({ value }: { value: number }) {
  return createElement("li", null, value);
}

function Parent() {
  const [count, set] = useState(0);
  setState = set;

  return createElement(
    Fragment,
    null,
    createElement(Label, { text: `count ${count}` }),
    createElement(Badge, { tone: { color: "blue" } }),
    createElement(Button, { onPress: () => set(count + 1) }),
    createElement(Nothing),
    createElement(Hidden, { count }),
    createElement("ul", null, createElement(Item, { key: count, value: 1 })),
  );
}

registerComponent(Parent);
registerComponent(Label);
registerComponent(Button);

async function mount() {
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Parent)));

  return root;
}

const renderOf = (renders: Render[], name: string) =>
  renders.find((render) => render.name === name);

test("records the components a commit renders, with the wasted ones and their causes", async () => {
  const root = await mount();
  const recording = recordRenders();
  await act(async () => setState(1));
  const result = recording.stop();
  root.unmount();

  expect(result.commits).toBe(1);

  expect(renderOf(result.renders, "Parent")).toMatchObject({
    ours: true,
    wasted: false,
  });

  expect(renderOf(result.renders, "Label")).toMatchObject({
    path: ["Parent"],
    wasted: false,
  });

  // An unregistered component is recorded, but isn't ours.
  expect(renderOf(result.renders, "Badge")).toMatchObject({
    ours: false,
    wasted: true,
    cause: "new props equal by value",
  });

  expect(renderOf(result.renders, "Button")).toMatchObject({
    wasted: true,
    cause: "new functions only",
  });

  expect(renderOf(result.renders, "Nothing")).toMatchObject({
    wasted: true,
    cause: "parent rendered with the same props",
  });

  expect(renderOf(result.renders, "Hidden")).toMatchObject({
    wasted: true,
    cause: "changed props it doesn't show",
  });

  expect(renderOf(result.renders, "Item")).toMatchObject({ mount: true });

  expect(result.remounts).toEqual([
    { name: "Item", ours: false, path: ["Parent"] },
  ]);
});

test("reports a component that renders and returns to its starting output", async () => {
  const root = await mount();
  const recording = recordRenders();
  await act(async () => setState(1));
  await act(async () => setState(0));
  const result = recording.stop();
  root.unmount();

  expect(result.commits).toBe(2);
  expect(result.transients.map(({ name }) => name)).toContain("Label");
  expect(result.transients.map(({ name }) => name)).toContain("Parent");
});

test("records nothing when an update changes no state", async () => {
  const root = await mount();
  const recording = recordRenders();
  await act(async () => setState(0));
  const result = recording.stop();
  root.unmount();

  expect(result.commits).toBe(0);
  expect(result.renders).toEqual([]);
});

test("compares values as the rule defines", () => {
  const element = (props: object) => createElement("div", props);

  expect(equal({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);

  expect(
    equal(
      () => 1,
      () => 2,
    ),
  ).toBe(true);

  expect(equal(element({ id: "a" }), element({ id: "a" }))).toBe(true);
  expect(equal(element({ id: "a" }), element({ id: "b" }))).toBe(false);
  expect(equal(new Date(0), new Date(0))).toBe(false);
  expect(equal({ a: 1 }, { a: 1, b: undefined })).toBe(false);
});

test("fails clearly when React DOM loaded first", async () => {
  vi.resetModules();
  const fresh = await import("./render-recorder");

  expect(() => fresh.recordRenders()).toThrow(/React DOM loaded before/);
});
