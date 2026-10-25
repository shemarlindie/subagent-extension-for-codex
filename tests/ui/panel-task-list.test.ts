// @vitest-environment jsdom
import { expect } from "vitest";

import {
  act,
  assert,
  assertAbsent,
  enterTask,
  openAdvancedTask,
  screen,
  setup,
  test,
  vi,
  waitFor,
} from "./panel-test-support";

test("task filters show counts and an empty state with a way out", async (t) => {
  const { user } = await setup(t);
  assert.ok(screen.getByRole("radio", { name: "All, 1" }));
  assert.ok(screen.getByRole("radio", { name: "Active, 1" }));
  assertAbsent(screen.queryByRole("button", { name: "Clear filter" }));
  const search = screen.getByRole("searchbox", { name: "Search tasks" });
  await user.type(search, "zzz");

  // Counts follow the search, so no filter promises tasks the list cannot show.
  // With nothing left, only All remains, so the row keeps its place.
  assert.deepEqual(
    screen
      .getAllByRole("radio")
      .map((radio) => radio.getAttribute("data-filter")),
    ["all"],
  );

  assert.ok(screen.getByRole("radio", { name: "All, 0" }));
  assert.ok(screen.getByText("No tasks match “zzz”."));

  assert.equal(
    screen.getByText("0 of 1").closest("#count")?.textContent,
    "0 of 1",
  );

  await user.click(screen.getByRole("button", { name: "Clear search" }));
  assert.equal((search as HTMLInputElement).value, "");
  await user.type(search, "a");
  await user.click(screen.getByRole("button", { name: "Clear filter" }));
  assert.equal((search as HTMLInputElement).value, "");

  assert.equal(
    screen.getByRole("radio", { name: /^All/ }).getAttribute("aria-checked"),
    "true",
  );
});

test("a chosen filter stays visible after it empties", async (t) => {
  const { user } = await setup(t);
  await user.click(screen.getByRole("radio", { name: /^Active/ }));
  await user.click(screen.getByRole("radio", { name: /^Active/ }));

  assert.equal(
    screen.getByRole("radio", { name: /^Active/ }).getAttribute("aria-checked"),
    "true",
  );

  await user.type(
    screen.getByRole("searchbox", { name: "Search tasks" }),
    "zzz",
  );

  assert.ok(screen.getByRole("radio", { name: "Active, 0" }));
  assert.ok(screen.getByText("No tasks match “zzz” in Active."));
  await user.click(screen.getByRole("button", { name: "Clear filter" }));

  assert.equal(
    screen.getByRole("radio", { name: /^All/ }).getAttribute("aria-checked"),
    "true",
  );
});

test("search clears with Escape and focuses with the slash key", async (t) => {
  const { user } = await setup(t);
  const search = screen.getByRole("searchbox", { name: "Search tasks" });
  await user.keyboard("/");
  expect(document.activeElement).toBe(search);
  await user.keyboard("abc");
  assert.equal((search as HTMLInputElement).value, "abc");
  await user.keyboard("{Escape}");
  assert.equal((search as HTMLInputElement).value, "");
  expect(document.activeElement).toBe(search);
  await user.keyboard("{Escape}");
  expect(document.activeElement).not.toBe(search);
  // Typing a slash in another text field leaves the shortcut alone.
  await openAdvancedTask(user);
  await enterTask(user, "a/b");
  expect(document.activeElement).not.toBe(search);
});

test("selecting a tab scrolls it into view in an overflowing tab list", async (t) => {
  const { user } = await setup(t);
  const list = screen.getByRole("tablist");
  const scrollTo = vi.fn();

  // jsdom has no layout, so describe a 100px list whose Details tab sits past its edge.
  const define = (element: HTMLElement, values: Record<string, unknown>) =>
    Object.entries(values).forEach(([key, value]) =>
      Object.defineProperty(element, key, { configurable: true, value }),
    );

  define(list, { clientWidth: 100, scrollLeft: 0, scrollTo });

  define(screen.getByRole("tab", { name: "Details" }), {
    offsetLeft: 150,
    offsetWidth: 60,
  });

  define(screen.getByRole("tab", { name: "Chat" }), {
    offsetLeft: 0,
    offsetWidth: 60,
  });

  await user.click(screen.getByRole("tab", { name: "Details" }));
  // Right edge (210) plus the 12px gap, less the visible width.
  await waitFor(() => assert.equal(scrollTo.mock.calls.at(-1)?.[0].left, 122));
  // A tab already fully inside the list leaves it where it is.
  scrollTo.mockClear();
  define(list, { scrollLeft: 0 });

  define(screen.getByRole("tab", { name: /^Activity/ }), {
    offsetLeft: 20,
    offsetWidth: 40,
  });

  await user.click(screen.getByRole("tab", { name: /^Activity/ }));

  await waitFor(() =>
    assert.equal(
      screen
        .getByRole("tab", { name: /^Activity/ })
        .getAttribute("aria-selected"),
      "true",
    ),
  );

  assert.equal(scrollTo.mock.calls.length, 0);
});

test("evidence tabs support keyboard arrows and keep tab focus through refresh", async (t) => {
  const { controller, user } = await setup(t, (transport) => {
    transport.taskEvents = [
      {
        id: 1,
        task_id: "one",
        timestamp: "2026-10-03T12:00:00.000Z",
        type: "task.started",
        data: {},
      },
    ];
  });

  const result = screen.getByRole("tab", { name: "Chat" });

  await user.click(result);
  await user.keyboard("{ArrowRight}");

  await waitFor(() =>
    assert.equal(
      screen
        .getByRole("tab", { name: /Activity/ })
        .getAttribute("aria-selected"),
      "true",
    ),
  );

  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: /Activity/ }),
    ),
  );

  await act(() => controller.refresh());

  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: /Activity/ }),
    ),
  );

  await user.keyboard("{ArrowRight}{ArrowRight}");

  await waitFor(() =>
    assert.equal(
      screen
        .getByRole("tab", { name: "Details" })
        .getAttribute("aria-selected"),
      "true",
    ),
  );

  assert.ok(screen.getByText("Task ID"));
});
