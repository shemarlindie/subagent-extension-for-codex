import { expect, test } from "vitest";

import { reuseUnchanged } from "./reuse-unchanged";

const task = (id: string, status = "running") => ({
  id,
  status,
  queue: [{ id: `${id}-m`, text: "hi" }],
});

test("keeps the previous value when a read holds the same contents", () => {
  const previous = { tasks: [task("a"), task("b")], counts: { repo: 2 } };

  expect(reuseUnchanged(previous, structuredClone(previous))).toBe(previous);
});

test("keeps unchanged items when one item changes or a new one comes first", () => {
  const previous = [task("a"), task("b"), task("c")];
  const next = [task("new"), task("a"), task("b", "completed"), task("c")];
  const result = reuseUnchanged(previous, next);

  expect(result).toEqual(next);
  expect(result[0]).toBe(next[0]);
  expect(result[1]).toBe(previous[0]);
  expect(result[2]).not.toBe(previous[1]);
  expect(result[2]?.queue).toBe(previous[1]?.queue);
  expect(result[3]).toBe(previous[2]);
});

test("takes the next value when fields or items are added or removed", () => {
  const previous = { a: 1, b: undefined, list: [1, 2] };

  expect(
    reuseUnchanged(previous, { a: 1, c: undefined, list: [1, 2] }),
  ).toStrictEqual({ a: 1, c: undefined, list: [1, 2] });

  expect(reuseUnchanged(previous, { a: 1 })).toEqual({ a: 1 });
  expect(reuseUnchanged(previous.list, [1, 2, 3])).toEqual([1, 2, 3]);
  expect(reuseUnchanged(previous.list, [2, 1])).toEqual([2, 1]);
});
